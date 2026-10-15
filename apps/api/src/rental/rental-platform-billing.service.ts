import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RentalPlatformInvoice, Role } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { toCents } from './rental-billing.util';
import {
  PlatformInvoiceKind,
  collectionFee,
  coveredByFreePeriod,
  firstOfMonthDate,
  isAccountReadOnly,
  monthBounds,
  monthOf,
  nextPlatformReminderStage,
  platformInvoiceDueDate,
  platformInvoiceNumber,
  previousMonth,
  subscriptionAmount,
  subscriptionPeriod,
} from './rental-platform-billing.util';
import { buildPlatformInvoiceEmail } from './rental-platform-invoice-email';
import { RENTAL_PLANS, RentalBillingCycle, effectivePlan, isPlanCode } from './rental-plans.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };

/**
 * ZARODA's own invoices to landlords for the rental plan: a flat Starter fee, or 1% of the rent matched through the
 * landlord's gateway on Pay-as-you-collect. Issued on the 1st, due on the 15th, reminded on days 1, 5 and 10; an
 * unpaid invoice makes the landlord's account read-only from the 15th (RentalReadOnlyInterceptor) - data is never
 * deleted, and tenants can keep paying. Every step is idempotent, so the hourly scheduler can run it as often as it
 * likes: an invoice is unique per landlord, kind and month, and each notice is recorded once.
 */
@Injectable()
export class RentalPlatformBillingService {
  private readonly logger = new Logger(RentalPlatformBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Whether account locking is switched on (RENTAL_ENFORCE_READ_ONLY=on). Off until landlords can pay online. */
  enforcesReadOnly(): boolean {
    return this.config.get<string>('RENTAL_ENFORCE_READ_ONLY') === 'on';
  }

  // ── Generating invoices ─────────────────────────────────────────────────

  /** Units with an active lease on the 1st of the month: started by then and not yet ended. */
  private async occupiedOnFirst(tx: Tx, organizationId: string, month: string): Promise<number> {
    const first = firstOfMonthDate(month);
    return tx.rentalLease.count({
      where: { organizationId, startDate: { lte: first }, OR: [{ endedAt: null }, { endedAt: { gt: first } }] },
    });
  }

  /** Rent matched through the landlord's gateway in a month: payments that came from a paid M-Pesa prompt, not voided. */
  private async matchedRent(tx: Tx, organizationId: string, month: string): Promise<number> {
    const requests = await tx.rentalPaymentRequest.findMany({
      // Only prompts paid since the month began can hold a payment dated in it.
      where: { organizationId, status: 'PAID', paymentId: { not: null }, updatedAt: { gte: firstOfMonthDate(month) } },
      select: { paymentId: true },
    });
    const ids = requests.map((r) => r.paymentId as string);
    if (ids.length === 0) return 0;
    const start = firstOfMonthDate(month);
    const end = firstOfMonthDate(nextMonth(month));
    const payments = await tx.rentalPayment.findMany({
      where: { id: { in: ids }, voidedAt: null, paidAt: { gte: start, lt: end } },
      select: { amount: true },
    });
    return payments.reduce((sum, p) => sum + toCents(p.amount), 0) / 100;
  }

  /**
   * Creates this month's invoice(s) for one landlord, if due. Runs inside a transaction already scoped to the
   * landlord. Returns what it created (usually nothing - most hourly runs have nothing to do).
   */
  async generateForOrganization(tx: Tx, organizationId: string, now: Date = new Date()) {
    let settings = await tx.rentalSettings.findUnique({ where: { organizationId } });
    if (!settings) return [];

    // A move to a smaller plan that has reached its date becomes the plan for good, so billing and the screens agree.
    if (settings.pendingPlan && settings.pendingPlanFrom && settings.pendingPlanFrom <= now && isPlanCode(settings.pendingPlan)) {
      settings = await tx.rentalSettings.update({ where: { organizationId }, data: { plan: settings.pendingPlan, pendingPlan: null, pendingPlanFrom: null } });
    }
    const plan = effectivePlan(settings, now);
    if (plan.code === 'bure') return [];

    const month = monthOf(now);
    const cycle = (settings.billingCycle === 'annual' ? 'annual' : 'monthly') as RentalBillingCycle;
    const created = [];

    if (plan.monthlyPrice > 0) {
      const amount = subscriptionAmount(plan, cycle);
      const period = subscriptionPeriod(month, cycle, plan);
      // An earlier invoice (annual ones cover 12 months) that already covers this month means nothing is due now.
      const covering = await tx.rentalPlatformInvoice.findFirst({
        where: { organizationId, kind: 'SUBSCRIPTION', periodStart: { lte: period.start }, periodEnd: { gt: period.start } },
        select: { id: true },
      });
      if (!covering && amount > 0 && !coveredByFreePeriod(settings.planFreeUntil, monthBounds(month).end)) {
        created.push(await this.issue(tx, { organizationId, kind: 'SUBSCRIPTION', month, plan: plan.code, cycle, amount, period, matched: null, now }));
      }
    }

    if (plan.feePercent > 0) {
      const period = monthBounds(previousMonth(month));
      const existing = await tx.rentalPlatformInvoice.findUnique({
        where: { organizationId_kind_invoiceMonth: { organizationId, kind: 'COLLECTION_FEE', invoiceMonth: month } },
        select: { id: true },
      });
      if (!existing && !coveredByFreePeriod(settings.planFreeUntil, period.end)) {
        const matched = await this.matchedRent(tx, organizationId, previousMonth(month));
        const amount = collectionFee(plan, matched);
        if (amount > 0) {
          created.push(await this.issue(tx, { organizationId, kind: 'COLLECTION_FEE', month, plan: plan.code, cycle, amount, period, matched, now }));
        }
      }
    }
    return created;
  }

  private async issue(
    tx: Tx,
    input: {
      organizationId: string;
      kind: PlatformInvoiceKind;
      month: string;
      plan: string;
      cycle: RentalBillingCycle;
      amount: number;
      period: { start: Date; end: Date };
      matched: number | null;
      now: Date;
    },
  ) {
    const occupiedUnits = await this.occupiedOnFirst(tx, input.organizationId, input.month);
    // Four random characters make a clash very unlikely; checking first keeps the transaction clean if one happens.
    let invoiceNumber = platformInvoiceNumber(input.month);
    while (await tx.rentalPlatformInvoice.findUnique({ where: { invoiceNumber }, select: { id: true } })) {
      invoiceNumber = platformInvoiceNumber(input.month);
    }
    return tx.rentalPlatformInvoice.create({
      data: {
        organizationId: input.organizationId,
        invoiceNumber,
        kind: input.kind,
        invoiceMonth: input.month,
        periodStart: input.period.start,
        periodEnd: input.period.end,
        plan: input.plan,
        billingCycle: input.cycle,
        occupiedUnits,
        matchedRentTotal: input.matched,
        amountDue: input.amount,
        issuedAt: input.now,
        dueDate: platformInvoiceDueDate(input.month, input.now),
      },
    });
  }

  // ── Notices ─────────────────────────────────────────────────────────────

  private backofficeUrl(): string | null {
    const base = this.config.get<string>('BACKOFFICE_BASE_URL');
    return base ? `${base.replace(/\/+$/, '')}/rentals` : null;
  }

  /** Active owners' emails (managers if there is no owner), and the business name. */
  async recipientsFor(organizationId: string): Promise<{ emails: string[]; name: string }> {
    return this.runAsTenant(organizationId, async (tx) => {
      const [org, staff] = await Promise.all([
        tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
        tx.orgUser.findMany({ where: { isActive: true, role: { in: [Role.OWNER, Role.MANAGER] } }, select: { role: true, user: { select: { email: true } } } }),
      ]);
      const owners = staff.filter((s) => s.role === Role.OWNER);
      const chosen = owners.length > 0 ? owners : staff;
      return { emails: Array.from(new Set(chosen.map((s) => s.user.email.trim().toLowerCase()).filter(Boolean))), name: org?.name ?? 'your business' };
    });
  }

  /** Emails each unpaid invoice's next notice, once. A failed send is left to try again next run. */
  async sendNotices(organizationId: string, now: Date = new Date()): Promise<number> {
    // Emails go out in Nairobi daytime only - nobody wants an invoice at 3am.
    const nairobiHour = (now.getUTCHours() + 3) % 24;
    if (!this.email.isConfigured() || nairobiHour < 6 || nairobiHour >= 20) return 0;
    const due = await this.runAsTenant(organizationId, async (tx) => {
      const open = await tx.rentalPlatformInvoice.findMany({ where: { status: 'ISSUED', reminderStage: { lt: 4 } } });
      return open.flatMap((invoice) => {
        const stage = nextPlatformReminderStage(invoice, now);
        return stage ? [{ invoice, stage }] : [];
      });
    });
    if (due.length === 0) return 0;

    const { emails, name } = await this.recipientsFor(organizationId);
    if (emails.length === 0) {
      this.logger.warn({ organizationId }, 'No owner or manager email to send rental invoices to');
      return 0;
    }
    let sent = 0;
    for (const { invoice, stage } of due) {
      const built = buildPlatformInvoiceEmail(
        stage,
        {
          invoiceNumber: invoice.invoiceNumber,
          kind: invoice.kind as PlatformInvoiceKind,
          invoiceMonth: invoice.invoiceMonth,
          periodStart: invoice.periodStart,
          periodEnd: invoice.periodEnd,
          planName: isPlanCode(invoice.plan) ? RENTAL_PLANS[invoice.plan].name : invoice.plan,
          occupiedUnits: invoice.occupiedUnits,
          matchedRentTotal: invoice.matchedRentTotal === null ? null : Number(invoice.matchedRentTotal),
          amountDue: invoice.amountDue,
          dueDate: invoice.dueDate,
        },
        name,
        this.backofficeUrl(),
      );
      let anySent = false;
      for (const to of emails) {
        const result = await this.email.sendEmail({ to, ...built });
        anySent = anySent || result.sent;
      }
      if (!anySent) continue;
      sent++;
      await this.runAsTenant(organizationId, (tx) =>
        tx.rentalPlatformInvoice.update({
          where: { id: invoice.id },
          // Never move backwards if a newer stage was recorded in the meantime.
          data: { reminderStage: Math.max(invoice.reminderStage, stage), emailedAt: invoice.emailedAt ?? new Date() },
        }),
      );
    }
    return sent;
  }

  // ── The landlord's own view, and the read-only check ────────────────────

  /** Is this landlord's account read-only right now (an invoice unpaid past its due date)? */
  async isReadOnly(tx: Tx, organizationId: string, now: Date = new Date()): Promise<boolean> {
    const overdue = await tx.rentalPlatformInvoice.findMany({ where: { organizationId, status: 'ISSUED', dueDate: { lte: now } }, select: { status: true, dueDate: true } });
    return isAccountReadOnly(overdue, now);
  }

  async getMine() {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const invoices = await tx.rentalPlatformInvoice.findMany({ where: { organizationId }, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }], take: 36 });
      return {
        readOnly: isAccountReadOnly(invoices),
        // False until online payment is switched on: the account is never actually locked while this is false.
        enforced: this.enforcesReadOnly(),
        invoices: invoices.map((i) => toPlatformInvoiceView(i)),
      };
    });
  }
}

function nextMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** What the screens see of an invoice. paymentPending = an M-Pesa prompt went out in the last 15 minutes and has not failed. */
export function toPlatformInvoiceView(i: RentalPlatformInvoice, now: Date = new Date()) {
  return {
    id: i.id,
    invoiceNumber: i.invoiceNumber,
    kind: i.kind,
    invoiceMonth: i.invoiceMonth,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    plan: i.plan,
    occupiedUnits: i.occupiedUnits,
    matchedRentTotal: i.matchedRentTotal === null ? null : Number(i.matchedRentTotal),
    amountDue: i.amountDue,
    status: i.status,
    issuedAt: i.issuedAt,
    dueDate: i.dueDate,
    pastDue: i.status === 'ISSUED' && i.dueDate.getTime() <= now.getTime(),
    paidAt: i.paidAt,
    paymentMethod: i.paymentMethod,
    paymentReference: i.paymentReference,
    waivedReason: i.waivedReason,
    payPhone: i.payPhone,
    paymentPending: i.status === 'ISSUED' && Boolean(i.tumaMerchantRequestId) && Boolean(i.payAttemptedAt) && now.getTime() - i.payAttemptedAt!.getTime() < 15 * 60_000 && !i.lastPaymentError,
    lastPaymentError: i.lastPaymentError,
  };
}
