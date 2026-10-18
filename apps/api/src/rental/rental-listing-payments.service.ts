import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { TumaClient } from '../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { LISTING_FEE_KES, extendPaidUntil } from './rental-listing-fee.util';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 15_000 };
// A second prompt before this would risk two live M-Pesa prompts for one advert.
const PAY_RETRY_COOLDOWN_MS = 60_000;
// "Check now" is a paid Tuma status check (KES 1, charged to ZARODA), so it is rate limited.
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_PAYMENT = 5;

/**
 * Landlords paying ZARODA KES 100 per advert, per 30 days, through ZARODA's own Tuma account - the same trust model as
 * the rental plan invoices: Tuma's free webhook (HMAC in the URL, body checked) is how a payment is normally learned,
 * and the paid status check is only an explicit, rate-limited backup.
 */
@Injectable()
export class RentalListingPaymentsService {
  private readonly logger = new Logger(RentalListingPaymentsService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly config: ConfigService,
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

  private callbackToken(paymentId: string): string {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    return createHmac('sha256', key).update(`rental-listing-callback:${paymentId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, paymentId: string): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/rental-listing-payments/${organizationId}/${paymentId}/tuma-callback/${this.callbackToken(paymentId)}`;
  }

  // ── The landlord pays ───────────────────────────────────────────────────

  /** Sends an M-Pesa prompt for KES 100. The money lands in ZARODA's Tuma account. */
  async pay(listingId: string, phoneInput: string) {
    const { organizationId } = getTenantStore();
    const phone = normalizeKenyanPhone(phoneInput);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    if (!this.canPayOnline()) throw new ServiceUnavailableException('Online payments are not available right now. Please try again later.');
    const credentials = this.tuma.platformCredentials();

    const payment = await this.tenantPrisma.run(async (tx) => {
      const listing = await tx.rentalListing.findUnique({ where: { id: listingId } });
      if (!listing) throw new NotFoundException('Advert not found');
      const unit = await tx.rentalUnit.findUnique({ where: { id: listing.unitId } });
      if (unit?.status !== 'VACANT') throw new ConflictException('Only an empty unit can be advertised.');
      const recent = await tx.rentalListingPayment.findFirst({ where: { listingId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } });
      if (recent && Date.now() - recent.createdAt.getTime() < PAY_RETRY_COOLDOWN_MS) {
        throw new BadRequestException('Check your phone for the M-Pesa prompt - you can try again in a minute');
      }
      // Any older unanswered prompt is finished with; the new one replaces it.
      await tx.rentalListingPayment.updateMany({ where: { listingId, status: 'PENDING' }, data: { status: 'FAILED', errorMessage: 'Replaced by a newer prompt' } });
      return tx.rentalListingPayment.create({ data: { organizationId, listingId, amount: LISTING_FEE_KES, phone } });
    });

    try {
      const result = await this.tuma.stkPush(credentials, {
        amount: LISTING_FEE_KES,
        phone,
        description: 'ZARODA house advert',
        callbackUrl: this.callbackUrl(organizationId, payment.id),
      });
      await this.tenantPrisma.run((tx) =>
        tx.rentalListingPayment.update({ where: { id: payment.id }, data: { tumaMerchantRequestId: result.merchantRequestId } }),
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, listingId }, 'Advert payment STK push failed');
      await this.tenantPrisma.run((tx) => tx.rentalListingPayment.update({ where: { id: payment.id }, data: { status: 'FAILED', errorMessage: message } }));
      throw new BadRequestException(`We could not send the M-Pesa prompt: ${message}`);
    }
    return { paymentId: payment.id, status: 'PENDING' as const, amount: LISTING_FEE_KES };
  }

  /** "Check now" - the backup when Tuma's callback has not arrived. A paid Tuma status check, so rate limited. */
  async check(listingId: string) {
    const { organizationId } = getTenantStore();
    const payment = await this.tenantPrisma.run((tx) => tx.rentalListingPayment.findFirst({ where: { listingId, status: 'PENDING' }, orderBy: { createdAt: 'desc' } }));
    if (!payment || !payment.tumaMerchantRequestId) return { result: 'nothing-pending' as const };

    const state = this.checks.get(payment.id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    if (state.count >= MAX_CHECKS_PER_PAYMENT) throw new BadRequestException('This payment has been checked several times already - please contact Zaroda with your M-Pesa message');
    this.checks.set(payment.id, { last: Date.now(), count: state.count + 1 });

    const outcome = await this.verifyWithTuma(organizationId, payment.id).catch(() => 'unavailable' as const);
    return { result: outcome === 'paid' ? ('paid' as const) : outcome === 'unavailable' ? ('unavailable' as const) : ('not-paid-yet' as const) };
  }

  /** Tuma's webhook: the HMAC in the URL proves it came from Tuma, and the body must be complete and consistent. */
  async handleTumaCallback(organizationId: string, paymentId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(paymentId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();

    // Field NAMES and the status word only - never amounts or receipts.
    this.logger.log({ paymentId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma advert payment callback received');
    const payment = await this.runAsTenant(organizationId, (tx) => tx.rentalListingPayment.findUnique({ where: { id: paymentId } }));
    if (!payment) throw new NotFoundException();
    if (payment.status !== 'PENDING') return { ok: true };

    const verdict = evaluateCallback(body, { amount: payment.amount, latestRequestId: payment.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, payment.id, verdict.receipt);
        break;
      case 'review':
        this.logger.error({ paymentId, detail: verdict.detail }, 'Tuma reported an advert payment that does not match - needs manual review');
        await this.fail(organizationId, paymentId, `A payment was received that does not match this advert (${verdict.detail}). Contact Zaroda.`, false);
        break;
      case 'failed':
        if (!merchantRequestId || !payment.tumaMerchantRequestId || merchantRequestId === payment.tumaMerchantRequestId) {
          await this.fail(organizationId, paymentId, 'The M-Pesa payment was cancelled or failed - try again', true);
        }
        break;
      case 'needs-check':
        this.logger.warn({ paymentId, reason: verdict.reason }, 'Callback was not complete enough to trust - asking Tuma (KES 1)');
        await this.verifyWithTuma(organizationId, paymentId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return { ok: true };
  }

  private fail(organizationId: string, paymentId: string, message: string, final: boolean) {
    return this.runAsTenant(organizationId, (tx) =>
      tx.rentalListingPayment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { errorMessage: message, ...(final ? { status: 'FAILED' } : {}) } }),
    );
  }

  /** The paid backup: asks Tuma whether this payment went through. Only a confirmed full payment settles it. */
  private async verifyWithTuma(organizationId: string, paymentId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const payment = await this.runAsTenant(organizationId, (tx) => tx.rentalListingPayment.findUnique({ where: { id: paymentId } }));
    if (!payment || payment.status !== 'PENDING') return 'skipped';
    const requestId = payment.tumaMerchantRequestId;
    if (!requestId || !this.tuma.hasPlatformCredentials()) return 'skipped';

    const confirmation = await this.tuma.confirmPayment(this.tuma.platformCredentials(), requestId, payment.amount);
    if (confirmation.outcome === 'review') {
      this.logger.error({ paymentId, detail: confirmation.detail }, 'Tuma reported an advert payment that does not match - needs manual review');
      await this.fail(organizationId, paymentId, `A payment was received that does not match this advert (${confirmation.detail}). Contact Zaroda.`, false);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      this.logger.error({ paymentId, detail: confirmation.detail }, "Could not check this advert payment with Tuma (is ZARODA's Tuma account out of credits?)");
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';
    return (await this.settle(organizationId, paymentId, confirmation.mpesaReceipt?.trim() || `TUMA:${requestId}`)) === 'paid' ? 'paid' : 'skipped';
  }

  /**
   * Marks the payment PAID and pushes the advert's "paid until" 30 days on, switching it on. Conditional on the payment
   * still being PENDING, so a callback and a "check now" arriving together extend the advert only once.
   */
  private async settle(organizationId: string, paymentId: string, reference: string): Promise<'paid' | 'skipped'> {
    return this.runAsTenant(organizationId, async (tx) => {
      const claimed = await tx.rentalListingPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: new Date(), paymentReference: reference || null, errorMessage: null },
      });
      if (claimed.count !== 1) return 'skipped' as const;
      const payment = await tx.rentalListingPayment.findUniqueOrThrow({ where: { id: paymentId } });
      const listing = await tx.rentalListing.findUnique({ where: { id: payment.listingId } });
      if (!listing) return 'paid' as const; // the advert was removed after the prompt - nothing to extend
      const now = new Date();
      await tx.rentalListing.update({
        where: { id: listing.id },
        data: { paidUntil: extendPaidUntil(listing.paidUntil, now), isActive: true, confirmedAt: now },
      });
      return 'paid' as const;
    });
  }
}
