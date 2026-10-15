import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { assertFeature, loadPlan } from './rental-plans.service';
import { planHas } from './rental-plans.util';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { fromCents, nairobiToday, toCents } from './rental-billing.util';
import { buildReminderEmail, buildReminderSms, buildTenantInviteEmail, reminderStage, ReminderFacts, ReminderStage } from './rental-reminders.util';
import { UpdateReminderSettingsDto } from './dto/rental-ops.dto';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
// Nobody wants a rent reminder at 3am. Nairobi is UTC+3 all year.
const SEND_FROM_HOUR = 8;
const SEND_UNTIL_HOUR = 20;

/**
 * Rent reminders by email (and SMS, when the landlord turns it on and Africa's Talking is set up). Off by default;
 * the landlord switches it on and writes how tenants should pay. Each reminder stage is sent once per invoice and
 * channel: the log row is claimed BEFORE sending (a unique key), so even two server instances running at once, or a
 * crash half-way, can never send the same reminder twice - a failed send releases its claim so the next run retries.
 */
@Injectable()
export class RentalRemindersService {
  private readonly logger = new Logger(RentalRemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly email: ResendEmailProvider,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private smsConfigured(): boolean {
    return Boolean(this.config.get<string>('AFRICAS_TALKING_API_KEY') && this.config.get<string>('AFRICAS_TALKING_USERNAME'));
  }

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  // ── Settings ────────────────────────────────────────────────────────────

  private view(s: { remindersEnabled: boolean; smsReminders: boolean; paymentInstructions: string | null } | null) {
    return {
      remindersEnabled: s?.remindersEnabled ?? false,
      smsReminders: s?.smsReminders ?? false,
      paymentInstructions: s?.paymentInstructions ?? '',
      emailAvailable: this.email.isConfigured(),
      smsAvailable: this.smsConfigured(),
    };
  }

  async getSettings() {
    const { organizationId } = getTenantStore();
    return this.view(await this.tenantPrisma.run((tx) => tx.rentalSettings.findUnique({ where: { organizationId } })));
  }

  async updateSettings(dto: UpdateReminderSettingsDto) {
    const { organizationId } = getTenantStore();
    const data = {
      remindersEnabled: dto.remindersEnabled,
      smsReminders: dto.smsReminders,
      paymentInstructions: dto.paymentInstructions === undefined ? undefined : dto.paymentInstructions.trim() || null,
    };
    const s = await this.tenantPrisma.run(async (tx) => {
      // Switching reminders on is part of Starter and above (switching them off is always allowed).
      if (dto.remindersEnabled || dto.smsReminders) await assertFeature(tx, organizationId, 'reminders');
      return tx.rentalSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
    });
    return this.view(s);
  }

  // ── Gathering what is owed ──────────────────────────────────────────────

  private async loadLease(tx: Tx, leaseId: string) {
    return tx.rentalLease.findUnique({
      where: { id: leaseId },
      include: {
        tenant: { select: { name: true, phone: true, email: true } },
        unit: { select: { label: true, property: { select: { name: true } } } },
        invoices: true,
      },
    });
  }

  // ── Inviting a tenant to their own account ─────────────────────────────

  /** Emails the tenant a link to sign in at the tenant portal (they sign in with a code sent to this same address). */
  async sendPortalInvite(tenantId: string) {
    const { organizationId } = getTenantStore();
    const { tenant, org } = await this.tenantPrisma.run(async (tx) => ({
      // The tenant portal is part of Starter and above.
      plan: await assertFeature(tx, organizationId, 'portal'),
      tenant: await tx.rentalTenant.findUnique({ where: { id: tenantId }, select: { name: true, email: true } }),
      org: await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    }));
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (!tenant.email) throw new BadRequestException('Add this tenant\'s email address first - it is how they sign in');
    if (!this.email.isConfigured()) throw new BadRequestException('Email sending is not set up on this server yet');
    const base = (this.config.get<string>('STOREFRONT_BASE_URL') ?? 'https://shop.zarodashop.com').replace(/\/+$/, '');
    const mail = buildTenantInviteEmail({ business: org?.name ?? '', tenantName: tenant.name, url: `${base}/tenant` });
    const result = await this.email.sendEmail({ to: tenant.email, ...mail });
    if (!result.sent) throw new BadRequestException('The invite could not be sent just now - please try again');
    return { sent: true, email: tenant.email };
  }

  // ── A reminder the landlord sends by hand ───────────────────────────────

  async sendManual(leaseId: string) {
    const { organizationId } = getTenantStore();
    const today = nairobiToday();
    const { lease, settings, org } = await this.tenantPrisma.run(async (tx) => ({
      plan: await assertFeature(tx, organizationId, 'reminders'),
      lease: await this.loadLease(tx, leaseId),
      settings: await tx.rentalSettings.findUnique({ where: { organizationId } }),
      org: await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
    }));
    if (!lease) throw new NotFoundException('Lease not found');

    const open = lease.invoices
      .filter((i) => toCents(i.amountDue) - toCents(i.amountPaid) > 0)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    if (open.length === 0) throw new BadRequestException('This tenant owes nothing right now');
    const totalBalance = fromCents(open.reduce((s, i) => s + toCents(i.amountDue) - toCents(i.amountPaid), 0));
    const first = open[0];

    const facts: ReminderFacts = {
      business: org?.name ?? '',
      tenantName: lease.tenant.name,
      property: lease.unit.property.name,
      unit: lease.unit.label,
      description: first.description ?? 'Rent',
      amount: fromCents(toCents(first.amountDue) - toCents(first.amountPaid)),
      totalBalance,
      dueDate: first.dueDate,
      stage: first.dueDate < today ? 'OVERDUE' : 'MANUAL',
      instructions: settings?.paymentInstructions,
    };

    const result: { email: 'sent' | 'failed' | 'no-address' | 'not-set-up'; sms: 'sent' | 'failed' | 'no-number' | 'off' | 'not-set-up' } = {
      email: 'no-address',
      sms: 'off',
    };
    if (lease.tenant.email) {
      if (!this.email.isConfigured()) result.email = 'not-set-up';
      else result.email = (await this.email.sendEmail({ to: lease.tenant.email, ...buildReminderEmail(facts) })).sent ? 'sent' : 'failed';
    }
    if (settings?.smsReminders) {
      const phone = lease.tenant.phone ? normalizeKenyanPhone(lease.tenant.phone) : null;
      if (!phone) result.sms = 'no-number';
      else if (!this.smsConfigured()) result.sms = 'not-set-up';
      else result.sms = (await this.sms.sendSms({ to: `+${phone}`, message: buildReminderSms(facts) })).sent ? 'sent' : 'failed';
    }
    if (result.email !== 'sent' && result.sms !== 'sent') {
      throw new BadRequestException(
        lease.tenant.email || (settings?.smsReminders && lease.tenant.phone)
          ? 'The reminder could not be sent just now - please try again, or call the tenant'
          : 'This tenant has no email address (add one on the Tenants tab), and SMS reminders are off',
      );
    }
    return result;
  }

  // ── The automatic reminders ─────────────────────────────────────────────

  /** One pass for one landlord. Returns how many reminders went out. Called by the hourly scheduler. */
  async runForOrganization(organizationId: string, now: Date = new Date()): Promise<number> {
    const nairobiHour = (now.getUTCHours() + 3) % 24;
    if (nairobiHour < SEND_FROM_HOUR || nairobiHour >= SEND_UNTIL_HOUR) return 0;
    const today = nairobiToday(now);

    const { settings, org, leases, plan } = await this.runAsTenant(organizationId, async (tx) => ({
      plan: await loadPlan(tx, organizationId, now),
      settings: await tx.rentalSettings.findUnique({ where: { organizationId } }),
      org: await tx.organization.findUnique({ where: { id: organizationId }, select: { name: true } }),
      leases: await tx.rentalLease.findMany({
        where: { status: 'ACTIVE' },
        include: {
          tenant: { select: { name: true, phone: true, email: true } },
          unit: { select: { label: true, property: { select: { name: true } } } },
          invoices: true,
        },
      }),
    }));
    if (!settings?.remindersEnabled || !planHas(plan, 'reminders')) return 0;
    const emailOn = this.email.isConfigured();
    const smsOn = settings.smsReminders && this.smsConfigured();
    if (!emailOn && !smsOn) return 0;

    let sent = 0;
    for (const lease of leases) {
      const owing = lease.invoices.filter((i) => i.kind !== 'DEPOSIT' && toCents(i.amountDue) - toCents(i.amountPaid) > 0);
      if (owing.length === 0) continue;
      const totalBalance = fromCents(lease.invoices.reduce((s, i) => s + Math.max(toCents(i.amountDue) - toCents(i.amountPaid), 0), 0));

      for (const invoice of owing) {
        const stage = reminderStage(invoice.dueDate, today);
        if (!stage) continue;
        const facts: ReminderFacts = {
          business: org?.name ?? '',
          tenantName: lease.tenant.name,
          property: lease.unit.property.name,
          unit: lease.unit.label,
          description: invoice.description ?? 'Rent',
          amount: fromCents(toCents(invoice.amountDue) - toCents(invoice.amountPaid)),
          totalBalance,
          dueDate: invoice.dueDate,
          stage,
          instructions: settings.paymentInstructions,
        };
        if (emailOn && lease.tenant.email) {
          sent += await this.deliver(organizationId, invoice.id, stage, 'EMAIL', async () =>
            (await this.email.sendEmail({ to: lease.tenant.email as string, ...buildReminderEmail(facts) })).sent,
          );
        }
        const phone = lease.tenant.phone ? normalizeKenyanPhone(lease.tenant.phone) : null;
        if (smsOn && phone) {
          sent += await this.deliver(organizationId, invoice.id, stage, 'SMS', async () =>
            (await this.sms.sendSms({ to: `+${phone}`, message: buildReminderSms(facts) })).sent,
          );
        }
      }
    }
    if (sent > 0) this.logger.log({ organizationId, sent }, 'Rent reminders sent');
    return sent;
  }

  /** Claims (invoice, stage, channel) first, then sends; a failed send gives the claim back so the next run retries. */
  private async deliver(organizationId: string, invoiceId: string, stage: ReminderStage, channel: 'EMAIL' | 'SMS', send: () => Promise<boolean>): Promise<number> {
    let claimId: string;
    try {
      claimId = (
        await this.runAsTenant(organizationId, (tx) => tx.rentalReminderLog.create({ data: { organizationId, invoiceId, stage, channel } }))
      ).id;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return 0; // already sent
      throw e;
    }
    let ok = false;
    try {
      ok = await send();
    } catch (e) {
      this.logger.warn({ err: e, invoiceId, channel }, 'Rent reminder send threw');
    }
    if (!ok) {
      await this.runAsTenant(organizationId, (tx) => tx.rentalReminderLog.deleteMany({ where: { id: claimId } })).catch(() => undefined);
      return 0;
    }
    return 1;
  }
}
