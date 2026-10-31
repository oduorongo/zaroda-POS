import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConBillingCycle, ConSubscription, ConSubscriptionPayment, Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { parseEncryptionKey } from '../../common/crypto/secret-box';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { normalizeKenyanPhone } from '../../online-orders/online-orders.util';
import { TumaClient } from '../../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../../online-store/tuma.util';
import { Tx, asOrg, upgradeError } from '../common/con-access';
import { ConSetupService, toPlan } from '../common/con-setup.service';
import { CouponDto, PayPlanDto, QuoteQueryDto, RecordConPaymentDto, UpdateConPlanDto } from '../dto/construction.dto';
import {
  LimitKey,
  Limits,
  PlanLike,
  downgradeProblems,
  extendPeriod,
  limitMessage,
  nextPlanUp,
  quote,
  subscriptionStatus,
  withinLimit,
} from './con-plans.util';

export const EXTRA_PROJECT_PRICE = 1500;
const PAY_RETRY_MS = 60_000;
const CHECK_COOLDOWN_MS = 30_000;
const DAY = 86_400_000;

const extraProjectsOf = (addons: Prisma.JsonValue) => {
  const n = (addons as { extraProjects?: unknown } | null)?.extraProjects;
  return typeof n === 'number' && n > 0 ? n : 0;
};

export const effectiveLimits = (plan: PlanLike, sub: Pick<ConSubscription, 'addons'>): Limits => {
  const extra = plan.features.includes('extra_projects') ? extraProjectsOf(sub.addons) : 0;
  return { ...plan.limits, activeProjects: plan.limits.activeProjects === null ? null : plan.limits.activeProjects + extra };
};

const paymentView = (p: ConSubscriptionPayment) => ({
  id: p.id,
  planCode: p.planCode,
  cycle: p.cycle,
  months: p.months,
  amount: Number(p.amount),
  discount: Number(p.discount),
  couponCode: p.couponCode,
  status: p.status,
  method: p.method,
  receipt: p.receipt,
  error: p.error,
  paidAt: p.paidAt,
  periodEndAfter: p.periodEndAfter,
  createdAt: p.createdAt,
});

/**
 * The construction plan a business is on (docs/construction/05): trial, limits, features, paying by M-Pesa through ZARODA's
 * Tuma account (a payment extends currentPeriodEnd), coupons, extra projects, and the super-admin's tools.
 */
@Injectable()
export class ConPlansService {
  private readonly logger = new Logger(ConPlansService.name);
  private readonly checks = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly setup: ConSetupService,
    private readonly tuma: TumaClient,
    private readonly config: ConfigService,
    private readonly audit: AuditLogService,
  ) {}

  private async planOrThrow(code: string): Promise<PlanLike> {
    const plan = (await this.setup.activePlans()).find((p) => p.code === code);
    if (!plan) throw new BadRequestException('That plan is not available');
    return plan;
  }

  async usage(tx: Tx): Promise<Record<LimitKey, number>> {
    const users = await tx.orgUser.count({ where: { isActive: true } });
    const activeProjects = await tx.conProject.count({ where: { status: { not: 'CLOSED' } } });
    const workers = await tx.conWorker.count({ where: { isActive: true } });
    return { users, activeProjects, workers };
  }

  /** For later phases and the user hook: blocks adding one more of `kind` beyond the plan, with an upgrade prompt. */
  async assertCanAdd(tx: Tx, organizationId: string, kind: LimitKey, current: number) {
    const sub = await tx.conSubscription.findUnique({ where: { organizationId } });
    if (!sub) return;
    const plans = await this.setup.activePlans();
    const plan = plans.find((p) => p.code === sub.planCode);
    if (!plan) return;
    const limit = effectiveLimits(plan, sub)[kind];
    if (withinLimit(limit, current)) return;
    throw upgradeError(limitMessage(plan, plans, kind, limit, EXTRA_PROJECT_PRICE), { limit: kind, requiredPlan: nextPlanUp(plans, plan.code)?.code ?? null });
  }

  async mine() {
    const { organizationId } = getTenantStore();
    const plans = await this.setup.activePlans();
    return this.tenantPrisma.run(async (tx) => {
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const plan = plans.find((p) => p.code === sub.planCode) ?? toPlan(await tx.conPlan.findUniqueOrThrow({ where: { code: sub.planCode } }));
      const [usage, payments] = await Promise.all([
        this.usage(tx),
        tx.conSubscriptionPayment.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      ]);
      const status = subscriptionStatus(sub);
      const now = Date.now();
      return {
        planCode: plan.code,
        planName: plan.name,
        cycle: sub.cycle,
        status,
        currentPeriodEnd: sub.currentPeriodEnd,
        daysLeft: Math.ceil((sub.currentPeriodEnd.getTime() - now) / DAY),
        graceEndsAt: new Date(sub.currentPeriodEnd.getTime() + sub.graceDays * DAY),
        extraProjects: extraProjectsOf(sub.addons),
        couponCode: sub.couponCode,
        couponMonthsLeft: sub.couponMonthsLeft,
        limits: effectiveLimits(plan, sub),
        features: plan.features,
        usage,
        plans,
        payments: payments.map(paymentView),
        canPayOnline: this.tuma.hasPlatformCredentials(),
      };
    });
  }

  private async resolveCoupon(tx: Tx, sub: ConSubscription, code?: string) {
    const wanted = code?.trim().toUpperCase();
    if (!wanted) return sub.couponCode && sub.couponMonthsLeft > 0 ? { code: sub.couponCode, percentOff: await this.percentOf(tx, sub.couponCode), monthsLeft: sub.couponMonthsLeft, isNew: false } : null;
    if (wanted === sub.couponCode) return sub.couponMonthsLeft > 0 ? { code: wanted, percentOff: await this.percentOf(tx, wanted), monthsLeft: sub.couponMonthsLeft, isNew: false } : null;
    if (sub.couponCode) throw new BadRequestException('A coupon has already been used on this account');
    const c = await tx.conCoupon.findUnique({ where: { code: wanted } });
    if (!c || !c.isActive || (c.validUntil && c.validUntil < new Date()) || (c.maxUses !== null && c.uses >= c.maxUses)) throw new BadRequestException('That coupon is not valid');
    return { code: c.code, percentOff: c.percentOff, monthsLeft: c.months, isNew: true };
  }

  private async percentOf(tx: Tx, code: string) {
    return (await tx.conCoupon.findUnique({ where: { code } }))?.percentOff ?? 0;
  }

  private async price(tx: Tx, sub: ConSubscription, dto: { planCode: string; cycle: ConBillingCycle; couponCode?: string; extraProjects?: number }) {
    const plan = await this.planOrThrow(dto.planCode);
    if (plan.quoteOnly) throw new BadRequestException(`${plan.name} is priced by quote - contact ZARODA`);
    const coupon = await this.resolveCoupon(tx, sub, dto.couponCode);
    const q = quote(plan, dto.cycle, coupon ?? undefined);
    const sellsExtras = plan.features.includes('extra_projects');
    if (!sellsExtras && (dto.extraProjects ?? 0) > 0) {
      const up = nextPlanUp(await this.setup.activePlans(), plan.code);
      throw new BadRequestException(`Extra projects are not sold on ${plan.name}.${up ? ` Upgrade to ${up.name} for more projects.` : ''}`);
    }
    const extraProjects = sellsExtras ? dto.extraProjects ?? extraProjectsOf(sub.addons) : 0;
    const extras = extraProjects * EXTRA_PROJECT_PRICE * q.months;
    return { plan, coupon, extraProjects, ...q, gross: q.gross + extras, amount: Math.round(q.amount + extras) };
  }

  async quote(dto: QuoteQueryDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const p = await this.price(tx, sub, dto);
      return { planCode: p.plan.code, cycle: dto.cycle, months: p.months, gross: p.gross, discount: p.discount, amount: p.amount, extraProjects: p.extraProjects, coupon: p.coupon?.code ?? null };
    });
  }

  // ── Paying by M-Pesa (ZARODA's Tuma account) ──

  private callbackToken(paymentId: string) {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    return createHmac('sha256', key).update(`con-billing-callback:${paymentId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, paymentId: string) {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/construction-billing/${organizationId}/${paymentId}/tuma-callback/${this.callbackToken(paymentId)}`;
  }

  async pay(dto: PayPlanDto) {
    const { organizationId, orgUserId } = getTenantStore();
    const phone = normalizeKenyanPhone(dto.phone);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    const credentials = this.tuma.platformCredentials();

    const payment = await this.tenantPrisma.run(async (tx) => {
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const recent = await tx.conSubscriptionPayment.findFirst({ where: { status: 'PENDING', error: null, createdAt: { gt: new Date(Date.now() - PAY_RETRY_MS) } } });
      if (recent) throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
      const p = await this.price(tx, sub, dto);
      const problems = downgradeProblems(await this.usage(tx), effectiveLimits(p.plan, { addons: { extraProjects: p.extraProjects } }));
      if (problems.length) throw new BadRequestException(`Your current use does not fit the ${p.plan.name} plan: ${problems.join('; ')}.`);
      if (p.amount < 1) throw new BadRequestException('There is nothing to pay');
      const created = await tx.conSubscriptionPayment.create({
        data: {
          organizationId,
          planCode: p.plan.code,
          cycle: dto.cycle,
          months: p.months,
          amount: p.amount,
          discount: p.discount,
          couponCode: p.coupon?.code ?? null,
          phone,
          createdBy: orgUserId,
        },
      });
      await this.audit.logInTx(tx, { action: 'con_payment.started', entityType: 'ConSubscriptionPayment', entityId: created.id, after: { ...paymentView(created), extraProjects: p.extraProjects } });
      return { created, extraProjects: p.extraProjects };
    });

    let merchantRequestId: string | null = null;
    let error: string | null = null;
    try {
      merchantRequestId = (await this.tuma.stkPush(credentials, { amount: Number(payment.created.amount), phone, description: `ZARODA construction ${payment.created.planCode}`, callbackUrl: this.callbackUrl(organizationId, payment.created.id) })).merchantRequestId;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, paymentId: payment.created.id }, 'Construction plan STK push failed');
    }
    const updated = await this.tenantPrisma.run((tx) =>
      tx.conSubscriptionPayment.update({ where: { id: payment.created.id }, data: { tumaMerchantRequestId: merchantRequestId, error, status: error ? 'FAILED' : 'PENDING' } }),
    );
    if (payment.extraProjects !== undefined) await this.tenantPrisma.run((tx) => this.stashExtras(tx, organizationId, updated.id, payment.extraProjects));
    return paymentView(updated);
  }

  // The extra-project count chosen at payment time is applied on settlement; kept on the subscription's addons until then.
  private async stashExtras(tx: Tx, organizationId: string, paymentId: string, extraProjects: number) {
    const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
    const addons = { ...((sub.addons as Record<string, unknown>) ?? {}), pending: { [paymentId]: extraProjects } };
    await tx.conSubscription.update({ where: { organizationId }, data: { addons: addons as Prisma.InputJsonValue } });
  }

  async checkPayment(paymentId: string) {
    const { organizationId } = getTenantStore();
    const last = this.checks.get(paymentId) ?? 0;
    if (Date.now() - last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    this.checks.set(paymentId, Date.now());
    await this.verifyWithTuma(organizationId, paymentId).catch(() => undefined);
    const p = await this.tenantPrisma.run((tx) => tx.conSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!p) throw new NotFoundException('Payment not found');
    return paymentView(p);
  }

  async handleTumaCallback(organizationId: string, paymentId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(paymentId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
    const payment = await asOrg(this.prisma, organizationId, (tx) => tx.conSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!payment) throw new NotFoundException();
    if (payment.status !== 'PENDING') return { ok: true };
    const verdict = evaluateCallback(body, { amount: Number(payment.amount), latestRequestId: payment.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    if (verdict.kind === 'paid') await this.settle(organizationId, paymentId, 'MPESA', verdict.receipt);
    else if (verdict.kind === 'failed' && (!merchantRequestId || merchantRequestId === payment.tumaMerchantRequestId)) await this.fail(organizationId, paymentId, 'The M-Pesa payment was cancelled or failed - try again');
    else if (verdict.kind === 'review') await this.fail(organizationId, paymentId, `A payment was received that does not match (${verdict.detail}). Contact ZARODA.`);
    else if (verdict.kind === 'needs-check') await this.verifyWithTuma(organizationId, paymentId).catch(() => undefined);
    return { ok: true };
  }

  private fail(organizationId: string, paymentId: string, error: string) {
    return asOrg(this.prisma, organizationId, (tx) => tx.conSubscriptionPayment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'FAILED', error } }));
  }

  private async verifyWithTuma(organizationId: string, paymentId: string) {
    const p = await asOrg(this.prisma, organizationId, (tx) => tx.conSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!p || p.status !== 'PENDING' || !p.tumaMerchantRequestId || !this.tuma.hasPlatformCredentials()) return;
    const c = await this.tuma.confirmPayment(this.tuma.platformCredentials(), p.tumaMerchantRequestId, Number(p.amount));
    if (c.outcome === 'paid') await this.settle(organizationId, paymentId, 'MPESA', c.mpesaReceipt?.trim() || `TUMA:${p.tumaMerchantRequestId}`);
    else if (c.outcome === 'review') await this.fail(organizationId, paymentId, `A payment was received that does not match (${c.detail}). Contact ZARODA.`);
  }

  /** Marks the payment PAID once (conditional on PENDING) and extends the plan. */
  async settle(organizationId: string, paymentId: string, method: string, receipt: string, platformAdminId?: string, now: Date = new Date()) {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const done = await tx.conSubscriptionPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: now, method, receipt: receipt || null, error: null, recordedByPlatformAdminId: platformAdminId ?? null },
      });
      if (done.count === 0) return false;
      const p = await tx.conSubscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const addons = { ...((sub.addons as Record<string, unknown>) ?? {}) };
      const pending = (addons.pending ?? {}) as Record<string, number>;
      const extraProjects = pending[paymentId] ?? extraProjectsOf(sub.addons);
      delete pending[paymentId];
      addons.pending = pending;
      addons.extraProjects = extraProjects;
      const newCoupon = p.couponCode && p.couponCode !== sub.couponCode;
      const coupon = newCoupon ? await tx.conCoupon.findUnique({ where: { code: p.couponCode! } }) : null;
      const monthsLeft = newCoupon ? Math.max((coupon?.months ?? 0) - p.months, 0) : Math.max(sub.couponMonthsLeft - (p.couponCode ? p.months : 0), 0);
      const periodEnd = extendPeriod(sub.currentPeriodEnd, p.months, now);
      const updated = await tx.conSubscription.update({
        where: { organizationId },
        data: {
          planCode: p.planCode,
          cycle: p.cycle,
          status: 'ACTIVE',
          currentPeriodEnd: periodEnd,
          addons: addons as Prisma.InputJsonValue,
          couponCode: p.couponCode ?? sub.couponCode,
          couponMonthsLeft: monthsLeft,
          paidPaymentsCount: { increment: 1 },
        },
      });
      if (newCoupon) await tx.conCoupon.update({ where: { code: p.couponCode! }, data: { uses: { increment: 1 } } });
      await tx.conSubscriptionPayment.update({ where: { id: paymentId }, data: { periodEndAfter: periodEnd } });
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'con_subscription.paid',
          entityType: 'ConSubscription',
          entityId: sub.id,
          before: { planCode: sub.planCode, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
          after: { planCode: updated.planCode, status: updated.status, currentPeriodEnd: updated.currentPeriodEnd, paymentId, method, receipt, platformAdminId: platformAdminId ?? null },
        },
      });
      return true;
    });
  }

  // ── Platform admin ──

  listPlans() {
    return this.prisma.conPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async updatePlan(code: string, dto: UpdateConPlanDto) {
    const found = await this.prisma.conPlan.findUnique({ where: { code } });
    if (!found) throw new NotFoundException('Plan not found');
    const { limits, features, ...rest } = dto;
    const row = await this.prisma.conPlan.update({
      where: { code },
      data: {
        ...rest,
        ...(limits ? { limits: { activeProjects: limits.activeProjects ?? null, workers: limits.workers ?? null, users: limits.users ?? null } } : {}),
        ...(features ? { features } : {}),
      },
    });
    this.setup.clearPlanCache();
    return { before: found, after: row };
  }

  listCoupons() {
    return this.prisma.conCoupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async saveCoupon(dto: CouponDto) {
    const code = dto.code.trim().toUpperCase();
    const data = { description: dto.description ?? null, percentOff: dto.percentOff, months: dto.months, validUntil: dto.validUntil ? new Date(`${dto.validUntil}T23:59:59Z`) : null, maxUses: dto.maxUses ?? null, isActive: dto.isActive ?? true };
    return this.prisma.conCoupon.upsert({ where: { code }, create: { code, ...data }, update: data });
  }

  async tenants() {
    const [orgs, plans] = await Promise.all([
      this.prisma.organization.findMany({ where: { industryType: 'CONSTRUCTION' }, select: { id: true, name: true, isActive: true, createdAt: true }, orderBy: { name: 'asc' } }),
      this.setup.activePlans(),
    ]);
    const subs = await this.prisma.conSubscription.findMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
    const byOrg = new Map(subs.map((s) => [s.organizationId, s]));
    const rows = orgs.map((o) => {
      const s = byOrg.get(o.id);
      const plan = s ? plans.find((p) => p.code === s.planCode) : undefined;
      const status = s ? subscriptionStatus(s) : null;
      const mrr = s && plan && (status === 'ACTIVE' || status === 'GRACE') ? (s.cycle === 'ANNUAL' ? (plan.annualPrice ?? plan.monthlyPrice * 12) / 12 : plan.monthlyPrice) + extraProjectsOf(s.addons) * EXTRA_PROJECT_PRICE : 0;
      return { id: o.id, name: o.name, isActive: o.isActive, createdAt: o.createdAt, planCode: s?.planCode ?? null, planName: plan?.name ?? s?.planCode ?? null, cycle: s?.cycle ?? null, status, currentPeriodEnd: s?.currentPeriodEnd ?? null, couponCode: s?.couponCode ?? null, paidPaymentsCount: s?.paidPaymentsCount ?? 0, mrr: Math.round(mrr) };
    });
    const perPlan = plans.map((p) => ({ code: p.code, name: p.name, active: rows.filter((r) => r.planCode === p.code && (r.status === 'ACTIVE' || r.status === 'GRACE')).length, trial: rows.filter((r) => r.planCode === p.code && r.status === 'TRIAL').length }));
    return { tenants: rows, perPlan, mrr: rows.reduce((a, r) => a + r.mrr, 0) };
  }

  private async subFor(tx: Tx, organizationId: string) {
    const sub = await tx.conSubscription.findUnique({ where: { organizationId } });
    if (!sub) throw new NotFoundException('This business has no construction plan yet - it is created when someone first opens Construction');
    return sub;
  }

  async extendTrial(organizationId: string, days: number) {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const sub = await this.subFor(tx, organizationId);
      if (sub.status !== 'TRIAL') throw new ConflictException('Only a trial can be extended - this business has paid');
      const from = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
      const after = await tx.conSubscription.update({ where: { organizationId }, data: { currentPeriodEnd: new Date(from.getTime() + days * DAY) } });
      await tx.auditLog.create({ data: { organizationId, action: 'con_subscription.trial_extended', entityType: 'ConSubscription', entityId: sub.id, before: { currentPeriodEnd: sub.currentPeriodEnd }, after: { currentPeriodEnd: after.currentPeriodEnd, days, by: 'platform_admin' } } });
      return { before: sub, after };
    });
  }

  async applyCoupon(organizationId: string, code: string) {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const sub = await this.subFor(tx, organizationId);
      const c = await this.resolveCoupon(tx, sub, code);
      if (!c || !c.isNew) throw new BadRequestException('That coupon is already on this account');
      const after = await tx.conSubscription.update({ where: { organizationId }, data: { couponCode: c.code, couponMonthsLeft: c.monthsLeft } });
      await tx.conCoupon.update({ where: { code: c.code }, data: { uses: { increment: 1 } } });
      await tx.auditLog.create({ data: { organizationId, action: 'con_subscription.coupon_applied', entityType: 'ConSubscription', entityId: sub.id, before: { couponCode: sub.couponCode }, after: { couponCode: c.code, couponMonthsLeft: c.monthsLeft, by: 'platform_admin' } } });
      return { before: sub, after };
    });
  }

  async recordPayment(organizationId: string, dto: RecordConPaymentDto, platformAdminId: string) {
    const plan = (await this.listPlans()).find((p) => p.code === dto.planCode);
    if (!plan) throw new BadRequestException('Unknown plan');
    const payment = await asOrg(this.prisma, organizationId, async (tx) => {
      await this.subFor(tx, organizationId);
      return tx.conSubscriptionPayment.create({ data: { organizationId, planCode: dto.planCode, cycle: dto.cycle, months: dto.cycle === 'ANNUAL' ? 12 : 1, amount: dto.amount, method: dto.method } });
    });
    await this.settle(organizationId, payment.id, dto.method, dto.reference?.trim() ?? '', platformAdminId);
    return paymentView(await asOrg(this.prisma, organizationId, (tx) => tx.conSubscriptionPayment.findUniqueOrThrow({ where: { id: payment.id } })));
  }
}
