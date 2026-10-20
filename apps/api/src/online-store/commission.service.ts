import { createHmac, timingSafeEqual } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CommissionInvoice, CommissionInvoiceStatus, OnlineOrderStatus, Prisma, Role, RoomBookingStatus } from '@prisma/client';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { buildFeeNoticeEmail, buildInvoiceEmail, buildReceiptEmail, feeNoticeSms, nextReminderStage } from './commission-email';
import { feeOrderWhere } from './fee-orders';
import {
  FEE_DAY_CLOSE_HOUR,
  FEE_KIND,
  FEE_PAUSE_GRACE_DAYS,
  PAUSE_GRACE_DAYS,
  dayBounds,
  dayOf,
  feeInvoiceNumber,
  nairobiHour,
  invoiceDueDate,
  invoiceNumber,
  isMonthClosed,
  isPastDue,
  isPauseOverdue,
  isValidMonth,
  monthBounds,
  monthOf,
  pauseDate,
  randomInvoiceCode,
  roundMoney,
} from './commission.util';
import { DEFAULT_COMMISSION_RATE } from './online-store.constants';
import { TumaClient } from './tuma.client';
import { evaluateCallback, parseCallback } from './tuma.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const DAY_MS = 24 * 60 * 60 * 1000;
// A second prompt before this would risk two live M-Pesa prompts for one invoice.
const PAY_RETRY_COOLDOWN_MS = 60_000;
// "Check now" is a paid Tuma status check (KES 1, charged to ZARODA), so it is rate limited.
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_INVOICE = 5;
// A payment prompt older than this is no longer worth re-checking.
const RECONCILE_WINDOW_MS = DAY_MS;

/**
 * True when the current tenant has an unpaid invoice past due date + grace.
 * Used by ShopCatalogService to hide the shop and refuse new orders -
 * deliberately worked out on every look (one indexed count), like
 * subscription status, so there's no flag to keep truthful. Orders already
 * placed carry on; only NEW checkouts are blocked.
 */
export async function hasOverdueCommission(tx: TenantTx, now: Date = new Date()): Promise<boolean> {
  const monthlyCutoff = new Date(now.getTime() - PAUSE_GRACE_DAYS * DAY_MS);
  const feeCutoff = new Date(now.getTime() - FEE_PAUSE_GRACE_DAYS * DAY_MS);
  const count = await tx.commissionInvoice.count({
    where: {
      status: CommissionInvoiceStatus.ISSUED,
      OR: [
        { kind: { not: FEE_KIND }, dueDate: { lt: monthlyCutoff } },
        { kind: FEE_KIND, dueDate: { lt: feeCutoff } },
      ],
    },
  });
  return count > 0;
}

export function toInvoiceView(invoice: CommissionInvoice, now: Date = new Date()) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    kind: invoice.kind,
    periodMonth: invoice.periodMonth,
    orderCount: invoice.orderCount,
    salesTotal: Number(invoice.salesTotal),
    commissionTotal: Number(invoice.commissionTotal),
    amountDue: invoice.amountDue,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
    // The date the shop is hidden if this stays unpaid.
    pauseDate: pauseDate(invoice.dueDate, invoice.kind),
    pastDue: isPastDue(invoice, now),
    causesPause: isPauseOverdue(invoice, now),
    paidAt: invoice.paidAt,
    paymentMethod: invoice.paymentMethod,
    paymentReference: invoice.paymentReference,
    waivedReason: invoice.waivedReason,
    // Online payment: an M-Pesa prompt is out for this invoice.
    payPhone: invoice.payPhone,
    paymentPending:
      invoice.status === CommissionInvoiceStatus.ISSUED &&
      Boolean(invoice.tumaMerchantRequestId) &&
      Boolean(invoice.payAttemptedAt) &&
      now.getTime() - invoice.payAttemptedAt!.getTime() < 15 * 60_000 &&
      !invoice.lastPaymentError,
    lastPaymentError: invoice.lastPaymentError,
  };
}

@Injectable()
export class CommissionService {
  private readonly logger = new Logger(CommissionService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  // ── Callback URL (same trust model as online-order payments) ──────────

  private callbackToken(invoiceId: string): string {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    return createHmac('sha256', key).update(`commission-callback:${invoiceId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, invoiceId: string): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/commission/${organizationId}/${invoiceId}/tuma-callback/${this.callbackToken(invoiceId)}`;
  }

  /** Where the emails send a business to pay. Null (no button) if the back office address isn't configured. */
  private payUrl(): string | null {
    const base = this.config.get<string>('BACKOFFICE_BASE_URL') ?? this.config.get<string>('PUBLIC_BOOKING_BASE_URL');
    return base ? `${base.replace(/\/+$/, '')}/settings/online-shop` : null;
  }

  // ── The business's own view ───────────────────────────────────────────

  async getMine() {
    const { organizationId } = getTenantStore();
    const now = new Date();
    return this.tenantPrisma.run(async (tx) => {
      const [store, unbilledOrders, unbilledBookings, invoices, unsentFees] = await Promise.all([
        tx.onlineStore.findUnique({ where: { organizationId }, select: { commissionRate: true, contactPhone: true } }),
        tx.onlineOrder.aggregate({
          where: { status: OnlineOrderStatus.COMPLETED, commissionInvoiceId: null, convenienceFee: 0 },
          _count: true,
          _sum: { subtotal: true, commissionAmount: true },
        }),
        // Hotel bookings whose guest has checked out count too: commission on the room price for the whole stay.
        tx.roomBooking.aggregate({
          where: { status: RoomBookingStatus.CHECKED_OUT, commissionInvoiceId: null, paidAt: { not: null } },
          _count: true,
          _sum: { total: true, commissionAmount: true },
        }),
        tx.commissionInvoice.findMany({ orderBy: { issuedAt: 'desc' }, take: 40 }),
        // Shopper convenience fees this shop has collected and not yet sent to Zaroda.
        tx.onlineOrder.aggregate({ where: feeOrderWhere(), _count: true, _sum: { convenienceFee: true } }),
      ]);
      const views = invoices.map((i) => toInvoiceView(i, now));
      return {
        commissionRate: store?.commissionRate != null ? Number(store.commissionRate) : DEFAULT_COMMISSION_RATE,
        // Completed orders and checked-out bookings not yet on an invoice - billed once their month closes.
        unbilled: {
          orderCount: unbilledOrders._count + unbilledBookings._count,
          salesTotal: roundMoney(Number(unbilledOrders._sum.subtotal ?? 0) + Number(unbilledBookings._sum.total ?? 0)),
          commissionTotal: roundMoney(Number(unbilledOrders._sum.commissionAmount ?? 0) + Number(unbilledBookings._sum.commissionAmount ?? 0)),
        },
        invoices: views,
        // The shopper fee: collected by the shop with each payment, sent to Zaroda daily (settleFeesNow, or automatically at the
        // end of the day). Shown so the shop always knows what it is holding.
        fees: {
          rate: store?.commissionRate != null ? Number(store.commissionRate) : DEFAULT_COMMISSION_RATE,
          unsentCount: unsentFees._count,
          unsentTotal: unsentFees._sum.convenienceFee ?? 0,
        },
        outstandingTotal: roundMoney(
          views.filter((v) => v.status === CommissionInvoiceStatus.ISSUED).reduce((sum, v) => sum + v.amountDue, 0),
        ),
        paused: views.some((v) => v.causesPause),
        // False until ZARODA's Tuma account is configured on this server.
        canPayOnline: this.tuma.hasPlatformCredentials(),
        contactPhone: store?.contactPhone ?? null,
      };
    });
  }

  // ── Paying an invoice online (through ZARODA's own Tuma account) ──────

  /**
   * Sends an M-Pesa prompt for the invoice. The money lands in ZARODA's
   * Tuma account; the callback (or a re-check) marks the invoice PAID once
   * Tuma confirms it - exactly how a school's subscription is paid.
   */
  async payOnline(invoiceId: string, phoneInput: string) {
    const { organizationId } = getTenantStore();
    const phone = normalizeKenyanPhone(phoneInput);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    const credentials = this.tuma.platformCredentials();

    const invoice = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.commissionInvoice.findUnique({ where: { id: invoiceId } });
      if (!current) throw new NotFoundException('Invoice not found');
      if (current.status !== CommissionInvoiceStatus.ISSUED) {
        throw new ConflictException(`This invoice is already ${current.status.toLowerCase()}`);
      }
      if (current.amountDue < 1) throw new BadRequestException('This invoice has nothing to pay');
      if (
        current.payAttemptedAt &&
        !current.lastPaymentError &&
        Date.now() - current.payAttemptedAt.getTime() < PAY_RETRY_COOLDOWN_MS
      ) {
        throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
      }
      return current;
    });

    let merchantRequestId: string | null = null;
    let lastPaymentError: string | null = null;
    try {
      const result = await this.tuma.stkPush(credentials, {
        amount: invoice.amountDue,
        phone,
        description: `ZARODA commission ${invoice.invoiceNumber}`,
        callbackUrl: this.callbackUrl(organizationId, invoice.id),
      });
      merchantRequestId = result.merchantRequestId;
    } catch (e) {
      lastPaymentError = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, invoiceId }, 'Commission invoice STK push failed');
    }

    const updated = await this.tenantPrisma.run((tx) =>
      tx.commissionInvoice.update({
        where: { id: invoiceId },
        data: {
          payPhone: phone,
          payAttemptedAt: new Date(),
          lastPaymentError,
          ...(merchantRequestId ? { tumaMerchantRequestId: merchantRequestId } : {}),
        },
      }),
    );
    return toInvoiceView(updated);
  }

  /**
   * "Check now" - the business's backup when Tuma's callback hasn't arrived.
   * Each call is a paid Tuma status check (KES 1, charged to ZARODA's own
   * account), so it has a cooldown and a cap per invoice. The page itself
   * refreshes with plain, free reads.
   */
  async checkPayment(invoiceId: string) {
    const { organizationId } = getTenantStore();
    const find = () => this.tenantPrisma.run((tx) => tx.commissionInvoice.findUnique({ where: { id: invoiceId } }));
    let invoice = await find();
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== CommissionInvoiceStatus.ISSUED || !invoice.tumaMerchantRequestId) {
      return { ...toInvoiceView(invoice), checkResult: 'not-needed' as const };
    }
    const state = this.checks.get(invoice.id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    if (state.count >= MAX_CHECKS_PER_INVOICE) {
      throw new BadRequestException('This invoice has been checked several times already - please contact Zaroda with your M-Pesa message');
    }
    this.checks.set(invoice.id, { last: Date.now(), count: state.count + 1 });

    const outcome = await this.verifyWithTuma(organizationId, invoice.id).catch(() => 'unavailable' as const);
    invoice = (await find()) ?? invoice;
    return {
      ...toInvoiceView(invoice),
      checkResult: (outcome === 'paid' ? 'paid' : outcome === 'unconfirmed' ? 'not-paid-yet' : outcome === 'unavailable' ? 'unavailable' : 'not-needed') as
        | 'paid'
        | 'not-paid-yet'
        | 'unavailable'
        | 'not-needed',
    };
  }

  /**
   * Tuma's webhook (free) is how a payment is normally learned about: the
   * HMAC in the URL proves it came from Tuma, and the body itself must be
   * complete and consistent (evaluateCallback). An incomplete callback is
   * never acted on as-is - it triggers one paid status check instead.
   */
  async handleTumaCallback(organizationId: string, invoiceId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(invoiceId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();

    // Field NAMES and the status word only - never amounts or receipts. Tuma publishes no
    // callback schema, so this is how a surprise in its real payload shows up in the logs.
    this.logger.log({ invoiceId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma invoice callback received');
    const invoice = await this.runAsTenant(organizationId, (tx) => tx.commissionInvoice.findUnique({ where: { id: invoiceId } }));
    if (!invoice) throw new NotFoundException();
    if (invoice.status !== CommissionInvoiceStatus.ISSUED) return { ok: true };

    const verdict = evaluateCallback(body, { amount: invoice.amountDue, latestRequestId: invoice.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, invoice, verdict.receipt, merchantRequestId ?? invoice.tumaMerchantRequestId ?? undefined);
        break;
      case 'review':
        this.logger.error({ invoiceId, detail: verdict.detail }, 'Tuma reported a commission payment that does not match the invoice - needs manual review');
        await this.flag(organizationId, invoiceId, `A payment was received that doesn't match this invoice (${verdict.detail}). Contact Zaroda.`);
        break;
      case 'failed':
        if (!merchantRequestId || !invoice.tumaMerchantRequestId || merchantRequestId === invoice.tumaMerchantRequestId) {
          await this.flag(organizationId, invoiceId, 'The M-Pesa payment was cancelled or failed - try again');
        }
        break;
      case 'needs-check':
        this.logger.warn({ invoiceId, reason: verdict.reason }, 'Callback was not complete enough to trust - asking Tuma (KES 1)');
        await this.verifyWithTuma(organizationId, invoiceId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return { ok: true };
  }

  private flag(organizationId: string, invoiceId: string, message: string) {
    return this.runAsTenant(organizationId, (tx) => tx.commissionInvoice.update({ where: { id: invoiceId }, data: { lastPaymentError: message } }));
  }

  /**
   * Marks the invoice PAID by M-Pesa and emails a receipt. Conditional on
   * still being ISSUED, so a callback, a "check now", and a platform admin
   * recording it by hand at the same moment settle it - and send the
   * receipt - only once.
   */
  private async settle(organizationId: string, invoice: CommissionInvoice, receipt: string, requestId?: string): Promise<'paid' | 'skipped'> {
    const settled = await this.runAsTenant(organizationId, async (tx) => {
      const result = await tx.commissionInvoice.updateMany({
        where: { id: invoice.id, status: CommissionInvoiceStatus.ISSUED },
        data: {
          status: CommissionInvoiceStatus.PAID,
          paidAt: new Date(),
          paymentMethod: 'MPESA',
          paymentReference: receipt,
          ...(requestId ? { tumaMerchantRequestId: requestId } : {}),
          lastPaymentError: null,
        },
      });
      return result.count === 1 ? tx.commissionInvoice.findUniqueOrThrow({ where: { id: invoice.id } }) : null;
    });
    if (!settled) return 'skipped';
    await this.sendReceipt(organizationId, settled, receipt);
    return 'paid';
  }

  /**
   * The paid backup: asks Tuma (with ZARODA's own account, KES 1 per call)
   * whether the invoice's latest payment went through. Only a confirmed
   * full payment settles it.
   */
  private async verifyWithTuma(
    organizationId: string,
    invoiceId: string,
  ): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const invoice = await this.runAsTenant(organizationId, (tx) => tx.commissionInvoice.findUnique({ where: { id: invoiceId } }));
    if (!invoice || invoice.status !== CommissionInvoiceStatus.ISSUED) return 'skipped';
    const requestId = invoice.tumaMerchantRequestId;
    if (!requestId || !this.tuma.hasPlatformCredentials()) return 'skipped';

    const confirmation = await this.tuma.confirmPayment(this.tuma.platformCredentials(), requestId, invoice.amountDue);
    if (confirmation.outcome === 'review') {
      this.logger.error({ invoiceId, detail: confirmation.detail }, 'Tuma reported a commission payment that does not match the invoice - needs manual review');
      await this.flag(organizationId, invoiceId, `A payment was received that doesn't match this invoice (${confirmation.detail}). Contact Zaroda.`);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      this.logger.error({ invoiceId, detail: confirmation.detail }, "Could not check this commission payment with Tuma (is ZARODA's Tuma account out of credits?)");
      await this.flag(organizationId, invoiceId, 'We could not confirm the payment just now. If you have paid, Zaroda will confirm it - or try again in a few minutes.');
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';
    return (await this.settle(organizationId, invoice, confirmation.mpesaReceipt?.trim() || `TUMA:${requestId}`, requestId)) === 'paid' ? 'paid' : 'skipped';
  }

  // ── Emails ────────────────────────────────────────────────────────────

  /** Active owners' emails (managers if there is no owner), and the shop's display name. */
  private async recipientsFor(organizationId: string): Promise<{ emails: string[]; shopName: string }> {
    return this.runAsTenant(organizationId, async (tx) => {
      const [org, store, staff] = await Promise.all([
        tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
        tx.onlineStore.findUnique({ where: { organizationId }, select: { displayName: true } }),
        tx.orgUser.findMany({
          where: { isActive: true, role: { in: [Role.OWNER, Role.MANAGER] } },
          select: { role: true, user: { select: { email: true } } },
        }),
      ]);
      const owners = staff.filter((s) => s.role === Role.OWNER);
      const chosen = owners.length > 0 ? owners : staff;
      const emails = Array.from(new Set(chosen.map((s) => s.user.email.trim().toLowerCase()).filter(Boolean)));
      return { emails, shopName: store?.displayName ?? org?.name ?? 'your shop' };
    });
  }

  private emailInvoice(invoice: CommissionInvoice) {
    return {
      invoiceNumber: invoice.invoiceNumber,
      periodMonth: invoice.periodMonth,
      orderCount: invoice.orderCount,
      salesTotal: Number(invoice.salesTotal),
      commissionTotal: Number(invoice.commissionTotal),
      amountDue: invoice.amountDue,
      dueDate: invoice.dueDate,
    };
  }

  private async sendReceipt(organizationId: string, invoice: CommissionInvoice, receipt: string) {
    try {
      const { emails, shopName } = await this.recipientsFor(organizationId);
      const built = buildReceiptEmail(this.emailInvoice(invoice), shopName, receipt.startsWith('TUMA:') ? null : receipt, false);
      for (const to of emails) await this.email.sendEmail({ to, ...built });
    } catch (e) {
      this.logger.warn({ err: e, organizationId }, 'Could not send the commission receipt email');
    }
  }

  // ── The daily automation ──────────────────────────────────────────────

  /**
   * Everything that used to need a person: roll finished months into
   * invoices, email each invoice (and the due-soon / overdue / shop-hidden
   * reminders), and catch payments whose callback never arrived. Safe to
   * run as often as you like - every step is idempotent (see
   * generateInvoices, nextReminderStage).
   */
  async runAutomation(opts: { sendEmails?: boolean; reconcile?: boolean } = {}) {
    const generated = await this.generateInvoices();
    const feeInvoices = await this.issueDailyFeeInvoices();
    // Re-checking pending payments is a paid call (KES 1 each), so the hourly
    // scheduler skips it (the free callback is the normal route); only a
    // person pressing "Run billing now" asks for it.
    const reconciled = opts.reconcile === false ? 0 : await this.reconcilePendingPayments();
    const notices = opts.sendEmails === false ? { sent: 0, skipped: 0 } : await this.sendDueNotices();
    const feeNotices = opts.sendEmails === false ? 0 : await this.sendFeeNotices();
    return { invoicesCreated: generated.created + feeInvoices, feeNoticesSent: feeNotices, paymentsConfirmed: reconciled, emailsSent: notices.sent, emailsSkipped: notices.skipped };
  }

  /** Invoices with an M-Pesa prompt out in the last day whose callback never arrived. */
  private async reconcilePendingPayments(): Promise<number> {
    if (!this.tuma.hasPlatformCredentials()) return 0;
    const since = new Date(Date.now() - RECONCILE_WINDOW_MS);
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    let confirmed = 0;
    for (const org of organizations) {
      const pending = await this.runAsTenant(org.id, (tx) =>
        tx.commissionInvoice.findMany({
          where: { status: CommissionInvoiceStatus.ISSUED, tumaMerchantRequestId: { not: null }, payAttemptedAt: { gt: since } },
          select: { id: true },
        }),
      );
      for (const { id } of pending) {
        const outcome = await this.verifyWithTuma(org.id, id).catch(() => 'unconfirmed' as const);
        if (outcome === 'paid') confirmed++;
      }
    }
    return confirmed;
  }

  /** Emails each unpaid invoice's next notice, once. A failed send is left to try again next run. */
  private async sendDueNotices(): Promise<{ sent: number; skipped: number }> {
    if (!this.email.isConfigured()) {
      this.logger.warn('RESEND_API_KEY is not set - commission invoice emails are not being sent');
      return { sent: 0, skipped: 0 };
    }
    const now = new Date();
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    let sent = 0;
    let skipped = 0;
    for (const org of organizations) {
      const due = await this.runAsTenant(org.id, async (tx) => {
        const open = await tx.commissionInvoice.findMany({
          where: { status: CommissionInvoiceStatus.ISSUED, kind: { not: FEE_KIND }, reminderStage: { lt: 4 } },
        });
        return open.flatMap((invoice) => {
          const stage = nextReminderStage(invoice, now);
          return stage ? [{ invoice, stage }] : [];
        });
      });
      if (due.length === 0) continue;

      const { emails, shopName } = await this.recipientsFor(org.id);
      if (emails.length === 0) {
        this.logger.warn({ organizationId: org.id }, 'No owner or manager email to send commission invoices to');
        skipped += due.length;
        continue;
      }
      for (const { invoice, stage } of due) {
        const built = buildInvoiceEmail(stage, this.emailInvoice(invoice), shopName, this.payUrl());
        let anySent = false;
        for (const to of emails) {
          const result = await this.email.sendEmail({ to, ...built });
          anySent = anySent || result.sent;
        }
        if (!anySent) {
          skipped++;
          continue;
        }
        sent++;
        await this.runAsTenant(org.id, (tx) =>
          tx.commissionInvoice.update({
            where: { id: invoice.id },
            // Never move backwards if a newer stage was recorded in the meantime.
            data: { reminderStage: Math.max(invoice.reminderStage, stage), emailedAt: invoice.emailedAt ?? new Date() },
          }),
        );
      }
    }
    return { sent, skipped };
  }

  // ── Shopper convenience fees: the shop collects them, then sends them to Zaroda ─────────────

  /**
   * Rolls every fee the shop has collected and not yet sent into ONE invoice (kind DAILY_FEE), due at once. Null when there
   * is nothing to send. Serialised per business, so two taps (or a tap and the nightly run) can never bill the same order twice.
   */
  private async settleFeesInTx(tx: TenantTx, organizationId: string, now: Date, before?: Date): Promise<CommissionInvoice | null> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'fee-settle:' + organizationId}))`;
    const orders = await tx.onlineOrder.findMany({ where: feeOrderWhere(before), select: { id: true, subtotal: true, convenienceFee: true } });
    const total = orders.reduce((sum, o) => sum + o.convenienceFee, 0);
    if (orders.length === 0 || total < 1) return null;

    const day = dayOf(now);
    const earlierToday = await tx.commissionInvoice.count({ where: { kind: FEE_KIND, periodMonth: { startsWith: `${day}#` } } });
    const { start, end } = dayBounds(day);
    let invoice: CommissionInvoice | undefined;
    for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
      try {
        invoice = await tx.commissionInvoice.create({
          data: {
            organizationId,
            kind: FEE_KIND,
            invoiceNumber: feeInvoiceNumber(day, randomInvoiceCode()),
            periodMonth: `${day}#${earlierToday + 1}`,
            periodStart: start,
            periodEnd: end,
            orderCount: orders.length,
            salesTotal: roundMoney(orders.reduce((sum, o) => sum + Number(o.subtotal), 0)),
            commissionTotal: total,
            amountDue: total,
            issuedAt: now,
            dueDate: now,
          },
        });
      } catch (e) {
        const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002' && JSON.stringify(e.meta?.target ?? '').includes('invoiceNumber');
        if (!collision) throw e;
      }
    }
    if (!invoice) throw new ConflictException('Could not allocate an invoice number - try again');
    await tx.onlineOrder.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { commissionInvoiceId: invoice.id } });
    return invoice;
  }

  /** "Send my fees now": the shop asks for the invoice early (it is also made automatically at the end of the day). */
  async settleFeesNow() {
    const { organizationId } = getTenantStore();
    const invoice = await this.tenantPrisma.run((tx) => this.settleFeesInTx(tx, organizationId, new Date()));
    if (!invoice) throw new BadRequestException('There are no shopper fees waiting to be sent right now');
    return toInvoiceView(invoice);
  }

  /**
   * End of the day (from 8pm, Nairobi): turn each shop's collected fees into an invoice. Before 8pm only earlier days are
   * caught up, so a shop that was missed (server asleep) is not left holding old fees. Returns how many invoices were made.
   */
  private async issueDailyFeeInvoices(now: Date = new Date()): Promise<number> {
    const before = nairobiHour(now) >= FEE_DAY_CLOSE_HOUR ? undefined : dayBounds(dayOf(now)).start;
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    let made = 0;
    for (const org of organizations) {
      try {
        const invoice = await this.runAsTenant(org.id, (tx) => this.settleFeesInTx(tx, org.id, now, before));
        if (invoice) made++;
      } catch (e) {
        this.logger.error({ err: e, organizationId: org.id }, 'Could not close the day\'s fees for a business');
      }
    }
    return made;
  }

  /**
   * Tells each shop to send an unpaid fee invoice: when it is issued, then once a day, on SMS (where the network accepts our
   * texts) and email. Stage = notices sent so far; the 4th says the shop is now hidden. Only 6am-10pm Nairobi time.
   */
  private async sendFeeNotices(now: Date = new Date()): Promise<number> {
    const hour = nairobiHour(now);
    if (hour < 6 || hour >= 22) return 0;
    const organizations = await this.prisma.organization.findMany({ select: { id: true } });
    let sent = 0;
    for (const org of organizations) {
      const open = await this.runAsTenant(org.id, async (tx) => {
        const found = await tx.commissionInvoice.findMany({ where: { status: CommissionInvoiceStatus.ISSUED, kind: FEE_KIND, reminderStage: { lt: 4 } } });
        const invoices = found.filter((invoice) => invoice.kind === FEE_KIND);
        const store = await tx.onlineStore.findUnique({ where: { organizationId: org.id }, select: { contactPhone: true } });
        return { invoices, phone: store?.contactPhone ?? null };
      });
      const due = open.invoices.flatMap((invoice) => {
        const wanted = Math.min(4, Math.floor((now.getTime() - invoice.issuedAt.getTime()) / DAY_MS) + 1);
        return wanted > invoice.reminderStage ? [{ invoice, stage: wanted as 1 | 2 | 3 | 4 }] : [];
      });
      if (due.length === 0) continue;

      const { emails, shopName } = await this.recipientsFor(org.id);
      const phone = open.phone ? normalizeKenyanPhone(open.phone) : null;
      for (const { invoice, stage } of due) {
        let delivered = false;
        if (phone) {
          const result = await this.sms.sendSms({ to: `+${phone}`, message: feeNoticeSms(stage, invoice.amountDue) }).catch(() => ({ sent: false }));
          delivered = result.sent;
        }
        if (this.email.isConfigured()) {
          const built = buildFeeNoticeEmail(stage, { invoiceNumber: invoice.invoiceNumber, amountDue: invoice.amountDue, orderCount: invoice.orderCount }, shopName, this.payUrl());
          for (const to of emails) {
            const result = await this.email.sendEmail({ to, ...built });
            delivered = delivered || result.sent;
          }
        }
        // In the app the shop is already reminded (pop-up and ring); a notice nobody could receive is tried again next run.
        if (!delivered) continue;
        sent++;
        await this.runAsTenant(org.id, (tx) =>
          tx.commissionInvoice.update({ where: { id: invoice.id }, data: { reminderStage: Math.max(invoice.reminderStage, stage), emailedAt: invoice.emailedAt ?? new Date() } }),
        );
      }
    }
    return sent;
  }

  // ── Invoice generation ────────────────────────────────────────────────

  /**
   * Rolls each business's completed-but-unbilled orders (and hotel bookings whose guest has checked out) into one
   * invoice per closed month. Safe to run as often as you like: an order is only
   * ever billed once (commissionInvoiceId), and a month that already has an
   * invoice is topped up only while that invoice is still unpaid.
   *
   * Loops organizations one at a time, in a transaction each - the same
   * documented pilot-scale pattern as PlatformAdminService (listing every
   * tenant's rows has no single query under per-tenant RLS).
   */
  async generateInvoices(opts: { month?: string } = {}) {
    if (opts.month !== undefined) {
      if (!isValidMonth(opts.month)) throw new BadRequestException('Month must look like 2026-10');
      if (!isMonthClosed(opts.month)) {
        throw new BadRequestException('That month has not ended yet - invoices can only be created once it has');
      }
    }
    const now = new Date();
    const currentMonthStart = monthBounds(monthOf(now)).start;
    const organizations = await this.prisma.organization.findMany({ select: { id: true, name: true } });

    const created: { organizationName: string; invoiceNumber: string; periodMonth: string; commissionTotal: number }[] = [];

    for (const org of organizations) {
      const invoices = await this.runAsTenant(org.id, async (tx) => {
        const orders = await tx.onlineOrder.findMany({
          where: {
            status: OnlineOrderStatus.COMPLETED,
            commissionInvoiceId: null,
            convenienceFee: 0,
            completedAt: { not: null, lt: currentMonthStart },
          },
          select: { id: true, subtotal: true, commissionAmount: true, completedAt: true },
        });
        // Hotel bookings count as well, once the guest has checked out: the commission is on the room price for the whole
        // stay (the "sale" the hotel made through Zaroda), never on the deposit the hotel chose. Billed once, like an order.
        const bookings = await tx.roomBooking.findMany({
          where: {
            status: RoomBookingStatus.CHECKED_OUT,
            commissionInvoiceId: null,
            paidAt: { not: null },
            checkedOutAt: { not: null, lt: currentMonthStart },
          },
          select: { id: true, total: true, commissionAmount: true, checkedOutAt: true },
        });
        type Billable = { id: string; kind: 'order' | 'booking'; sales: number; commission: number; at: Date };
        const billable: Billable[] = [
          ...orders.map((o) => ({ id: o.id, kind: 'order' as const, sales: Number(o.subtotal), commission: Number(o.commissionAmount ?? 0), at: o.completedAt! })),
          ...bookings.map((b) => ({ id: b.id, kind: 'booking' as const, sales: Number(b.total), commission: Number(b.commissionAmount ?? 0), at: b.checkedOutAt! })),
        ];
        const byMonth = new Map<string, Billable[]>();
        for (const item of billable) {
          const month = monthOf(item.at);
          if (opts.month && month !== opts.month) continue;
          byMonth.set(month, [...(byMonth.get(month) ?? []), item]);
        }
        const linkBilled = async (items: Billable[], invoiceId: string) => {
          const orderIds = items.filter((i) => i.kind === 'order').map((i) => i.id);
          const bookingIds = items.filter((i) => i.kind === 'booking').map((i) => i.id);
          if (orderIds.length > 0) await tx.onlineOrder.updateMany({ where: { id: { in: orderIds } }, data: { commissionInvoiceId: invoiceId } });
          if (bookingIds.length > 0) await tx.roomBooking.updateMany({ where: { id: { in: bookingIds } }, data: { commissionInvoiceId: invoiceId } });
        };

        const made: CommissionInvoice[] = [];
        for (const [month, monthItems] of Array.from(byMonth.entries())) {
          const salesTotal = roundMoney(monthItems.reduce((sum, i) => sum + i.sales, 0));
          const commissionTotal = roundMoney(monthItems.reduce((sum, i) => sum + i.commission, 0));
          const itemCount = monthItems.length;

          const existing = await tx.commissionInvoice.findUnique({
            where: { organizationId_periodMonth: { organizationId: org.id, periodMonth: month } },
          });
          if (existing) {
            if (existing.status !== CommissionInvoiceStatus.ISSUED) {
              this.logger.warn({ organizationId: org.id, month }, 'Completed orders found for a month whose invoice is already settled - left unbilled for review');
              continue;
            }
            await linkBilled(monthItems, existing.id);
            await tx.commissionInvoice.update({
              where: { id: existing.id },
              data: {
                orderCount: { increment: itemCount },
                salesTotal: { increment: salesTotal },
                commissionTotal: { increment: commissionTotal },
                amountDue: Math.ceil(roundMoney(Number(existing.commissionTotal) + commissionTotal)),
              },
            });
            continue;
          }

          const { start, end } = monthBounds(month);
          const issuedAt = new Date();
          let invoice: CommissionInvoice | undefined;
          for (let attempt = 0; attempt < 3 && !invoice; attempt++) {
            try {
              invoice = await tx.commissionInvoice.create({
                data: {
                  organizationId: org.id,
                  invoiceNumber: invoiceNumber(month, randomInvoiceCode()),
                  periodMonth: month,
                  periodStart: start,
                  periodEnd: end,
                  orderCount: itemCount,
                  salesTotal,
                  commissionTotal,
                  amountDue: Math.ceil(commissionTotal),
                  issuedAt,
                  dueDate: invoiceDueDate(issuedAt),
                },
              });
            } catch (e) {
              // Only a number collision is worth retrying; anything else is real.
              const collision =
                e instanceof Prisma.PrismaClientKnownRequestError &&
                e.code === 'P2002' &&
                JSON.stringify(e.meta?.target ?? '').includes('invoiceNumber');
              if (!collision) throw e;
            }
          }
          if (!invoice) throw new ConflictException('Could not allocate an invoice number - try again');
          await linkBilled(monthItems, invoice.id);
          made.push(invoice);
        }
        return made;
      });

      for (const invoice of invoices) {
        created.push({
          organizationName: org.name,
          invoiceNumber: invoice.invoiceNumber,
          periodMonth: invoice.periodMonth,
          commissionTotal: Number(invoice.commissionTotal),
        });
      }
    }
    return { created: created.length, invoices: created };
  }

  // ── Platform admin ────────────────────────────────────────────────────

  /** Every invoice, newest first - optionally one status, or one business. */
  async listInvoices(filter: { status?: CommissionInvoiceStatus; organizationId?: string } = {}) {
    const now = new Date();
    const organizations = await this.prisma.organization.findMany({
      where: filter.organizationId ? { id: filter.organizationId } : undefined,
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows: (ReturnType<typeof toInvoiceView> & { organizationId: string; organizationName: string })[] = [];
    for (const org of organizations) {
      const invoices = await this.runAsTenant(org.id, (tx) =>
        tx.commissionInvoice.findMany({ where: filter.status ? { status: filter.status } : undefined, orderBy: { periodMonth: 'desc' } }),
      );
      for (const invoice of invoices) {
        rows.push({ ...toInvoiceView(invoice, now), organizationId: org.id, organizationName: org.name });
      }
    }
    return rows.sort((a, b) => b.periodMonth.localeCompare(a.periodMonth) || a.organizationName.localeCompare(b.organizationName));
  }

  private async loadIssuedInvoice(tx: TenantTx, invoiceId: string) {
    const invoice = await tx.commissionInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== CommissionInvoiceStatus.ISSUED) {
      throw new ConflictException(`This invoice is already ${invoice.status.toLowerCase()}`);
    }
    return invoice;
  }

  /** For money that arrived outside Tuma (bank transfer, cash) - the online route settles itself. */
  async recordPayment(
    organizationId: string,
    invoiceId: string,
    dto: { method: string; reference?: string },
    platformAdminId: string,
  ) {
    const invoice = await this.runAsTenant(organizationId, async (tx) => {
      await this.loadIssuedInvoice(tx, invoiceId);
      // Conditional on still being ISSUED, so two admins recording at once can't both succeed.
      const result = await tx.commissionInvoice.updateMany({
        where: { id: invoiceId, status: CommissionInvoiceStatus.ISSUED },
        data: {
          status: CommissionInvoiceStatus.PAID,
          paidAt: new Date(),
          paymentMethod: dto.method,
          paymentReference: dto.reference?.trim() || null,
          recordedByPlatformAdminId: platformAdminId,
        },
      });
      if (result.count === 0) throw new ConflictException('This invoice was just updated by someone else - refresh');
      return tx.commissionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    await this.sendReceipt(organizationId, invoice, dto.reference?.trim() ?? '');
    return toInvoiceView(invoice);
  }

  async waive(organizationId: string, invoiceId: string, reason: string, platformAdminId: string) {
    const invoice = await this.runAsTenant(organizationId, async (tx) => {
      await this.loadIssuedInvoice(tx, invoiceId);
      const result = await tx.commissionInvoice.updateMany({
        where: { id: invoiceId, status: CommissionInvoiceStatus.ISSUED },
        data: {
          status: CommissionInvoiceStatus.WAIVED,
          waivedReason: reason.trim(),
          recordedByPlatformAdminId: platformAdminId,
        },
      });
      if (result.count === 0) throw new ConflictException('This invoice was just updated by someone else - refresh');
      return tx.commissionInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    return toInvoiceView(invoice);
  }
}
