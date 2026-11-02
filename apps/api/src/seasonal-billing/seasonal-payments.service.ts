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
import { SeasonalBillingService, today } from './seasonal-billing.service';
import { payInFull } from './seasonal.util';

const PAY_RETRY_COOLDOWN_MS = 60_000;
const CHECK_COOLDOWN_MS = 30_000;
const MAX_CHECKS = 5;
const num = (d: Prisma.Decimal | null) => Number(d ?? 0);

/**
 * A school supplier paying a term instalment (or the whole year at the discount) to ZARODA's own Tuma account by M-Pesa - the same
 * way a landlord pays the rental plan (RentalPlatformPaymentsService): an STK prompt, Tuma's webhook as the normal confirmation, and a
 * rate-limited paid status check as the backup. Settling is SeasonalBillingService.settle, which lifts read-only at once.
 */
@Injectable()
export class SeasonalPaymentsService {
  private readonly logger = new Logger(SeasonalPaymentsService.name);
  private readonly checks = new Map<string, { last: number; count: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tuma: TumaClient,
    private readonly config: ConfigService,
    private readonly billing: SeasonalBillingService,
  ) {}

  canPayOnline() {
    return this.tuma.hasPlatformCredentials();
  }

  private token(id: string) {
    return createHmac('sha256', parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'))).update(`seasonal-callback:${id}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, id: string) {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/seasonal-billing/${organizationId}/${id}/tuma-callback/${this.token(id)}`;
  }

  private find(organizationId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return tx.subscriptionInstalment.findUnique({ where: { id } });
    });
  }

  /** An M-Pesa prompt for one instalment, or (fullYear) for the whole school year at the discount, started from its first unpaid term. */
  async payOnline(id: string, phoneInput: string, fullYear: boolean) {
    const { organizationId } = getTenantStore();
    const phone = normalizeKenyanPhone(phoneInput);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    const credentials = this.tuma.platformCredentials();
    const inst = await this.tenantPrisma.run(async (tx) => {
      const i = await tx.subscriptionInstalment.findUnique({ where: { id } });
      if (!i) throw new NotFoundException('Instalment not found');
      if (i.status !== 'DUE') throw new ConflictException(`This instalment is already ${i.status.toLowerCase()}`);
      if (i.payAttemptedAt && !i.lastPaymentError && Date.now() - i.payAttemptedAt.getTime() < PAY_RETRY_COOLDOWN_MS)
        throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
      let amount = num(i.amount);
      if (fullYear) {
        const all = await tx.subscriptionInstalment.findMany({ where: { subscriptionId: i.subscriptionId, schoolYear: i.schoolYear } });
        const full = payInFull(all.map((a) => ({ ...a, amount: num(a.amount) })), i.schoolYear, today(), await this.billing.rules(tx));
        if (!full.available) throw new BadRequestException('Paying the whole year at the discount is not open now');
        amount = full.amount;
      }
      return { ...i, attempt: amount };
    });

    let requestId: string | null = null;
    let error: string | null = null;
    try {
      const r = await this.tuma.stkPush(credentials, {
        amount: inst.attempt,
        phone,
        description: fullYear ? `ZARODA POS ${inst.schoolYear} school year` : `ZARODA POS ${inst.schoolYear} term ${inst.term}`,
        callbackUrl: this.callbackUrl(organizationId, id),
      });
      requestId = r.merchantRequestId;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, id }, 'Seasonal instalment STK push failed');
    }
    await this.tenantPrisma.run((tx) =>
      tx.subscriptionInstalment.update({
        where: { id },
        data: { payPhone: phone, payAttemptedAt: new Date(), lastPaymentError: error, attemptFullYear: fullYear, attemptAmount: inst.attempt, ...(requestId ? { tumaMerchantRequestId: requestId } : {}) },
      }),
    );
    if (error) throw new BadRequestException(error);
    return { started: true, amount: inst.attempt };
  }

  /** "Check now": a paid Tuma status check, so it has a cooldown and a cap. */
  async checkPayment(id: string) {
    const { organizationId } = getTenantStore();
    const inst = await this.find(organizationId, id);
    if (!inst) throw new NotFoundException('Instalment not found');
    if (inst.status !== 'DUE' || !inst.tumaMerchantRequestId) return { result: inst.status === 'DUE' ? 'not-started' : 'paid' };
    const state = this.checks.get(id) ?? { last: 0, count: 0 };
    if (Date.now() - state.last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    if (state.count >= MAX_CHECKS) throw new BadRequestException('This has been checked several times already - please contact ZARODA with your M-Pesa message');
    this.checks.set(id, { last: Date.now(), count: state.count + 1 });
    return { result: await this.verify(organizationId, id).catch(() => 'unavailable' as const) };
  }

  /** Tuma's webhook: the HMAC in the URL proves it is Tuma; the body must be complete and match the prompt's amount. */
  async handleTumaCallback(organizationId: string, id: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.token(id));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
    const inst = await this.find(organizationId, id);
    if (!inst) throw new NotFoundException();
    if (inst.status !== 'DUE') return { ok: true };
    const verdict = evaluateCallback(body, { amount: num(inst.attemptAmount ?? inst.amount), latestRequestId: inst.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    if (verdict.kind === 'paid') await this.settle(organizationId, inst, verdict.receipt);
    else if (verdict.kind === 'review') await this.flag(organizationId, id, `A payment was received that does not match (${verdict.detail}). Contact ZARODA.`);
    else if (verdict.kind === 'failed' && (!merchantRequestId || merchantRequestId === inst.tumaMerchantRequestId)) await this.flag(organizationId, id, 'The M-Pesa payment was cancelled or failed - try again');
    else if (verdict.kind === 'needs-check') await this.verify(organizationId, id).catch(() => undefined);
    return { ok: true };
  }

  private flag(organizationId: string, id: string, message: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return tx.subscriptionInstalment.update({ where: { id }, data: { lastPaymentError: message } });
    });
  }

  private async verify(organizationId: string, id: string): Promise<'paid' | 'not-paid-yet' | 'unavailable' | 'review'> {
    const inst = await this.find(organizationId, id);
    if (!inst || inst.status !== 'DUE' || !inst.tumaMerchantRequestId || !this.tuma.hasPlatformCredentials()) return 'not-paid-yet';
    const c = await this.tuma.confirmPayment(this.tuma.platformCredentials(), inst.tumaMerchantRequestId, num(inst.attemptAmount ?? inst.amount));
    if (c.outcome === 'review') {
      await this.flag(organizationId, id, `A payment was received that does not match (${c.detail}). Contact ZARODA.`);
      return 'review';
    }
    if (c.outcome === 'unavailable') return 'unavailable';
    if (c.outcome !== 'paid') return 'not-paid-yet';
    await this.settle(organizationId, inst, c.mpesaReceipt?.trim() || `TUMA:${inst.tumaMerchantRequestId}`);
    return 'paid';
  }

  private settle(organizationId: string, inst: { id: string; amount: Prisma.Decimal; attemptAmount: Prisma.Decimal | null; attemptFullYear: boolean }, reference: string) {
    return this.billing.settle(organizationId, inst.id, { method: 'MPESA', reference, amount: num(inst.attemptAmount ?? inst.amount), fullYear: inst.attemptFullYear });
  }
}
