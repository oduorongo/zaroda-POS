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
import { Prisma, RentalPaymentRequest, RentalSettings } from '@prisma/client';
import { decryptSecret, encryptSecret, parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { DarajaClient } from '../online-store/daraja.client';
import { darajaFailureMessage, evaluateDarajaCallback, parseDarajaCallback } from '../online-store/daraja.util';
import { ConnectMpesaDto, ConnectTumaDto } from '../online-store/dto/update-online-store.dto';
import { darajaConnected, darajaCredentials, gatewayOf, paymentsReady, tumaConnected } from '../online-store/payment-gateway';
import { TumaClient } from '../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { RentalBillingService } from './rental-billing.service';
import { toCents } from './rental-billing.util';
import { RequestPaymentDto } from './dto/rental-mpesa.dto';

type Tx = Prisma.TransactionClient;
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 };
// Per-process limits on paid Tuma "check now" presses (reset on restart; the cost is KES 1 each).
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS_PER_REQUEST = 5;
// A second prompt to the same lease inside this window is refused - it would just double-charge a confused tenant.
const DUPLICATE_PROMPT_WINDOW_MS = 60_000;

/** What the browser is allowed to know about the saved gateway: never a key, secret or passkey. */
function settingsView(s: RentalSettings | null) {
  return {
    paymentGateway: s ? gatewayOf(s) : 'TUMA',
    tumaConnected: s ? tumaConnected(s) : false,
    tumaEmail: s?.tumaEmail ?? null,
    mpesaConnected: s ? darajaConnected(s) : false,
    mpesaAccountType: s?.mpesaAccountType ?? null,
    mpesaShortcode: s?.mpesaShortcode ?? null,
    mpesaTillNumber: s?.mpesaTillNumber ?? null,
    mpesaEnvironment: s?.mpesaEnvironment ?? 'production',
    ready: s ? paymentsReady(s) : false,
  };
}

function requestView(r: RentalPaymentRequest & { lease?: { tenant: { name: string } } }) {
  return {
    id: r.id,
    leaseId: r.leaseId,
    tenantName: r.lease?.tenant.name ?? null,
    amount: Number(r.amount),
    phone: r.phone,
    gateway: r.gateway,
    status: r.status,
    mpesaReceipt: r.mpesaReceipt,
    lastError: r.lastError,
    createdAt: r.createdAt,
  };
}

/**
 * Automatic M-Pesa rent collection. The landlord sends an M-Pesa prompt to the tenant's phone; the money goes to the
 * landlord's OWN Tuma account or Paybill/Till (never Zaroda's), and when M-Pesa confirms it the payment is recorded and
 * applied to the tenant's invoices with a receipt, exactly like a payment typed in by hand.
 *
 * Trust model (same as the online shop): the callback address carries an HMAC token only we and the gateway know, and
 * only a COMPLETE, MATCHING success settles anything (success code, full amount, an M-Pesa receipt, the latest prompt
 * for that request). Anything less is not acted on; it falls back to asking the gateway (free with Safaricom, KES 1 with
 * Tuma). An M-Pesa receipt can only ever settle one payment.
 */
@Injectable()
export class RentalMpesaService {
  private readonly logger = new Logger(RentalMpesaService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly daraja: DarajaClient,
    private readonly billing: RentalBillingService,
    private readonly config: ConfigService,
  ) {}

  private encryptionKey(): Buffer {
    return parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
  }

  private runAsTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  // ── The landlord's payment settings ─────────────────────────────────────

  async getSettings() {
    const { organizationId } = getTenantStore();
    const s = await this.tenantPrisma.run((tx) => tx.rentalSettings.findUnique({ where: { organizationId } }));
    return settingsView(s);
  }

  async connectTuma(dto: ConnectTumaDto) {
    const { organizationId } = getTenantStore();
    const email = dto.email.trim().toLowerCase();
    const apiKey = dto.apiKey.trim();
    // Checked with Tuma first, outside any transaction, so a typo is caught now and not by the first tenant.
    await this.tuma.verifyCredentials(email, apiKey);
    const data = { tumaEmail: email, tumaApiKeyEncrypted: encryptSecret(apiKey, this.encryptionKey()), paymentGateway: 'TUMA' };
    const s = await this.tenantPrisma.run((tx) =>
      tx.rentalSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data }),
    );
    return settingsView(s);
  }

  async disconnectTuma() {
    const { organizationId } = getTenantStore();
    const s = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.rentalSettings.findUnique({ where: { organizationId } });
      if (!current) return null;
      return tx.rentalSettings.update({
        where: { organizationId },
        data: { tumaEmail: null, tumaApiKeyEncrypted: null, ...(darajaConnected(current) ? { paymentGateway: 'DARAJA' } : {}) },
      });
    });
    return settingsView(s);
  }

  async connectMpesa(dto: ConnectMpesaDto) {
    const { organizationId } = getTenantStore();
    if (dto.accountType === 'TILL' && !dto.tillNumber) {
      throw new BadRequestException('Enter your Till number as well as the store number');
    }
    await this.daraja.verifyCredentials({
      environment: dto.environment,
      consumerKey: dto.consumerKey.trim(),
      consumerSecret: dto.consumerSecret.trim(),
    });
    const key = this.encryptionKey();
    const data = {
      paymentGateway: 'DARAJA',
      mpesaAccountType: dto.accountType,
      mpesaShortcode: dto.shortcode,
      mpesaTillNumber: dto.accountType === 'TILL' ? dto.tillNumber ?? null : null,
      mpesaConsumerKeyEncrypted: encryptSecret(dto.consumerKey.trim(), key),
      mpesaConsumerSecretEncrypted: encryptSecret(dto.consumerSecret.trim(), key),
      mpesaPasskeyEncrypted: encryptSecret(dto.passkey.trim(), key),
      mpesaEnvironment: dto.environment,
    };
    const s = await this.tenantPrisma.run((tx) =>
      tx.rentalSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data }),
    );
    return settingsView(s);
  }

  async disconnectMpesa() {
    const { organizationId } = getTenantStore();
    const s = await this.tenantPrisma.run(async (tx) => {
      if (!(await tx.rentalSettings.findUnique({ where: { organizationId } }))) return null;
      return tx.rentalSettings.update({
        where: { organizationId },
        data: {
          paymentGateway: 'TUMA',
          mpesaAccountType: null,
          mpesaShortcode: null,
          mpesaTillNumber: null,
          mpesaConsumerKeyEncrypted: null,
          mpesaConsumerSecretEncrypted: null,
          mpesaPasskeyEncrypted: null,
        },
      });
    });
    return settingsView(s);
  }

  async setGateway(gateway: 'TUMA' | 'DARAJA') {
    const { organizationId } = getTenantStore();
    const s = await this.tenantPrisma.run(async (tx) => {
      const current = await tx.rentalSettings.findUnique({ where: { organizationId } });
      const ready = current && (gateway === 'DARAJA' ? darajaConnected(current) : tumaConnected(current));
      if (!ready) {
        throw new BadRequestException(gateway === 'DARAJA' ? 'Connect your M-Pesa Paybill or Till first' : 'Connect your Tuma account first');
      }
      return tx.rentalSettings.update({ where: { organizationId }, data: { paymentGateway: gateway } });
    });
    return settingsView(s);
  }

  // ── Callback addresses ──────────────────────────────────────────────────

  /**
   * The gateways sign nothing (Tuma) or are easy to forge (anyone can POST), so the address itself is the credential:
   * it embeds an HMAC of the request id under a server-only key. Deterministic, so a late callback for an earlier
   * prompt still verifies.
   */
  private callbackToken(requestId: string): string {
    return createHmac('sha256', this.encryptionKey()).update(`rental-callback:${requestId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, requestId: string, gateway: 'tuma' | 'daraja'): string {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/rental-payments/${organizationId}/${requestId}/${gateway}-callback/${this.callbackToken(requestId)}`;
  }

  private assertToken(requestId: string, token: string) {
    const expected = Buffer.from(this.callbackToken(requestId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
  }

  // ── Sending a prompt ────────────────────────────────────────────────────

  /** Sends an M-Pesa prompt to the tenant's phone for `amount`. Returns at once; the result arrives by callback. */
  async requestPayment(dto: RequestPaymentDto) {
    const { organizationId } = getTenantStore();
    const { settings, lease } = await this.tenantPrisma.run(async (tx) => ({
      settings: await tx.rentalSettings.findUnique({ where: { organizationId } }),
      lease: await tx.rentalLease.findUnique({
        where: { id: dto.leaseId },
        include: { tenant: { select: { name: true, phone: true } }, unit: { select: { label: true, property: { select: { name: true } } } } },
      }),
    }));
    if (!lease) throw new NotFoundException('Lease not found');
    if (!settings || !paymentsReady(settings)) {
      throw new BadRequestException('Connect your Tuma account or your own Paybill/Till first (Rentals > Rent > M-Pesa settings)');
    }
    const phone = normalizeKenyanPhone(dto.phone ?? lease.tenant.phone ?? '');
    if (!phone) throw new BadRequestException('Enter a valid Safaricom phone number for the tenant (like 0712345678)');
    if (toCents(dto.amount) <= 0) throw new BadRequestException('Enter an amount above zero');

    const gateway = gatewayOf(settings);
    const recent = await this.tenantPrisma.run((tx) =>
      tx.rentalPaymentRequest.findFirst({
        where: { leaseId: lease.id, status: 'PENDING', createdAt: { gt: new Date(Date.now() - DUPLICATE_PROMPT_WINDOW_MS) } },
        select: { id: true },
      }),
    );
    if (recent) throw new ConflictException('A prompt was just sent to this tenant - give them a minute to enter their PIN');

    const request = await this.tenantPrisma.run((tx) =>
      tx.rentalPaymentRequest.create({
        data: { organizationId, leaseId: lease.id, invoiceId: dto.invoiceId ?? null, amount: dto.amount, phone, gateway },
      }),
    );

    let requestId: string | null = null;
    let lastError: string | null = null;
    try {
      if (gateway === 'DARAJA') {
        const creds = darajaCredentials(settings, this.encryptionKey());
        if (!creds) throw new ServiceUnavailableException('Your M-Pesa details are incomplete');
        const result = await this.daraja.stkPush(creds, {
          amount: dto.amount,
          phone,
          accountReference: `${lease.unit.label}`.slice(0, 12) || 'Rent',
          description: 'Rent',
          callbackUrl: this.callbackUrl(organizationId, request.id, 'daraja'),
        });
        requestId = result.checkoutRequestId;
      } else {
        const result = await this.tuma.stkPush(
          { email: settings.tumaEmail as string, apiKey: decryptSecret(settings.tumaApiKeyEncrypted as string, this.encryptionKey()) },
          {
            amount: dto.amount,
            phone,
            description: `Rent ${lease.unit.property.name} ${lease.unit.label}`,
            callbackUrl: this.callbackUrl(organizationId, request.id, 'tuma'),
          },
        );
        requestId = result.merchantRequestId;
      }
    } catch (e) {
      lastError = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, requestId: request.id }, 'Rent STK push failed');
    }

    const updated = await this.tenantPrisma.run((tx) =>
      tx.rentalPaymentRequest.update({
        where: { id: request.id },
        data: lastError ? { status: 'FAILED', lastError } : { requestId },
        include: { lease: { select: { tenant: { select: { name: true } } } } },
      }),
    );
    return requestView(updated);
  }

  async listRequests() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.rentalPaymentRequest.findMany({
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { lease: { select: { tenant: { select: { name: true } } } } },
      }),
    );
    return rows.map(requestView);
  }

  // ── Confirming ──────────────────────────────────────────────────────────

  /**
   * Turns a confirmed prompt into a recorded payment. Conditional on the request still being PENDING, so a callback
   * and a "check now" racing each other settle once. An M-Pesa receipt that was already recorded sends the request to
   * REVIEW instead of double-counting.
   */
  private async settle(organizationId: string, request: RentalPaymentRequest, receipt: string): Promise<'paid' | 'skipped' | 'review'> {
    try {
      return await this.runAsTenant(organizationId, async (tx) => {
        const claimed = await tx.rentalPaymentRequest.updateMany({
          where: { id: request.id, status: 'PENDING' },
          data: { status: 'PAID', mpesaReceipt: receipt, lastError: null },
        });
        if (claimed.count !== 1) return 'skipped' as const;
        const payment = await this.billing.recordPaymentInTx(tx, organizationId, {
          leaseId: request.leaseId,
          amount: Number(request.amount),
          method: request.gateway === 'DARAJA' ? 'DARAJA' : 'TUMA',
          reference: receipt,
          note: 'Paid by M-Pesa prompt',
          invoiceId: request.invoiceId,
        });
        await tx.rentalPaymentRequest.update({ where: { id: request.id }, data: { paymentId: payment.id } });
        return 'paid' as const;
      });
    } catch (e) {
      if (e instanceof ConflictException) {
        // The same M-Pesa receipt is already on a recorded payment: never count one payment twice.
        this.logger.error({ requestId: request.id, receipt }, 'That M-Pesa receipt was already recorded');
        await this.flag(organizationId, request.id, 'REVIEW', `M-Pesa receipt ${receipt} was already recorded on another payment - please check`);
        return 'review';
      }
      throw e;
    }
  }

  private flag(organizationId: string, id: string, status: 'FAILED' | 'REVIEW', message: string) {
    return this.runAsTenant(organizationId, (tx) =>
      tx.rentalPaymentRequest.updateMany({ where: { id, status: { in: ['PENDING', 'REVIEW'] } }, data: { status, lastError: message } }),
    );
  }

  /** Tuma's callback. Same checks as the online shop's: see the class comment. */
  async handleTumaCallback(organizationId: string, requestId: string, token: string, body: Record<string, unknown>) {
    this.assertToken(requestId, token);
    this.logger.log({ requestId, fields: Object.keys(body ?? {}), status: (body as { status?: unknown })?.status }, 'Tuma rent callback received');
    const request = await this.runAsTenant(organizationId, (tx) => tx.rentalPaymentRequest.findUnique({ where: { id: requestId } }));
    if (!request) throw new NotFoundException();
    if (request.status !== 'PENDING') return { ok: true };

    const verdict = evaluateCallback(body, { amount: Number(request.amount), latestRequestId: request.requestId });
    const { merchantRequestId } = parseCallback(body);
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, request, verdict.receipt);
        break;
      case 'review':
        this.logger.error({ requestId, detail: verdict.detail }, 'Tuma reported a rent payment that does not match the request');
        await this.flag(organizationId, requestId, 'REVIEW', `A payment was received that does not match this request (${verdict.detail})`);
        break;
      case 'failed':
        if (!merchantRequestId || !request.requestId || merchantRequestId === request.requestId) {
          await this.flag(organizationId, requestId, 'FAILED', 'The M-Pesa prompt was cancelled or failed');
        }
        break;
      case 'needs-check':
        this.logger.warn({ requestId, reason: verdict.reason }, 'Rent callback was not complete enough to trust - asking Tuma (KES 1)');
        await this.verifyWithTuma(organizationId, requestId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return { ok: true };
  }

  /** Safaricom's callback for a landlord collecting into their own Paybill/Till. */
  async handleDarajaCallback(organizationId: string, requestId: string, token: string, body: Record<string, unknown>) {
    this.assertToken(requestId, token);
    const parsed = parseDarajaCallback(body);
    this.logger.log({ requestId, resultCode: parsed.resultCode, hasReceipt: Boolean(parsed.receipt) }, 'Daraja rent callback received');
    const ack = { ResultCode: 0, ResultDesc: 'Accepted' };
    const request = await this.runAsTenant(organizationId, (tx) => tx.rentalPaymentRequest.findUnique({ where: { id: requestId } }));
    if (!request) throw new NotFoundException();
    if (request.status !== 'PENDING') return ack;

    const verdict = evaluateDarajaCallback(body, { amount: Number(request.amount), latestRequestId: request.requestId });
    switch (verdict.kind) {
      case 'paid':
        await this.settle(organizationId, request, verdict.receipt);
        break;
      case 'review':
        this.logger.error({ requestId, detail: verdict.detail }, 'M-Pesa reported a rent payment that does not match the request');
        await this.flag(organizationId, requestId, 'REVIEW', `A payment was received that does not match this request (${verdict.detail})`);
        break;
      case 'failed':
        if (!parsed.checkoutRequestId || !request.requestId || parsed.checkoutRequestId === request.requestId) {
          await this.flag(organizationId, requestId, 'FAILED', darajaFailureMessage(parsed.resultCode, parsed.resultDesc));
        }
        break;
      case 'needs-check':
        await this.verifyWithDaraja(organizationId, requestId).catch(() => undefined);
        break;
      case 'pending':
        break;
    }
    return ack;
  }

  /** Asks Safaricom (free) whether this prompt was paid. */
  async verifyWithDaraja(organizationId: string, requestId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'skipped'> {
    const { request, settings } = await this.runAsTenant(organizationId, async (tx) => ({
      request: await tx.rentalPaymentRequest.findUnique({ where: { id: requestId } }),
      settings: await tx.rentalSettings.findUnique({ where: { organizationId } }),
    }));
    const creds = settings ? darajaCredentials(settings, this.encryptionKey()) : null;
    if (!request || !creds || !request.requestId || request.status !== 'PENDING') return 'skipped';
    const result = await this.daraja.queryStk(creds, request.requestId);
    if (result.outcome === 'failed') {
      await this.flag(organizationId, requestId, 'FAILED', darajaFailureMessage(result.resultCode, result.resultDesc));
      return 'unconfirmed';
    }
    if (result.outcome !== 'paid') return 'unconfirmed';
    // The query confirms the payment but carries no receipt number; the request id is just as unique a guard.
    const outcome = await this.settle(organizationId, request, `DARAJA:${request.requestId}`);
    return outcome === 'review' ? 'review' : 'paid';
  }

  /** Asks Tuma whether this prompt was paid. KES 1 per call, charged to the landlord's Tuma account. */
  async verifyWithTuma(organizationId: string, requestId: string): Promise<'paid' | 'review' | 'unconfirmed' | 'unavailable' | 'skipped'> {
    const { request, settings } = await this.runAsTenant(organizationId, async (tx) => ({
      request: await tx.rentalPaymentRequest.findUnique({ where: { id: requestId } }),
      settings: await tx.rentalSettings.findUnique({ where: { organizationId } }),
    }));
    if (!request || !settings?.tumaEmail || !settings.tumaApiKeyEncrypted || !request.requestId || request.status !== 'PENDING') return 'skipped';
    const confirmation = await this.tuma.confirmPayment(
      { email: settings.tumaEmail, apiKey: decryptSecret(settings.tumaApiKeyEncrypted, this.encryptionKey()) },
      request.requestId,
      Number(request.amount),
    );
    if (confirmation.outcome === 'review') {
      await this.flag(organizationId, requestId, 'REVIEW', `A payment was received that does not match this request (${confirmation.detail})`);
      return 'review';
    }
    if (confirmation.outcome === 'unavailable') {
      this.logger.error({ requestId, detail: confirmation.detail }, 'Could not check this rent payment with Tuma');
      return 'unavailable';
    }
    if (confirmation.outcome !== 'paid') return 'unconfirmed';
    const outcome = await this.settle(organizationId, request, confirmation.mpesaReceipt?.trim() || `TUMA:${request.requestId}`);
    return outcome === 'review' ? 'review' : 'paid';
  }

  /** "Check now": the landlord's backup when no callback arrived. Limited because a Tuma check costs KES 1. */
  async checkRequest(id: string) {
    const { organizationId } = getTenantStore();
    const request = await this.tenantPrisma.run((tx) => tx.rentalPaymentRequest.findUnique({ where: { id } }));
    if (!request) throw new NotFoundException('Request not found');
    if (request.status === 'PENDING' && request.requestId) {
      const state = this.checks.get(id) ?? { last: 0, count: 0 };
      if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
      if (state.count >= MAX_CHECKS_PER_REQUEST) {
        throw new BadRequestException('This request has been checked several times already - record the payment by hand from your M-Pesa message');
      }
      this.checks.set(id, { last: Date.now(), count: state.count + 1 });
      if (request.gateway === 'DARAJA') await this.verifyWithDaraja(organizationId, id);
      else await this.verifyWithTuma(organizationId, id);
    }
    const updated = await this.tenantPrisma.run((tx) =>
      tx.rentalPaymentRequest.findUniqueOrThrow({ where: { id }, include: { lease: { select: { tenant: { select: { name: true } } } } } }),
    );
    return requestView(updated);
  }

  /**
   * Hourly backstop for landlords on their own Paybill/Till: prompts from the last day still waiting get asked
   * about with Safaricom's free query. (Tuma's check costs money, so it is never automatic.)
   */
  async reconcileDaraja(organizationId: string): Promise<number> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pending = await this.runAsTenant(organizationId, (tx) =>
      tx.rentalPaymentRequest.findMany({
        where: { status: 'PENDING', gateway: 'DARAJA', requestId: { not: null }, createdAt: { gt: since } },
        select: { id: true },
      }),
    );
    let confirmed = 0;
    for (const { id } of pending) {
      const outcome = await this.verifyWithDaraja(organizationId, id).catch(() => 'unconfirmed' as const);
      if (outcome === 'paid') confirmed++;
    }
    return confirmed;
  }
}
