import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AfricasTalkingSmsProvider } from '../notifications/africas-talking-sms.provider';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { effectiveStatus, isFreePlan } from '../platform-admin/subscriptions.util';
import { nairobiDayOf } from '../reports/profit.util';
import { paidUntil, payInFull, reminderFor, reminderText, SeasonalRules, signupSchedule, TermRule, yearSchedule } from './seasonal.util';

type Tx = Prisma.TransactionClient;
const TX = { timeout: 30_000, maxWait: 15_000 };
const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const dateOf = (d: string) => new Date(`${d}T00:00:00.000Z`);
export const today = () => nairobiDayOf(new Date());
export const isSeasonal = (plan: { billingCycle: string } | null | undefined) => plan?.billingCycle === 'SEASONAL';

/**
 * Seasonal (school-term) subscriptions: the instalment schedule made at signup and each December, settling instalments
 * (one, or the whole year at the discount), the subscription's "paid until" kept on the oldest unpaid instalment (so the
 * status - and the read-only lock - follow from effectiveStatus at once), reminder texts, and the platform admin's settings,
 * due-date shifts and hand-recorded payments. Monthly plans never come through here.
 */
@Injectable()
export class SeasonalBillingService {
  private readonly logger = new Logger(SeasonalBillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sms: AfricasTalkingSmsProvider,
    private readonly config: ConfigService,
  ) {}

  private asTenant<T>(organizationId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${organizationId}, true)`;
      return fn(tx);
    }, TX);
  }

  async rules(tx: Tx | PrismaService = this.prisma): Promise<SeasonalRules> {
    const [terms, s] = await Promise.all([tx.seasonalTerm.findMany({ orderBy: { term: 'asc' } }), tx.seasonalBillingSettings.findUnique({ where: { id: 'default' } })]);
    return {
      terms: terms.map((t): TermRule => ({ ...t, shareRate: num(t.shareRate) })),
      minFirstPaymentKes: num(s?.minFirstPaymentKes ?? 1500),
      setupFeeKes: num(s?.setupFeeKes),
      payInFullDiscountRate: num(s?.payInFullDiscountRate ?? 0.1),
      payInFullUntilMonth: s?.payInFullUntilMonth ?? 1,
    };
  }

  /** The plan a school supplier starts on when nobody chose one: the oldest active seasonal plan, if there is one. */
  defaultPlanFor(tx: Tx, industryType: string) {
    if (industryType !== 'SCHOOL_SUPPLIER') return Promise.resolve(null);
    return tx.plan.findFirst({ where: { billingCycle: 'SEASONAL', active: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Starts a seasonal subscription inside the signup transaction (tenant already set): the rest of this school year's instalments. */
  async startSubscription(tx: Tx, organizationId: string, plan: { id: string; annualPriceKes: Prisma.Decimal | null; priceKes: Prisma.Decimal }, on = today()) {
    const rules = await this.rules(tx);
    const planned = signupSchedule(on, num(plan.annualPriceKes ?? plan.priceKes), rules);
    const until = paidUntil(planned, on, rules.terms);
    const sub = await tx.subscription.create({ data: { organizationId, planId: plan.id, currentPeriodEnd: until.periodEnd, graceDays: until.graceDays, isTrial: true } });
    if (planned.length) await tx.subscriptionInstalment.createMany({ data: planned.map((p) => ({ ...p, organizationId, subscriptionId: sub.id, dueDate: dateOf(p.dueDate) })) });
    return sub;
  }

  /** Keeps the subscription's "paid until" on its oldest unpaid instalment. */
  async sync(tx: Tx, subscriptionId: string, on = today()) {
    const [open, terms] = await Promise.all([
      tx.subscriptionInstalment.findMany({ where: { subscriptionId, status: 'DUE' }, select: { dueDate: true, graceDays: true } }),
      tx.seasonalTerm.findMany(),
    ]);
    const until = paidUntil(open.map((o) => ({ dueDate: dayKey(o.dueDate), graceDays: o.graceDays })), on, terms.map((t) => ({ ...t, shareRate: num(t.shareRate) })));
    return tx.subscription.update({ where: { id: subscriptionId }, data: { currentPeriodEnd: until.periodEnd, graceDays: until.graceDays }, include: { plan: true } });
  }

  /** Whether a business is locked to read-only (a seasonal plan past its grace days). Cheap: one row. */
  async isReadOnly(tx: Tx, organizationId: string): Promise<boolean> {
    const sub = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: { select: { billingCycle: true } } } });
    return !!sub && isSeasonal(sub.plan) && effectiveStatus(sub) === 'READ_ONLY';
  }

  // ── The business's own view ─────────────────────────────────────────────

  async mine() {
    const { organizationId } = getTenantStore();
    const on = today();
    return this.tenantPrisma.run(async (tx) => {
      const sub = await tx.subscription.findUnique({ where: { organizationId }, include: { plan: true, instalments: { orderBy: [{ schoolYear: 'asc' }, { term: 'asc' }] } } });
      if (!sub) throw new NotFoundException('This business has no subscription');
      const rules = await this.rules(tx);
      const label = (term: number) => (term === 0 ? 'Setup fee' : (rules.terms.find((t) => t.term === term)?.label ?? `Term ${term}`));
      const instalments = sub.instalments.map((i) => {
        const due = dayKey(i.dueDate);
        const lockOn = new Date(Date.parse(`${due}T00:00:00Z`) + (i.graceDays + 1) * 86_400_000).toISOString().slice(0, 10);
        return {
          id: i.id,
          schoolYear: i.schoolYear,
          term: i.term,
          label: label(i.term),
          amount: num(i.amount),
          dueDate: due,
          lockOn,
          state: i.status !== 'DUE' ? i.status : on > due ? 'OVERDUE' : 'DUE',
          paidAt: i.paidAt,
          lastPaymentError: i.lastPaymentError,
          payAttemptedAt: i.payAttemptedAt,
        };
      });
      const year = Number(on.slice(0, 4));
      const offerYear = sub.instalments.some((i) => i.schoolYear === year) ? year : year + 1;
      const full = payInFull(sub.instalments.map((i) => ({ ...i, amount: num(i.amount) })), offerYear, on, rules);
      return {
        cycle: sub.plan.billingCycle,
        free: isFreePlan(sub.plan),
        plan: { name: sub.plan.name, annualPriceKes: num(sub.plan.annualPriceKes ?? sub.plan.priceKes) },
        status: effectiveStatus(sub),
        instalments,
        payInFull: full.available ? { schoolYear: offerYear, ...full, discountRate: rules.payInFullDiscountRate } : null,
        payHow: this.payHow(organizationId),
      };
    });
  }

  /** How to pay outside the app, for screens and texts. */
  payHow(organizationId: string) {
    const paybill = this.config.get<string>('ZARODA_PAYBILL');
    return paybill ? `Pay via Paybill ${paybill}, account ${organizationId.slice(0, 8).toUpperCase()}, or in ZARODA POS under My subscription.` : 'Pay in ZARODA POS under My subscription.';
  }

  // ── Settling ────────────────────────────────────────────────────────────

  /**
   * Marks an instalment paid (or, for the whole year, every unpaid term of that school year: the one paid PAID, the rest SETTLED) and
   * records the SubscriptionPayment. Commission is earned only on the business's first payment and on January renewals (Term 1 or the
   * whole year). Conditional on still being DUE, so a callback, a check and a platform admin at once settle it only once.
   */
  async settle(organizationId: string, instalmentId: string, p: { method: string; reference: string; amount: number; fullYear: boolean; platformAdminId?: string }) {
    return this.asTenant(organizationId, async (tx) => {
      const inst = await tx.subscriptionInstalment.findUnique({ where: { id: instalmentId } });
      if (!inst || inst.status !== 'DUE') return null;
      const covered = p.fullYear
        ? await tx.subscriptionInstalment.findMany({ where: { subscriptionId: inst.subscriptionId, schoolYear: inst.schoolYear, term: { gt: 0 }, status: 'DUE' } })
        : [inst];
      const claimed = await tx.subscriptionInstalment.updateMany({ where: { id: { in: covered.map((c) => c.id) }, status: 'DUE' }, data: { status: 'SETTLED' } });
      if (claimed.count !== covered.length) throw new ConflictException('That instalment was paid at the same moment - refresh to see it');
      const earlier = await tx.subscriptionPayment.count({ where: { subscriptionId: inst.subscriptionId, amount: { gt: 0 } } });
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: inst.subscriptionId,
          amount: p.amount,
          method: p.method,
          reference: p.reference || null,
          periodEnd: new Date(),
          recordedByPlatformAdminId: p.platformAdminId ?? null,
          commissionable: earlier === 0 || p.fullYear || covered.some((c) => c.term === 1),
        },
      });
      const now = new Date();
      await tx.subscriptionInstalment.updateMany({ where: { id: { in: covered.map((c) => c.id) } }, data: { paymentId: payment.id, paidAt: now, lastPaymentError: null } });
      await tx.subscriptionInstalment.update({ where: { id: inst.id }, data: { status: 'PAID' } });
      if (!p.fullYear) await tx.subscriptionInstalment.updateMany({ where: { id: { in: covered.map((c) => c.id) } }, data: { status: 'PAID' } });
      await tx.subscription.update({ where: { id: inst.subscriptionId }, data: { isTrial: false } });
      const sub = await this.sync(tx, inst.subscriptionId);
      await tx.subscriptionPayment.update({ where: { id: payment.id }, data: { periodEnd: sub.currentPeriodEnd } });
      return { payment, status: effectiveStatus(sub) };
    });
  }

  // ── Platform admin ──────────────────────────────────────────────────────

  async settings() {
    const [rules, shifts] = await Promise.all([this.rules(), this.prisma.seasonalDueShift.findMany({ orderBy: { createdAt: 'desc' }, take: 50 })]);
    return { ...rules, shifts: shifts.map((s) => ({ ...s, newDueDate: dayKey(s.newDueDate) })) };
  }

  async updateSettings(dto: { terms?: TermRule[]; minFirstPaymentKes?: number; setupFeeKes?: number; payInFullDiscountRate?: number; payInFullUntilMonth?: number }, platformAdminId: string) {
    if (dto.terms) {
      const share = dto.terms.reduce((t, x) => t + x.shareRate, 0);
      if (Math.abs(share - 1) > 0.0001) throw new BadRequestException('The terms\' shares must add up to 100%');
      const terms = [...dto.terms].sort((a, b) => a.term - b.term);
      if (terms.some((t, i) => t.term !== i + 1)) throw new BadRequestException('Number the terms 1, 2, 3...');
      if (terms.some((t) => t.fromMonth > t.toMonth || (terms[t.term - 2] && terms[t.term - 2].toMonth >= t.fromMonth)))
        throw new BadRequestException("Each term's months must come after the previous term's");
    }
    await this.prisma.$transaction(async (tx) => {
      if (dto.terms) {
        await tx.seasonalTerm.deleteMany({ where: { term: { notIn: dto.terms.map((t) => t.term) } } });
        for (const t of dto.terms) await tx.seasonalTerm.upsert({ where: { term: t.term }, create: t, update: t });
      }
      const { terms: _t, ...rest } = dto;
      void _t;
      await tx.seasonalBillingSettings.upsert({ where: { id: 'default' }, create: { id: 'default', ...rest, updatedByPlatformAdminId: platformAdminId }, update: { ...rest, updatedByPlatformAdminId: platformAdminId } });
    }, TX);
    return this.settings();
  }

  /** Moves a term's due date for every seasonal business still owing it (capitation released late), and logs who and when. */
  async shiftDueDate(dto: { schoolYear: number; term: number; dueDate: string; reason?: string }, platformAdminId: string) {
    const due = await this.prisma.subscriptionInstalment.findMany({ where: { schoolYear: dto.schoolYear, term: dto.term, status: 'DUE' }, select: { id: true, subscriptionId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.subscriptionInstalment.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { dueDate: dateOf(dto.dueDate), reminders: [] } });
      await tx.seasonalDueShift.create({ data: { schoolYear: dto.schoolYear, term: dto.term, newDueDate: dateOf(dto.dueDate), instalments: due.length, reason: dto.reason?.trim() || null, platformAdminId } });
      for (const id of new Set(due.map((d) => d.subscriptionId))) await this.sync(tx, id);
    }, { timeout: 120_000, maxWait: 15_000 });
    return { moved: due.length };
  }

  async markPaid(organizationId: string, instalmentId: string, dto: { method: string; reference?: string; fullYear?: boolean }, platformAdminId: string) {
    const inst = await this.prisma.subscriptionInstalment.findUnique({ where: { id: instalmentId } });
    if (!inst || inst.organizationId !== organizationId) throw new NotFoundException('Instalment not found');
    if (inst.status !== 'DUE') throw new ConflictException(`This instalment is already ${inst.status.toLowerCase()}`);
    let amount = num(inst.amount);
    if (dto.fullYear) {
      const all = await this.prisma.subscriptionInstalment.findMany({ where: { subscriptionId: inst.subscriptionId, schoolYear: inst.schoolYear } });
      const full = payInFull(all.map((a) => ({ ...a, amount: num(a.amount) })), inst.schoolYear, today(), await this.rules());
      if (!full.available) throw new BadRequestException('Paying the whole year at the discount is not open for this business now');
      amount = full.amount;
    }
    const r = await this.settle(organizationId, instalmentId, { method: dto.method, reference: dto.reference ?? '', amount, fullYear: !!dto.fullYear, platformAdminId });
    if (!r) throw new ConflictException('This instalment was just paid');
    return r;
  }

  /** Every seasonal business with its instalments, for the platform admin. */
  async overview() {
    const subs = await this.prisma.subscription.findMany({
      where: { plan: { billingCycle: 'SEASONAL' } },
      include: { plan: true, organization: { select: { name: true } }, instalments: { orderBy: [{ schoolYear: 'asc' }, { term: 'asc' }] } },
      orderBy: { createdAt: 'asc' },
    });
    return subs.map((s) => ({
      organizationId: s.organizationId,
      name: s.organization.name,
      plan: s.plan.name,
      status: effectiveStatus(s),
      instalments: s.instalments.map((i) => ({ id: i.id, schoolYear: i.schoolYear, term: i.term, amount: num(i.amount), dueDate: dayKey(i.dueDate), status: i.status, paidAt: i.paidAt })),
    }));
  }

  // ── The daily run ───────────────────────────────────────────────────────

  /** In December, next school year's schedule; reminder texts; "paid until" kept in step. Safe to run any number of times a day. */
  async runDaily(on = today(), texts = true) {
    const rules = await this.rules();
    const subs = await this.prisma.subscription.findMany({ where: { plan: { billingCycle: 'SEASONAL' }, organization: { isActive: true } }, include: { plan: true } });
    const result = { scheduled: 0, reminders: 0 };
    for (const sub of subs) {
      try {
        await this.asTenant(sub.organizationId, async (tx) => {
          if (on.slice(5, 7) === '12') {
            const next = yearSchedule(Number(on.slice(0, 4)) + 1, num(sub.plan.annualPriceKes ?? sub.plan.priceKes), rules.terms);
            const made = await tx.subscriptionInstalment.createMany({
              data: next.map((p) => ({ ...p, organizationId: sub.organizationId, subscriptionId: sub.id, dueDate: dateOf(p.dueDate) })),
              skipDuplicates: true,
            });
            result.scheduled += made.count;
          }
          await this.sync(tx, sub.id, on);
        });
        if (texts) result.reminders += await this.remind(sub.organizationId, rules, on);
      } catch (e) {
        this.logger.warn({ err: e, organizationId: sub.organizationId }, 'Seasonal billing run failed for one business');
      }
    }
    return result;
  }

  /** Texts the business (its phone on Settings) about unpaid instalments; each reminder once (claimed before sending). */
  private async remind(organizationId: string, rules: SeasonalRules, on: string) {
    const todo = await this.asTenant(organizationId, async (tx) => {
      const open = await tx.subscriptionInstalment.findMany({ where: { organizationId, status: 'DUE', term: { gt: 0 } } });
      const list: { kind: ReturnType<typeof reminderFor>; inst: (typeof open)[number] }[] = [];
      for (const inst of open) {
        const kind = reminderFor({ dueDate: dayKey(inst.dueDate), graceDays: inst.graceDays, reminders: inst.reminders }, on);
        if (!kind) continue;
        const claimed = await tx.subscriptionInstalment.updateMany({ where: { id: inst.id, NOT: { reminders: { has: kind } } }, data: { reminders: { push: kind } } });
        if (claimed.count) list.push({ kind, inst });
      }
      const org = list.length ? await tx.organization.findUnique({ where: { id: organizationId }, select: { phone: true } }) : null;
      return { list, phone: org?.phone ? normalizeKenyanPhone(org.phone) : null };
    });
    let sent = 0;
    for (const { kind, inst } of todo.list) {
      const label = rules.terms.find((t) => t.term === inst.term)?.label ?? `Term ${inst.term}`;
      const text = reminderText(kind!, { label, amount: num(inst.amount), dueDate: dayKey(inst.dueDate), graceDays: inst.graceDays }, this.payHow(organizationId));
      if (!todo.phone) {
        this.logger.warn({ organizationId }, 'Seasonal reminder not texted: the business has no phone number');
        continue;
      }
      await this.sms.sendSms({ to: `+${todo.phone}`, message: text }).catch((e) => this.logger.warn({ err: e, organizationId }, 'Seasonal reminder text failed'));
      sent++;
    }
    return sent;
  }
}
