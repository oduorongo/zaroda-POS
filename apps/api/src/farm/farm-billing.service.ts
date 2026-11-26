import { createHmac, timingSafeEqual } from 'crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FarmSubscription, FarmSubscriptionPayment, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { parseEncryptionKey } from '../common/crypto/secret-box';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { payoutFee } from '../construction/plans/con-addons.util';
import { monthKey } from '../construction/reports/reports.util';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { TumaClient } from '../online-store/tuma.client';
import { evaluateCallback, parseCallback } from '../online-store/tuma.util';
import { asOrg } from './farm-access';
import { FarmCycle, downgradeProblems, extendPeriod, farmMrr, freePeriodEnd, planPrice } from './farm-billing.util';
import { FarmPlanLike, subscriptionStatus, toPlan } from './farm-plans.util';
import { FarmService } from './farm.service';
import { FarmSetupService } from './farm-setup.service';

type Tx = Prisma.TransactionClient;
const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const PAY_RETRY_MS = 60_000;
const CHECK_COOLDOWN_MS = 30_000;
const DAY = 86_400_000;

interface PaymentDraft {
  purpose: 'PLAN' | 'SMS' | 'FEES';
  planCode: string;
  cycle: string;
  months: number;
  amount: number;
  details?: Prisma.InputJsonValue;
}

const view = (p: FarmSubscriptionPayment) => ({
  id: p.id, purpose: p.purpose, planCode: p.planCode, cycle: p.cycle, months: p.months, amount: n(p.amount), status: p.status, error: p.error, method: p.method, receipt: p.receipt,
  paidAt: p.paidAt, periodEndAfter: p.periodEndAfter, createdAt: p.createdAt, details: p.details,
});

/**
 * Zaroda Shamba billing: farms pay ZARODA for their plan, SMS bundles and the month's fees by M-Pesa (ZARODA's Tuma account,
 * the same way Build does), or a platform admin records a payment. SMS bundles and payout fee bands are Build's price lists.
 */
@Injectable()
export class FarmBillingService {
  private readonly logger = new Logger(FarmBillingService.name);
  private readonly checks = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly tuma: TumaClient,
    private readonly config: ConfigService,
    private readonly setup: FarmSetupService,
    private readonly farms: FarmService,
  ) {}

  private async plan(code: string): Promise<FarmPlanLike> {
    const p = (await this.setup.activePlans()).find((x) => x.code === code);
    if (!p) throw new BadRequestException('That plan is not on offer');
    return p;
  }

  // ── What the farm sees ──────────────────────────────────────────────────

  overview() {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      await this.closeMonths(tx, organizationId);
      const [sub, plans, bundles, charges, invoices, payments] = await Promise.all([
        tx.farmSubscription.findUniqueOrThrow({ where: { organizationId } }),
        this.setup.activePlans(),
        this.prisma.conSmsBundle.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
        tx.farmFeeCharge.findMany({ where: { invoiceId: null } }),
        tx.farmFeeInvoice.findMany({ orderBy: { periodMonth: 'desc' }, take: 12 }),
        tx.farmSubscriptionPayment.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      ]);
      const bands = await this.prisma.conPayoutFeeBand.findMany({ orderBy: { sortOrder: 'asc' } });
      return {
        planCode: sub.planCode,
        status: subscriptionStatus(sub),
        cycle: sub.cycle,
        currentPeriodEnd: sub.currentPeriodEnd,
        smsCredits: sub.smsCredits,
        plans: plans.map((p) => ({ code: p.code, name: p.name, monthlyPrice: p.monthlyPrice, annualPrice: p.annualPrice, quoteOnly: p.quoteOnly, limits: p.limits, features: p.features })),
        usage: await this.farms.usage(tx),
        smsBundles: bundles.map((b) => ({ code: b.code, name: b.name, sms: b.sms, price: n(b.price) })),
        payoutBands: bands.map((b) => ({ upTo: b.upTo === null ? null : n(b.upTo), fee: n(b.darajaCost) + n(b.markup) })),
        feesThisMonth: { count: charges.length, total: Math.round(charges.reduce((a, c) => a + n(c.amount), 0) * 100) / 100 },
        invoices: invoices.map((i) => ({ id: i.id, periodMonth: i.periodMonth, total: n(i.total), status: i.status, paidAt: i.paidAt })),
        payments: payments.map(view),
      };
    });
  }

  // ── Paying ──────────────────────────────────────────────────────────────

  private callbackToken(paymentId: string) {
    const key = parseEncryptionKey(this.config.get<string>('SECRETS_ENCRYPTION_KEY'));
    return createHmac('sha256', key).update(`farm-billing-callback:${paymentId}`).digest('base64url');
  }

  private callbackUrl(organizationId: string, paymentId: string) {
    const base = this.config.get<string>('PUBLIC_API_BASE_URL');
    if (!base) throw new ServiceUnavailableException('Online payments are not configured on this server yet');
    return `${base.replace(/\/+$/, '')}/public/farm-billing/${organizationId}/${paymentId}/tuma-callback/${this.callbackToken(paymentId)}`;
  }

  /** Pay for a plan. The free plan is switched to at once; a paid one must fit what the farm already has. */
  async payPlan(dto: { planCode: string; cycle: FarmCycle; phone?: string }) {
    const plan = await this.plan(dto.planCode);
    if (plan.quoteOnly) throw new BadRequestException(`${plan.name} is by quote: contact ZARODA on 0781 230 805`);
    const fit = await this.tenantPrisma.run(async (tx) => downgradeProblems(await this.farms.usage(tx), plan));
    if (fit.length) throw new BadRequestException(`The farm does not fit the ${plan.name} plan: ${fit.join('; ')}.`);
    if (planPrice(plan, dto.cycle).amount < 1) return this.switchFree(plan);
    return this.startPayment(dto.phone ?? '', async () => {
      const { amount, months } = planPrice(plan, dto.cycle);
      return { data: { purpose: 'PLAN', planCode: plan.code, cycle: dto.cycle, months, amount }, description: `ZARODA Shamba ${plan.name}` };
    });
  }

  private switchFree(plan: FarmPlanLike) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const before = await tx.farmSubscription.findUniqueOrThrow({ where: { organizationId } });
      const after = await tx.farmSubscription.update({ where: { organizationId }, data: { planCode: plan.code, cycle: 'MONTHLY', status: 'ACTIVE', currentPeriodEnd: freePeriodEnd() } });
      await this.audit.logInTx(tx, { action: 'farm.plan_switched_free', entityType: 'FarmSubscription', entityId: before.id, before, after });
      return { switched: true, planCode: plan.code };
    });
  }

  buySms(dto: { bundleCode: string; phone: string }) {
    return this.startPayment(dto.phone, async (_tx, sub) => {
      const b = await this.prisma.conSmsBundle.findUnique({ where: { code: dto.bundleCode } });
      if (!b || !b.isActive) throw new NotFoundException('That SMS bundle is not on sale');
      return { data: { purpose: 'SMS', planCode: sub.planCode, cycle: sub.cycle, months: 0, amount: n(b.price), details: { bundleCode: b.code, sms: b.sms } }, description: `ZARODA ${b.name}` };
    });
  }

  payFees(invoiceId: string, dto: { phone: string }) {
    return this.startPayment(dto.phone, async (tx, sub) => {
      const inv = await tx.farmFeeInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw new NotFoundException('Fee invoice not found');
      if (inv.status === 'PAID') throw new ConflictException('This fee invoice is already paid');
      return { data: { purpose: 'FEES', planCode: sub.planCode, cycle: sub.cycle, months: 0, amount: n(inv.total), details: { invoiceId: inv.id, month: inv.periodMonth } }, description: `ZARODA fees ${inv.periodMonth}` };
    });
  }

  /** Records a PENDING payment, then sends ZARODA's M-Pesa prompt. */
  private async startPayment(rawPhone: string, build: (tx: TenantTx, sub: FarmSubscription) => Promise<{ data: PaymentDraft; description: string }>) {
    const { organizationId, orgUserId } = getTenantStore();
    const phone = normalizeKenyanPhone(rawPhone);
    if (!phone) throw new BadRequestException('Enter a valid M-Pesa number, e.g. 0712 345 678');
    if (!this.tuma.hasPlatformCredentials()) throw new ServiceUnavailableException('M-Pesa payments to ZARODA are not set up on this server yet');
    const { created, description } = await this.tenantPrisma.run(async (tx) => {
      const sub = await tx.farmSubscription.findUniqueOrThrow({ where: { organizationId } });
      const recent = await tx.farmSubscriptionPayment.findFirst({ where: { status: 'PENDING', error: null, createdAt: { gt: new Date(Date.now() - PAY_RETRY_MS) } } });
      if (recent) throw new BadRequestException('Check your phone for the M-Pesa prompt - you can retry in a minute');
      const b = await build(tx, sub);
      if (b.data.amount < 1) throw new BadRequestException('There is nothing to pay');
      const row = await tx.farmSubscriptionPayment.create({ data: { ...b.data, organizationId, phone, createdBy: orgUserId } });
      await this.audit.logInTx(tx, { action: 'farm.payment_started', entityType: 'FarmSubscriptionPayment', entityId: row.id, after: view(row) });
      return { created: row, description: b.description };
    });
    let merchantRequestId: string | null = null;
    let error: string | null = null;
    try {
      merchantRequestId = (await this.tuma.stkPush(this.tuma.platformCredentials(), { amount: n(created.amount), phone, description, callbackUrl: this.callbackUrl(organizationId, created.id) })).merchantRequestId;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not start the payment';
      this.logger.warn({ err: e, paymentId: created.id }, 'Farm STK push failed');
    }
    const updated = await this.tenantPrisma.run((tx) =>
      tx.farmSubscriptionPayment.update({ where: { id: created.id }, data: { tumaMerchantRequestId: merchantRequestId, error, status: error ? 'FAILED' : 'PENDING' } }),
    );
    return view(updated);
  }

  async checkPayment(paymentId: string) {
    const { organizationId } = getTenantStore();
    const last = this.checks.get(paymentId) ?? 0;
    if (Date.now() - last < CHECK_COOLDOWN_MS) throw new BadRequestException('Please wait about 30 seconds before checking again');
    this.checks.set(paymentId, Date.now());
    await this.verifyWithTuma(organizationId, paymentId).catch(() => undefined);
    const p = await this.tenantPrisma.run((tx) => tx.farmSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!p) throw new NotFoundException('Payment not found');
    return view(p);
  }

  async handleTumaCallback(organizationId: string, paymentId: string, token: string, body: Record<string, unknown>) {
    const expected = Buffer.from(this.callbackToken(paymentId));
    const actual = Buffer.from(token);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new NotFoundException();
    const payment = await asOrg(this.prisma, organizationId, (tx) => tx.farmSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!payment) throw new NotFoundException();
    if (payment.status !== 'PENDING') return { ok: true };
    const verdict = evaluateCallback(body, { amount: n(payment.amount), latestRequestId: payment.tumaMerchantRequestId });
    const { merchantRequestId } = parseCallback(body);
    if (verdict.kind === 'paid') await this.settle(organizationId, paymentId, 'MPESA', verdict.receipt);
    else if (verdict.kind === 'failed' && (!merchantRequestId || merchantRequestId === payment.tumaMerchantRequestId)) await this.fail(organizationId, paymentId, 'The M-Pesa payment was cancelled or failed - try again');
    else if (verdict.kind === 'review') await this.fail(organizationId, paymentId, `A payment was received that does not match (${verdict.detail}). Contact ZARODA.`);
    else if (verdict.kind === 'needs-check') await this.verifyWithTuma(organizationId, paymentId).catch(() => undefined);
    return { ok: true };
  }

  private fail(organizationId: string, paymentId: string, error: string) {
    return asOrg(this.prisma, organizationId, (tx) => tx.farmSubscriptionPayment.updateMany({ where: { id: paymentId, status: 'PENDING' }, data: { status: 'FAILED', error } }));
  }

  private async verifyWithTuma(organizationId: string, paymentId: string) {
    const p = await asOrg(this.prisma, organizationId, (tx) => tx.farmSubscriptionPayment.findUnique({ where: { id: paymentId } }));
    if (!p || p.status !== 'PENDING' || !p.tumaMerchantRequestId || !this.tuma.hasPlatformCredentials()) return;
    const c = await this.tuma.confirmPayment(this.tuma.platformCredentials(), p.tumaMerchantRequestId, n(p.amount));
    if (c.outcome === 'paid') await this.settle(organizationId, paymentId, 'MPESA', c.mpesaReceipt?.trim() || `TUMA:${p.tumaMerchantRequestId}`);
    else if (c.outcome === 'review') await this.fail(organizationId, paymentId, `A payment was received that does not match (${c.detail}). Contact ZARODA.`);
  }

  /** Marks the payment PAID once, then extends the plan, adds the SMS credits or closes the fee invoice. */
  async settle(organizationId: string, paymentId: string, method: string, receipt: string, platformAdminId?: string, now: Date = new Date()) {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const done = await tx.farmSubscriptionPayment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: now, method, receipt: receipt || null, error: null, recordedByPlatformAdminId: platformAdminId ?? null },
      });
      if (done.count === 0) return false;
      const p = await tx.farmSubscriptionPayment.findUniqueOrThrow({ where: { id: paymentId } });
      const sub = await tx.farmSubscription.findUniqueOrThrow({ where: { organizationId } });
      const d = (p.details ?? {}) as { sms?: number; invoiceId?: string };
      let after: unknown;
      if (p.purpose === 'PLAN') {
        const periodEnd = extendPeriod(sub.currentPeriodEnd, p.months, now);
        after = await tx.farmSubscription.update({ where: { organizationId }, data: { planCode: p.planCode, cycle: p.cycle, status: 'ACTIVE', currentPeriodEnd: periodEnd, paidPaymentsCount: { increment: 1 } } });
        await tx.farmSubscriptionPayment.update({ where: { id: paymentId }, data: { periodEndAfter: periodEnd } });
      } else if (p.purpose === 'SMS') {
        after = await tx.farmSubscription.update({ where: { organizationId }, data: { smsCredits: { increment: d.sms ?? 0 } } });
      } else if (d.invoiceId) {
        after = await tx.farmFeeInvoice.updateMany({ where: { id: d.invoiceId, status: 'UNPAID' }, data: { status: 'PAID', paidAt: now, paymentId: p.id } });
      }
      await tx.auditLog.create({
        data: {
          organizationId, action: `farm.${p.purpose.toLowerCase()}_paid`, entityType: 'FarmSubscriptionPayment', entityId: p.id,
          before: { planCode: sub.planCode, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, smsCredits: sub.smsCredits },
          after: { result: after as Prisma.InputJsonValue, method, receipt, amount: n(p.amount), platformAdminId: platformAdminId ?? null },
        },
      });
      return true;
    });
  }

  // ── Usage: SMS credits and payout fees ──────────────────────────────────

  /** Takes credits for a text; none left means nothing is sent. */
  takeSms(organizationId: string, parts: number): Promise<boolean> {
    return asOrg(this.prisma, organizationId, async (tx) => (await tx.farmSubscription.updateMany({ where: { organizationId, smsCredits: { gte: parts } }, data: { smsCredits: { decrement: parts } } })).count > 0);
  }

  returnSms(organizationId: string, parts: number) {
    return asOrg(this.prisma, organizationId, (tx) => tx.farmSubscription.updateMany({ where: { organizationId }, data: { smsCredits: { increment: parts } } }));
  }

  /** ZARODA's fee for a wage paid by M-Pesa, once per wage line, from Build's payout fee bands. */
  async chargePayout(tx: Tx, organizationId: string, line: { id: string; net: Prisma.Decimal | number }, now: Date = new Date()) {
    const bands = await tx.conPayoutFeeBand.findMany();
    const fee = payoutFee(bands.map((b) => ({ upTo: b.upTo === null ? null : n(b.upTo), darajaCost: n(b.darajaCost), markup: n(b.markup) })), n(line.net));
    if (fee.amount <= 0) return;
    await tx.farmFeeCharge.createMany({
      data: [{ organizationId, sourceId: `farm-payout:${line.id}`, amount: fee.amount, darajaCost: fee.darajaCost, markup: fee.markup, description: `M-Pesa wage payout of KES ${n(line.net).toLocaleString('en-KE')}`, periodMonth: monthKey(now) }],
      skipDuplicates: true,
    });
  }

  /** Rolls each finished month's fees into that month's invoice. */
  async closeMonths(tx: Tx, organizationId: string, now: Date = new Date()) {
    const open = await tx.farmFeeCharge.findMany({ where: { invoiceId: null, periodMonth: { lt: monthKey(now) } }, select: { periodMonth: true } });
    for (const periodMonth of [...new Set(open.map((c) => c.periodMonth))]) {
      const invoice = await tx.farmFeeInvoice.upsert({ where: { organizationId_periodMonth: { organizationId, periodMonth } }, create: { organizationId, periodMonth, total: 0 }, update: {} });
      if (invoice.status !== 'UNPAID') {
        // A charge that came in after its month was paid (a late M-Pesa result) is billed with the current month instead.
        await tx.farmFeeCharge.updateMany({ where: { invoiceId: null, periodMonth }, data: { periodMonth: monthKey(now) } });
        continue;
      }
      await tx.farmFeeCharge.updateMany({ where: { invoiceId: null, periodMonth }, data: { invoiceId: invoice.id } });
      const total = await tx.farmFeeCharge.aggregate({ where: { invoiceId: invoice.id }, _sum: { amount: true } });
      await tx.farmFeeInvoice.update({ where: { id: invoice.id }, data: { total: n(total._sum.amount) } });
    }
  }

  // ── Platform admin ──────────────────────────────────────────────────────

  listPlans() {
    return this.prisma.farmPlan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  async updatePlan(code: string, dto: { name?: string; fits?: string; monthlyPrice?: number; annualPrice?: number | null; quoteOnly?: boolean; isActive?: boolean; sortOrder?: number; limits?: { head?: number | null; birds?: number | null; acres?: number | null; users?: number | null }; features?: string[] }) {
    const before = await this.prisma.farmPlan.findUnique({ where: { code } });
    if (!before) throw new NotFoundException('Plan not found');
    const { limits, features, ...rest } = dto;
    const after = await this.prisma.farmPlan.update({
      where: { code },
      data: {
        ...rest,
        ...(limits ? { limits: { head: limits.head ?? null, birds: limits.birds ?? null, acres: limits.acres ?? null, users: limits.users ?? null } } : {}),
        ...(features ? { features } : {}),
      },
    });
    this.setup.clearPlanCache();
    return { before, after };
  }

  /** Every farm with its plan, status and MRR; per-plan counts; fees owed. */
  async tenants() {
    const orgs = await this.prisma.organization.findMany({ where: { industryType: 'FARM', isDemo: false }, select: { id: true, name: true, isActive: true, createdAt: true, phone: true }, orderBy: { name: 'asc' } });
    const plans = (await this.prisma.farmPlan.findMany()).map(toPlan);
    const rows = [];
    for (const o of orgs) {
      const s = await asOrg(this.prisma, o.id, (tx) => tx.farmSubscription.findUnique({ where: { organizationId: o.id } }));
      const owed = await asOrg(this.prisma, o.id, (tx) => tx.farmFeeInvoice.aggregate({ where: { status: 'UNPAID' }, _sum: { total: true } }));
      const plan = s ? plans.find((p) => p.code === s.planCode) : undefined;
      const status = s ? subscriptionStatus(s) : null;
      const mrr = s && plan && (status === 'ACTIVE' || status === 'GRACE') ? farmMrr(plan, s.cycle) : 0;
      rows.push({
        id: o.id, name: o.name, phone: o.phone, isActive: o.isActive, createdAt: o.createdAt, planCode: s?.planCode ?? null, planName: plan?.name ?? s?.planCode ?? null, cycle: s?.cycle ?? null,
        status, currentPeriodEnd: s?.currentPeriodEnd ?? null, smsCredits: s?.smsCredits ?? 0, paidPaymentsCount: s?.paidPaymentsCount ?? 0, feesOwed: n(owed._sum.total), mrr: Math.round(mrr),
      });
    }
    const week = Date.now() + 7 * DAY;
    return {
      tenants: rows,
      mrr: rows.reduce((a, r) => a + r.mrr, 0),
      perPlan: plans.map((p) => ({ code: p.code, name: p.name, active: rows.filter((r) => r.planCode === p.code && (r.status === 'ACTIVE' || r.status === 'GRACE')).length, trial: rows.filter((r) => r.planCode === p.code && r.status === 'TRIAL').length })),
      trialsEnding: rows.filter((r) => r.status === 'TRIAL' && r.currentPeriodEnd && r.currentPeriodEnd.getTime() <= week).length,
      feesOwed: Math.round(rows.reduce((a, r) => a + r.feesOwed, 0) * 100) / 100,
    };
  }

  async extendTrial(organizationId: string, days: number) {
    return asOrg(this.prisma, organizationId, async (tx) => {
      const sub = await tx.farmSubscription.findUnique({ where: { organizationId } });
      if (!sub) throw new NotFoundException('This farm has not opened Shamba yet');
      if (sub.status !== 'TRIAL') throw new ConflictException('Only a trial can be extended - this farm has paid');
      const from = sub.currentPeriodEnd > new Date() ? sub.currentPeriodEnd : new Date();
      const after = await tx.farmSubscription.update({ where: { organizationId }, data: { currentPeriodEnd: new Date(from.getTime() + days * DAY) } });
      await tx.auditLog.create({ data: { organizationId, action: 'farm.trial_extended', entityType: 'FarmSubscription', entityId: sub.id, before: { currentPeriodEnd: sub.currentPeriodEnd }, after: { currentPeriodEnd: after.currentPeriodEnd, days, by: 'platform_admin' } } });
      return after;
    });
  }

  /** A payment made outside M-Pesa (bank, cheque, cash), recorded by a platform admin and settled at once. */
  async recordPayment(organizationId: string, dto: { planCode: string; cycle: FarmCycle; amount: number; method: string; reference?: string }, platformAdminId: string) {
    await this.plan(dto.planCode);
    const payment = await asOrg(this.prisma, organizationId, async (tx) => {
      if (!(await tx.farmSubscription.findUnique({ where: { organizationId } }))) throw new NotFoundException('This farm has not opened Shamba yet');
      return tx.farmSubscriptionPayment.create({ data: { organizationId, planCode: dto.planCode, cycle: dto.cycle, months: dto.cycle === 'ANNUAL' ? 12 : 1, amount: dto.amount, method: dto.method } });
    });
    await this.settle(organizationId, payment.id, dto.method, dto.reference?.trim() ?? '', platformAdminId);
    return view(await asOrg(this.prisma, organizationId, (tx) => tx.farmSubscriptionPayment.findUniqueOrThrow({ where: { id: payment.id } })));
  }
}
