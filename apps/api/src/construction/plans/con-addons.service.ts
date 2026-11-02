import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { ConSetupService, toPlan } from '../common/con-setup.service';
import { BuyExtraProjectsDto, BuySmsDto, FeeBandsDto, PayFeesDto, RemoveExtraProjectsDto, SmsBundleDto } from '../dto/addons.dto';
import { proratedSlots } from './con-addons.util';
import { EXTRA_PROJECT_PRICE, ConPlansService, effectiveLimits, extraProjectsOf } from './con-plans.service';
import { subscriptionStatus } from './con-plans.util';
import { ConUsageService } from './con-usage.service';
import { monthKey } from '../reports/reports.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Buying on top of the plan (docs/construction/05): extra project slots, SMS bundles, and paying the monthly fee invoice. */
@Injectable()
export class ConAddonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly setup: ConSetupService,
    private readonly plans: ConPlansService,
    private readonly usage: ConUsageService,
    private readonly audit: AuditLogService,
  ) {}

  private async planOf(code: string) {
    return (await this.setup.activePlans()).find((p) => p.code === code) ?? toPlan(await this.prisma.conPlan.findUniqueOrThrow({ where: { code } }));
  }

  /** What the business has and can buy: slots, texts, fees. Finished months are rolled into invoices first. */
  async overview() {
    const { organizationId } = getTenantStore();
    const [bundles, bands] = await Promise.all([this.prisma.conSmsBundle.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }), this.prisma.conPayoutFeeBand.findMany({ orderBy: { sortOrder: 'asc' } })]);
    return this.tenantPrisma.run(async (tx) => {
      await this.usage.closeMonths(tx, organizationId);
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const plan = await this.planOf(sub.planCode);
      const status = subscriptionStatus(sub);
      const [invoices, current, used] = await Promise.all([
        tx.conFeeInvoice.findMany({ orderBy: { periodMonth: 'desc' }, take: 12, include: { _count: { select: { charges: true } } } }),
        tx.conFeeCharge.aggregate({ where: { invoiceId: null }, _sum: { amount: true }, _count: { _all: true } }),
        this.plans.usage(tx),
      ]);
      const sellsExtras = plan.features.includes('extra_projects');
      return {
        smsCredits: sub.smsCredits,
        bundles: bundles.map((b) => ({ code: b.code, name: b.name, sms: b.sms, price: n(b.price) })),
        extraProjects: {
          sold: sellsExtras, owned: extraProjectsOf(sub.addons), monthlyPrice: EXTRA_PROJECT_PRICE, canBuy: sellsExtras && (status === 'ACTIVE' || status === 'GRACE'),
          oneSlotNow: sellsExtras ? proratedSlots(1, EXTRA_PROJECT_PRICE, sub.currentPeriodEnd).amount : null, limit: effectiveLimits(plan, sub).activeProjects, active: used.activeProjects,
        },
        fees: {
          thisMonth: { month: monthKey(new Date()), count: current._count._all, total: n(current._sum.amount) },
          invoices: invoices.map((i) => ({ id: i.id, month: i.periodMonth, total: n(i.total), status: i.status, payouts: i._count.charges, paidAt: i.paidAt })),
          bands: bands.map((b) => ({ upTo: b.upTo === null ? null : n(b.upTo), fee: n(b.darajaCost) + n(b.markup) })),
        },
      };
    });
  }

  buyExtraProjects(dto: BuyExtraProjectsDto) {
    return this.plans.startPayment(dto.phone, async (_tx, sub) => {
      const plan = await this.planOf(sub.planCode);
      if (!plan.features.includes('extra_projects')) throw new BadRequestException(`Extra projects are not sold on ${plan.name}. Upgrade for more projects.`);
      const status = subscriptionStatus(sub);
      if (status !== 'ACTIVE' && status !== 'GRACE') throw new ConflictException('Pay for the plan first - extra project slots are added to a paid plan.');
      const q = proratedSlots(dto.count, EXTRA_PROJECT_PRICE, sub.currentPeriodEnd);
      return {
        data: { purpose: 'EXTRA_PROJECTS', planCode: sub.planCode, cycle: sub.cycle, months: 0, amount: q.amount, details: { extraProjects: dto.count, days: q.days } },
        description: `ZARODA ${dto.count} extra project slot${dto.count === 1 ? '' : 's'}`,
      };
    });
  }

  /** Gives back slots no longer needed (no refund); only while the open projects still fit. */
  async removeExtraProjects(dto: RemoveExtraProjectsDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const sub = await tx.conSubscription.findUniqueOrThrow({ where: { organizationId } });
      const owned = extraProjectsOf(sub.addons);
      if (dto.count > owned) throw new BadRequestException(`You have ${owned} extra project slot${owned === 1 ? '' : 's'}.`);
      const plan = await this.planOf(sub.planCode);
      const addons = { ...((sub.addons as Record<string, unknown>) ?? {}), extraProjects: owned - dto.count };
      const limit = effectiveLimits(plan, { addons: addons as Prisma.JsonValue }).activeProjects;
      const active = (await this.plans.usage(tx)).activeProjects;
      if (limit !== null && active > limit) throw new ConflictException(`You have ${active} open projects; close ${active - limit} before giving up ${dto.count === 1 ? 'a slot' : 'these slots'}.`);
      await tx.conSubscription.update({ where: { id: sub.id }, data: { addons: addons as Prisma.InputJsonValue } });
      await this.audit.logInTx(tx, { action: 'con_subscription.extra_projects_removed', entityType: 'ConSubscription', entityId: sub.id, before: { extraProjects: owned }, after: { extraProjects: owned - dto.count } });
      return { extraProjects: owned - dto.count, limit };
    });
  }

  buySms(dto: BuySmsDto) {
    return this.plans.startPayment(dto.phone, async (_tx, sub) => {
      const b = await this.prisma.conSmsBundle.findUnique({ where: { code: dto.bundleCode } });
      if (!b || !b.isActive) throw new NotFoundException('That SMS bundle is not on sale');
      return { data: { purpose: 'SMS', planCode: sub.planCode, cycle: sub.cycle, months: 0, amount: n(b.price), details: { bundleCode: b.code, sms: b.sms } }, description: `ZARODA ${b.name}` };
    });
  }

  payFees(invoiceId: string, dto: PayFeesDto) {
    return this.plans.startPayment(dto.phone, async (tx, sub) => {
      const inv = await tx.conFeeInvoice.findUnique({ where: { id: invoiceId } });
      if (!inv) throw new NotFoundException('Fee invoice not found');
      if (inv.status === 'PAID') throw new ConflictException('This fee invoice is already paid');
      return { data: { purpose: 'FEES', planCode: sub.planCode, cycle: sub.cycle, months: 0, amount: n(inv.total), details: { invoiceId: inv.id, month: inv.periodMonth } }, description: `ZARODA fees ${inv.periodMonth}` };
    });
  }

  // ── Platform admin: the price lists ──

  async adminLists() {
    const [bundles, bands] = await Promise.all([this.prisma.conSmsBundle.findMany({ orderBy: { sortOrder: 'asc' } }), this.prisma.conPayoutFeeBand.findMany({ orderBy: { sortOrder: 'asc' } })]);
    return {
      bundles: bundles.map((b) => ({ id: b.id, code: b.code, name: b.name, sms: b.sms, price: n(b.price), isActive: b.isActive, sortOrder: b.sortOrder })),
      bands: bands.map((b) => ({ id: b.id, upTo: b.upTo === null ? null : n(b.upTo), darajaCost: n(b.darajaCost), markup: n(b.markup), sortOrder: b.sortOrder })),
    };
  }

  saveBundle(dto: SmsBundleDto) {
    const code = dto.code.trim().toUpperCase();
    const data = { name: dto.name.trim(), sms: dto.sms, price: dto.price, isActive: dto.isActive ?? true, sortOrder: dto.sortOrder ?? 0 };
    return this.prisma.conSmsBundle.upsert({ where: { code }, create: { code, ...data }, update: data });
  }

  /** Replaces the whole payout fee table; exactly one band (the last) is open-ended. */
  async saveBands(dto: FeeBandsDto) {
    const open = dto.bands.filter((b) => b.upTo === null || b.upTo === undefined).length;
    if (open !== 1) throw new BadRequestException('Leave "up to" empty on exactly one band - the one for the biggest payouts.');
    const ups = dto.bands.map((b) => b.upTo).filter((u): u is number => typeof u === 'number');
    if (new Set(ups).size !== ups.length) throw new BadRequestException('Two bands have the same "up to" amount.');
    const sorted = [...dto.bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
    await this.prisma.$transaction([
      this.prisma.conPayoutFeeBand.deleteMany(),
      this.prisma.conPayoutFeeBand.createMany({ data: sorted.map((b, i) => ({ upTo: b.upTo ?? null, darajaCost: b.darajaCost, markup: b.markup, sortOrder: i })) }),
    ]);
    return (await this.adminLists()).bands;
  }

  /** Fees owed to ZARODA across businesses, for the billing report. */
  async feesOwed() {
    const rows = await this.prisma.conFeeInvoice.findMany({ where: { status: 'UNPAID' }, select: { organizationId: true, total: true, periodMonth: true } });
    return { unpaidInvoices: rows.length, total: Math.round(rows.reduce((a, r) => a + n(r.total), 0) * 100) / 100 };
  }
}
