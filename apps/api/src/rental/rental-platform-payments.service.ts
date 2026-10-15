import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, RentalPlatformInvoice } from '@prisma/client';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ResendEmailProvider } from '../notifications/resend-email.provider';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { TumaClient } from '../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { RentalPlatformBillingService, toPlatformInvoiceView } from './rental-platform-billing.service';
import { PlatformInvoiceKind } from './rental-platform-billing.util';
import { buildPlatformReceiptEmail } from './rental-platform-invoice-email';
import { RENTAL_PLANS, isPlanCode } from './rental-plans.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };
// A second prompt before this would risk two live M-Pesa prompts for one invoice.
const PAY_RETRY_COOLDOWN_MS = 60_000;
// "Check now" is a paid Tuma status check (KES 1, charged to ZARODA), so it is rate limited.
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_INVOICE = 5;

/** The first this many paying landlords keep their launch price for FOUNDING_MONTHS. */
export const FOUNDING_LANDLORD_LIMIT = 20;
export const FOUNDING_MONTHS = 12;

/**
 * Landlords paying ZARODA for the rental plan through ZARODA's own Tuma account (the same way a shop pays its
 * commission), plus what a platform admin does by hand: record a bank or cash payment, waive an invoice.
 * Tuma's free webhook is how a payment is normally learned; the paid status check is only an explicit backup.
 */
@Injectable()
export class RentalPlatformPaymentsService {
  private readonly logger = new Logger(RentalPlatformPaymentsService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly email: ResendEmailProvider,
    private readonly config: ConfigService,
    private readonly billing: RentalPlatformBillingService,
  ) {}

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** False until ZARODA's Tuma account is configured on this server. */
  canPayOnline(): boolean {
    return this.tuma.hasPlatformCredentials();
  }

  // ── Callback address (same trust model as the shop commission) ──────────

  private callbackToken(invoiceId: string): string {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    return createHmac('sha256', key).update(`rental-platform-callback:${invoiceId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, invoiceId: string): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/rental-platform/${organizationId}/${invoiceId}/tuma-callback/${this.callbackToken(invoiceId)}`;
  }

  // ── The landlord pays ───────────────────────────────────────────────────

  /** Sends an M-Pesa prompt for the invoice. The money lands in ZARODA's Tuma account. */
  async payOnline(invoiceId: string, phoneInput: string) {
    const { organizationId } = getTenantStore();
    const phone = normalizeKenyanPhone(phoneInput);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    const credentials = this.tuma.platformCredentials();

    const invoice = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.rentalPlatformInvoice.findUnique({ where: { id: invoiceId } });
      if (!current) throw new NotFoundException('Invoice not found');
      if (current.status !== 'ISSUED') throw new ConflictException(`This invoice is already ${current.status.toLowerCase()}`);
      if (current.amountDue < 1) throw new BadRequestException('This invoice has nothing to pay');
      if (current.payAttemptedAt && !current.lastPaymentError && Date.now() - current.payAttemptedAt.getTime() < PAY_RETRY_COOLDOWN_MS) {
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
        description: `ZARODA rentals ${invoice.invoiceNumber}`,
        callbackUrl: this.callbackUrl(organizationId, invoice.id),
      });
      merchantRequestId = result.merchantRequestId;
    } catch (e) {
      lastPaymentError = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, invoiceId }, 'Rental invoice STK push failed');
    }

    const updated = await this.tenantPrisma.run((tx) =>
      tx.rentalPlatformInvoice.update({
        where: { id: invoiceId },
        data: { payPhone: phone, payAttemptedAt: new Date(), lastPaymentError, ...(merchantRequestId ? { tumaMerchantRequestId: merchantRequestId } : {}) },
      }),
    );
    return toPlatformInvoiceView(updated);
  }

  /**
   * "Check now" - the landlord's backup when Tuma's callback has not arrived. Each call is a paid Tuma status check
   * (KES 1, charged to ZARODA), so it has a cooldown and a cap per invoice; the screen itself refreshes with free reads.
   */
  async checkPayment(invoiceId: string) {
    const { organizationId } = getTenantStore();
    const find = () => this.tenantPrisma.run((tx) => tx.rentalPlatformInvoice.findUnique({ where: { id: invoiceId } }));
    let invoice = await find();
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'ISSUED' || !invoice.tumaMerchantRequestId) return { ...toPlatformInvoiceView(invoice), checkResult: 'not-needed' as const };

    const state = this.checks.get(invoice.id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    if (state.count >= MAX_CHECKS_PER_INVOICE) throw new BadRequestException('This invoice has been checked several times already - please contact Zaroda with your M-Pesa message');
    this.checks.set(invoice.id, { last: Date.now(), count: state.count + 1 });

    const outcome = await this.verifyWithTuma(organizationId, invoice.id).catch(() => 'unavailable' as const);
    invoice = (await find()) ?? invoice;
    const checkResult = outcome === 'paid' ? 'paid' : outcome === 'unconfirmed' ? 'not-paid-yet' : outcome === 'unavailable' ? 'unavailable' : 'not-needed';
    return { ...toPlatformInvoiceView(invoice), checkResult } as ReturnType<typeof toPlatformInvoiceView> & { checkResult: 'paid' | 'not-paid-yet' | 'unavailable' | 'not-needed' };
  }

  /**
   * Tuma's webhook (free): the HMAC in the URL proves it came from Tuma, and the body itself must be complete and
   * consistent (evaluateCallback). An incomplete callback is never acted on as-is - it triggers one paid check instead.
   */
  async handleTumaCallback(organizationId: string, invoiceId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(invoiceId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();

    // Field NAMES and the status word only - never amounts or receipts.
    this.logger.log({ invoiceId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma rental invoice callback received');
    const invoice = await this.runAsTenant(organizationId, (tx) => tx.rentalPlatformInvoice.findUnique({ where: { id: invoiceId } }));
    if (!invoice) throw new NotFoundException();
    if (invoice.status !== 'ISSUED') return { ok: true };

    const verdict = evaluateCallback(body, { amount: invoice.amountDue, latestRequestId: invoice.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, invoice, 'MPESA', verdict.receipt, merchantRequestId ?? invoice.tumaMerchantRequestId ?? undefined);
        break;
      case 'review':
        this.logger.error({ invoiceId, detail: verdict.detail }, 'Tuma reported a rental invoice payment that does not match the invoice - needs manual review');
        await this.flag(organizationId, invoiceId, `A payment was received that does not match this invoice (${verdict.detail}). Contact Zaroda.`);
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
    return this.runAsTenant(organizationId, (tx) => tx.rentalPlatformInvoice.update({ where: { id: invoiceId }, data: { lastPaymentError: message } }));
  }

  /** The paid backup: asks Tuma whether the invoice's latest payment went through. Only a confirmed full payment settles it. */
  private async verifyWithTuma(organizationId: string, invoiceId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const invoice = await this.runAsTenant(organizationId, (tx) => tx.rentalPlatformInvoice.findUnique({ where: { id: invoiceId } }));
    if (!invoice || invoice.status !== 'ISSUED') return 'skipped';
    const requestId = invoice.tumaMerchantRequestId;
    if (!requestId || !this.tuma.hasPlatformCredentials()) return 'skipped';

    const confirmation = await this.tuma.confirmPayment(this.tuma.platformCredentials(), requestId, invoice.amountDue);
    if (confirmation.outcome === 'review') {
      this.logger.error({ invoiceId, detail: confirmation.detail }, 'Tuma reported a rental invoice payment that does not match the invoice - needs manual review');
      await this.flag(organizationId, invoiceId, `A payment was received that does not match this invoice (${confirmation.detail}). Contact Zaroda.`);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      this.logger.error({ invoiceId, detail: confirmation.detail }, "Could not check this rental invoice payment with Tuma (is ZARODA's Tuma account out of credits?)");
      await this.flag(organizationId, invoiceId, 'We could not confirm the payment just now. If you have paid, Zaroda will confirm it - or try again in a few minutes.');
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';
    return (await this.settle(organizationId, invoice, 'MPESA', confirmation.mpesaReceipt?.trim() || `TUMA:${requestId}`, requestId)) === 'paid' ? 'paid' : 'skipped';
  }

  /**
   * Marks the invoice PAID and emails a receipt. Conditional on still being ISSUED, so a callback, a "check now" and a
   * platform admin recording it by hand at the same moment settle it - and send the receipt - only once. The first
   * landlords to pay also get the founding-price offer.
   */
  private async settle(
    organizationId: string,
    invoice: RentalPlatformInvoice,
    method: string,
    reference: string,
    requestId?: string,
    recordedByPlatformAdminId?: string,
  ): Promise<'paid' | 'skipped'> {
    const settled = await this.runAsTenant(organizationId, async (tx) => {
      const result = await tx.rentalPlatformInvoice.updateMany({
        where: { id: invoice.id, status: 'ISSUED' },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentMethod: method,
          paymentReference: reference || null,
          lastPaymentError: null,
          ...(requestId ? { tumaMerchantRequestId: requestId } : {}),
          ...(recordedByPlatformAdminId ? { recordedByPlatformAdminId } : {}),
        },
      });
      return result.count === 1 ? tx.rentalPlatformInvoice.findUniqueOrThrow({ where: { id: invoice.id } }) : null;
    });
    if (!settled) return 'skipped';
    await this.claimFoundingOffer(organizationId).catch((e) => this.logger.warn({ err: e, organizationId }, 'Could not record the founding offer'));
    await this.sendReceipt(organizationId, settled, reference);
    return 'paid';
  }

  /**
   * One of the first FOUNDING_LANDLORD_LIMIT landlords to pay: keeps the launch price for FOUNDING_MONTHS (recorded as
   * foundingPriceUntil). Counted across all landlords under a lock, so two first payments cannot both take the last place.
   */
  async claimFoundingOffer(organizationId: string, now: Date = new Date()): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('zaroda-rental-founding-offer'))`;
      const asOrg = async <T>(id: string, fn: () => Promise<T>) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${id}, true)`;
        return fn();
      };
      const mine = await asOrg(organizationId, () => tx.rentalSettings.findUnique({ where: { organizationId }, select: { foundingPriceUntil: true } }));
      if (!mine || mine.foundingPriceUntil) return false;

      const organizations = await tx.organization.findMany({ where: { industryType: 'RENTAL' }, select: { id: true } });
      let taken = 0;
      for (const org of organizations) {
        taken += await asOrg(org.id, () => tx.rentalSettings.count({ where: { organizationId: org.id, foundingPriceUntil: { not: null } } }));
      }
      if (taken >= FOUNDING_LANDLORD_LIMIT) return false;

      const until = new Date(now);
      until.setUTCMonth(until.getUTCMonth() + FOUNDING_MONTHS);
      await asOrg(organizationId, () => tx.rentalSettings.update({ where: { organizationId }, data: { foundingPriceUntil: until } }));
      return true;
    }, TX_OPTIONS);
  }

  private async sendReceipt(organizationId: string, invoice: RentalPlatformInvoice, reference: string) {
    try {
      if (!this.email.isConfigured()) return;
      const { emails, name } = await this.billing.recipientsFor(organizationId);
      if (emails.length === 0) return;
      const built = buildPlatformReceiptEmail(
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
        reference || null,
      );
      for (const to of emails) await this.email.sendEmail({ to, ...built });
    } catch (e) {
      // The payment is already recorded; a failed receipt email must never undo or hide that.
      this.logger.warn({ err: e, organizationId }, 'Could not send the rental invoice receipt');
    }
  }

  // ── Platform admin ──────────────────────────────────────────────────────

  /** Every landlord's invoices, newest first - optionally one status, or one landlord. */
  async listInvoices(filter: { status?: 'ISSUED' | 'PAID' | 'WAIVED'; organizationId?: string } = {}) {
    const now = new Date();
    const organizations = await this.prisma.organization.findMany({
      where: { industryType: 'RENTAL', ...(filter.organizationId ? { id: filter.organizationId } : {}) },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const rows: (ReturnType<typeof toPlatformInvoiceView> & { organizationId: string; organizationName: string; foundingPriceUntil: Date | null })[] = [];
    for (const org of organizations) {
      const { invoices, founding } = await this.runAsTenant(org.id, async (tx) => ({
        invoices: await tx.rentalPlatformInvoice.findMany({ where: filter.status ? { status: filter.status } : undefined, orderBy: { invoiceMonth: 'desc' } }),
        founding: (await tx.rentalSettings.findUnique({ where: { organizationId: org.id }, select: { foundingPriceUntil: true } }))?.foundingPriceUntil ?? null,
      }));
      for (const invoice of invoices) rows.push({ ...toPlatformInvoiceView(invoice, now), organizationId: org.id, organizationName: org.name, foundingPriceUntil: founding });
    }
    return rows.sort((a, b) => b.invoiceMonth.localeCompare(a.invoiceMonth) || a.organizationName.localeCompare(b.organizationName));
  }

  private async loadIssued(tx: Tx, invoiceId: string) {
    const invoice = await tx.rentalPlatformInvoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (invoice.status !== 'ISSUED') throw new ConflictException(`This invoice is already ${invoice.status.toLowerCase()}`);
    return invoice;
  }

  /** For money that arrived outside Tuma (bank transfer, cash) - the online route settles itself. */
  async recordPayment(organizationId: string, invoiceId: string, dto: { method: string; reference?: string }, platformAdminId: string) {
    const invoice = await this.runAsTenant(organizationId, (tx) => this.loadIssued(tx, invoiceId));
    const outcome = await this.settle(organizationId, invoice, dto.method, dto.reference?.trim() ?? '', undefined, platformAdminId);
    if (outcome === 'skipped') throw new ConflictException('This invoice was just updated by someone else - refresh');
    return toPlatformInvoiceView(await this.runAsTenant(organizationId, (tx) => tx.rentalPlatformInvoice.findUniqueOrThrow({ where: { id: invoiceId } })));
  }

  async waive(organizationId: string, invoiceId: string, reason: string, platformAdminId: string) {
    const invoice = await this.runAsTenant(organizationId, async (tx) => {
      await this.loadIssued(tx, invoiceId);
      const result = await tx.rentalPlatformInvoice.updateMany({
        where: { id: invoiceId, status: 'ISSUED' },
        data: { status: 'WAIVED', waivedReason: reason.trim(), recordedByPlatformAdminId: platformAdminId },
      });
      if (result.count === 0) throw new ConflictException('This invoice was just updated by someone else - refresh');
      return tx.rentalPlatformInvoice.findUniqueOrThrow({ where: { id: invoiceId } });
    });
    return toPlatformInvoiceView(invoice);
  }

  /** "Run billing now": this month's invoices and any notices that are due, for every rental landlord. */
  async runNow() {
    const organizations = await this.prisma.organization.findMany({ where: { industryType: 'RENTAL' }, select: { id: true } });
    let invoicesCreated = 0;
    let emailsSent = 0;
    for (const org of organizations) {
      const made = await this.runAsTenant(org.id, (tx) => this.billing.generateForOrganization(tx, org.id));
      invoicesCreated += made.length;
      emailsSent += await this.billing.sendNotices(org.id);
    }
    return { invoicesCreated, emailsSent };
  }
}
