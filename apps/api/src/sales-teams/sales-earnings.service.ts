import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesAgentRole, SalesAgentStatus, SalesEarningKind, SalesEarningStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { effectiveStatus } from '../platform-admin/subscriptions.util';
import { RecordSalesAdjustmentDto } from './dto/sales-earnings.dto';
import type { AuthenticatedAgent } from './sales-agent-auth';
import { adjustmentAmount, applyCap, nairobiMonth, round2, withinEarningWindow } from './sales-earnings.util';
import { SalesPayoutsService } from './sales-payouts.service';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
// Looking at a statement brings the ledger up to date, but not more than once a minute.
const ACCRUE_MIN_GAP_MS = 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

/** One piece of money Zaroda received from a shop: a paid commission invoice or a subscription payment. */
interface Source {
  type: 'COMMISSION' | 'SUBSCRIPTION';
  id: string;
  base: number;
  earnedAt: Date;
}

const MEMBER_KIND = { COMMISSION: SalesEarningKind.COMMISSION_SHARE, SUBSCRIPTION: SalesEarningKind.SUBSCRIPTION_SHARE } as const;
const SHARE_KINDS: SalesEarningKind[] = [SalesEarningKind.COMMISSION_SHARE, SalesEarningKind.SUBSCRIPTION_SHARE, SalesEarningKind.LEADER_OVERRIDE];

/**
 * What the marketing teams have earned. Nothing is earned until Zaroda has the money:
 * - COMMISSION: when a shop's monthly online-order commission invoice is PAID, the member who signed the shop earns
 *   their team's member share of it, and the team leader earns the leader override.
 * - SUBSCRIPTION: the same for each subscription payment the shop makes (a different member rate).
 * - BONUS: a flat amount, once per shop, when its SECOND subscription payment is made.
 * Rules applied to each (see the commission spec):
 * - only within `earningMonths` of the shop's sign-up, and only for money received after the current member was
 *   assigned the shop (a reassignment never back-pays history);
 * - nothing while the shop is suspended or its subscription is unpaid, or the member is no longer active - such a
 *   source is written as a VOID row (zero payout), so reinstating later cannot pay it retroactively;
 * - member + leader together never earn more than `payoutCapRate` of Zaroda's revenue from the shop in that month
 *   (both are reduced in proportion). The flat bonus sits outside the cap.
 * Each row stores the rate it was worked out on, so changing a team's terms never rewrites what was earned.
 * accrue() is idempotent - (kind, source) is unique - so running it any number of times, or on two servers at once,
 * credits each source once. Earnings start PENDING and become PAYABLE once the hold period after their month ends.
 */
@Injectable()
export class SalesEarningsService {
  private lastAccrual = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly payouts: SalesPayoutsService,
  ) {}

  /** Writes any earnings that have become due, then releases the ones whose hold has passed. Safe to run repeatedly. */
  async accrue(force = false): Promise<{ commission: number; subscriptions: number; bonuses: number; released: number; skipped: boolean }> {
    if (!force && Date.now() - this.lastAccrual < ACCRUE_MIN_GAP_MS) return { commission: 0, subscriptions: 0, bonuses: 0, released: 0, skipped: true };
    this.lastAccrual = Date.now();

    const totals = { commission: 0, subscriptions: 0, bonuses: 0 };
    const orgs = await this.prisma.organization.findMany({
      where: { salesAgentId: { not: null }, salesTeamId: { not: null } },
      select: {
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        salesTeamId: true,
        salesAgentId: true,
        salesAssignedAt: true,
        subscription: { select: { currentPeriodEnd: true, graceDays: true, isTrial: true, manuallySuspended: true } },
      },
    });

    if (orgs.length > 0) {
      const teamIds = [...new Set(orgs.map((o) => o.salesTeamId as string))];
      const teams = new Map((await this.prisma.salesTeam.findMany({ where: { id: { in: teamIds } } })).map((t) => [t.id, t]));
      const leaders = new Map(
        (await this.prisma.salesAgent.findMany({ where: { teamId: { in: teamIds }, role: SalesAgentRole.LEADER, status: SalesAgentStatus.ACTIVE }, select: { id: true, teamId: true, createdAt: true } })).map((l) => [l.teamId, l]),
      );
      const members = new Map(
        (await this.prisma.salesAgent.findMany({ where: { id: { in: [...new Set(orgs.map((o) => o.salesAgentId as string))] } }, select: { id: true, status: true } })).map((m) => [m.id, m.status]),
      );
      const payments = await this.prisma.subscriptionPayment.findMany({
        where: { amount: { gt: 0 }, subscription: { organizationId: { in: orgs.map((o) => o.id) } } },
        orderBy: { paidAt: 'asc' },
        select: { id: true, amount: true, paidAt: true, subscription: { select: { organizationId: true } } },
      });
      const paymentsByOrg = new Map<string, typeof payments>();
      for (const p of payments) paymentsByOrg.set(p.subscription.organizationId, [...(paymentsByOrg.get(p.subscription.organizationId) ?? []), p]);

      for (const org of orgs) {
        const team = teams.get(org.salesTeamId as string);
        if (!team) continue;
        const subscriptionStatus = org.subscription ? effectiveStatus(org.subscription) : null;
        const blocked = !org.isActive ? 'The shop was suspended' : subscriptionStatus === 'SUSPENDED' ? 'The shop subscription was unpaid' : members.get(org.salesAgentId as string) !== SalesAgentStatus.ACTIVE ? 'The member was no longer active' : null;
        const result = await this.accrueShop({
          org,
          team,
          leader: leaders.get(team.id) ?? null,
          blocked,
          payments: (paymentsByOrg.get(org.id) ?? []).map((p) => ({ id: p.id, amount: num(p.amount), paidAt: p.paidAt })),
        });
        totals.commission += result.commission;
        totals.subscriptions += result.subscriptions;
        totals.bonuses += result.bonuses;
      }
    }
    return { ...totals, released: await this.release(), skipped: false };
  }

  /** PENDING -> PAYABLE for every month whose hold period has now passed. */
  async release(): Promise<number> {
    const { holdDays } = await this.payouts.getSettings();
    // A month is releasable once holdDays have passed since it ended, i.e. it is wholly before the month `holdDays` ago.
    const firstHeld = nairobiMonth(new Date(Date.now() - holdDays * DAY_MS));
    const released = await this.prisma.salesEarning.updateMany({
      where: { status: SalesEarningStatus.PENDING, periodMonth: { lt: firstHeld } },
      data: { status: SalesEarningStatus.PAYABLE },
    });
    return released.count;
  }

  private async accrueShop(input: {
    org: { id: string; name: string; createdAt: Date; salesAgentId: string | null; salesAssignedAt: Date | null };
    team: { id: string; memberShareRate: Prisma.Decimal; subscriptionShareRate: Prisma.Decimal; leaderOverrideRate: Prisma.Decimal; onboardingBonusKes: Prisma.Decimal; payoutCapRate: Prisma.Decimal; earningMonths: number };
    leader: { id: string; createdAt: Date } | null;
    blocked: string | null;
    payments: { id: string; amount: number; paidAt: Date }[];
  }) {
    const { org, team, leader, blocked, payments } = input;
    const memberId = org.salesAgentId as string;
    const assignedAt = org.salesAssignedAt ?? org.createdAt;
    const rates = { COMMISSION: num(team.memberShareRate), SUBSCRIPTION: num(team.subscriptionShareRate) };
    const leaderRate = num(team.leaderOverrideRate);
    const capRate = num(team.payoutCapRate);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
      const invoices = await tx.commissionInvoice.findMany({ where: { status: 'PAID', paidAt: { not: null } }, select: { id: true, commissionTotal: true, paidAt: true } });

      const sources: Source[] = [
        ...invoices.map((i): Source => ({ type: 'COMMISSION', id: i.id, base: num(i.commissionTotal), earnedAt: i.paidAt as Date })),
        ...payments.map((p): Source => ({ type: 'SUBSCRIPTION', id: p.id, base: p.amount, earnedAt: p.paidAt })),
      ].sort((a, b) => a.earnedAt.getTime() - b.earnedAt.getTime());
      if (sources.length === 0) return { commission: 0, subscriptions: 0, bonuses: 0 };

      // Zaroda's revenue from this shop, month by month (the cap is a share of it), and what has already been
      // earned against it - so the cap holds across runs and across a month's several sources.
      const revenue = new Map<string, number>();
      for (const s of sources) revenue.set(nairobiMonth(s.earnedAt), (revenue.get(nairobiMonth(s.earnedAt)) ?? 0) + s.base);
      const existing = await tx.salesEarning.findMany({
        where: { organizationId: org.id, OR: [{ sourceId: { in: sources.map((s) => s.id) } }, { kind: SalesEarningKind.ONBOARDING_BONUS }] },
        select: { kind: true, sourceId: true, periodMonth: true, amountKes: true, status: true },
      });
      const done = new Set(existing.map((e) => `${e.kind}:${e.sourceId}`));
      const earned = new Map<string, number>();
      for (const e of existing) {
        if (e.status === SalesEarningStatus.VOID || !SHARE_KINDS.includes(e.kind)) continue;
        earned.set(e.periodMonth, (earned.get(e.periodMonth) ?? 0) + num(e.amountKes));
      }

      const rows: Prisma.SalesEarningCreateManyInput[] = [];
      const counts = { commission: 0, subscriptions: 0, bonuses: 0 };
      const common = (s: Source) => ({ teamId: team.id, organizationId: org.id, organizationName: org.name, sourceId: s.id, earnedAt: s.earnedAt, periodMonth: nairobiMonth(s.earnedAt) });
      const eligibleSource = (s: Source) => s.earnedAt >= assignedAt && withinEarningWindow(org.createdAt, s.earnedAt, team.earningMonths);

      for (const s of sources) {
        if (!eligibleSource(s)) continue;
        const memberKind = MEMBER_KIND[s.type];
        const memberPending = !done.has(`${memberKind}:${s.id}`) && rates[s.type] > 0;
        const leaderPending = !done.has(`${SalesEarningKind.LEADER_OVERRIDE}:${s.id}`) && leaderRate > 0 && leader != null && leader.createdAt <= s.earnedAt;
        if (!memberPending && !leaderPending) continue;

        const month = nairobiMonth(s.earnedAt);
        let member = memberPending ? round2(s.base * rates[s.type]) : 0;
        let leaderAmount = leaderPending ? round2(s.base * leaderRate) : 0;
        let capped = false;

        // The shop being suspended/unpaid stops everyone; the member leaving stops only the member.
        const shopBlocked = blocked && blocked !== 'The member was no longer active' ? blocked : null;
        const memberBlocked = blocked;
        if (!shopBlocked) {
          const headroom = round2(capRate * (revenue.get(month) ?? 0) - (earned.get(month) ?? 0));
          if (memberBlocked) member = 0;
          const fit = applyCap(member, leaderAmount, headroom);
          member = fit.member;
          leaderAmount = fit.leader;
          capped = fit.capped;
          earned.set(month, (earned.get(month) ?? 0) + member + leaderAmount);
        }

        if (memberPending) {
          rows.push({
            ...common(s),
            agentId: memberId,
            kind: memberKind,
            baseKes: s.base,
            rate: rates[s.type],
            amountKes: memberBlocked ? round2(s.base * rates[s.type]) : member,
            capped,
            status: memberBlocked ? SalesEarningStatus.VOID : SalesEarningStatus.PENDING,
            note: memberBlocked ? `${memberBlocked} when this was paid` : null,
          });
        }
        if (leaderPending && leader) {
          rows.push({
            ...common(s),
            agentId: leader.id,
            kind: SalesEarningKind.LEADER_OVERRIDE,
            baseKes: s.base,
            rate: leaderRate,
            amountKes: shopBlocked ? round2(s.base * leaderRate) : leaderAmount,
            capped,
            status: shopBlocked ? SalesEarningStatus.VOID : SalesEarningStatus.PENDING,
            note: shopBlocked ? `${shopBlocked} when this was paid` : null,
          });
        }
      }

      // Bonus: once per shop, on its second subscription payment.
      const bonus = num(team.onboardingBonusKes);
      const second = payments[1];
      if (bonus > 0 && second && !existing.some((e) => e.kind === SalesEarningKind.ONBOARDING_BONUS)) {
        const s: Source = { type: 'SUBSCRIPTION', id: second.id, base: bonus, earnedAt: second.paidAt };
        if (eligibleSource(s)) {
          rows.push({
            ...common(s),
            agentId: memberId,
            kind: SalesEarningKind.ONBOARDING_BONUS,
            baseKes: bonus,
            rate: null,
            amountKes: round2(bonus),
            status: blocked ? SalesEarningStatus.VOID : SalesEarningStatus.PENDING,
            note: blocked ? `${blocked} when this was paid` : null,
          });
        }
      }

      if (rows.length === 0) return counts;
      const created = await tx.salesEarning.createMany({ data: rows, skipDuplicates: true });
      for (const r of rows) {
        if (r.status === SalesEarningStatus.VOID) continue;
        if (r.kind === SalesEarningKind.COMMISSION_SHARE) counts.commission++;
        else if (r.kind === SalesEarningKind.SUBSCRIPTION_SHARE) counts.subscriptions++;
        else if (r.kind === SalesEarningKind.ONBOARDING_BONUS) counts.bonuses++;
      }
      return created.count === 0 ? { commission: 0, subscriptions: 0, bonuses: 0 } : counts;
    }, TX_OPTIONS);
  }

  /**
   * A refund after an earning accrued: writes a negative ADJUSTMENT against every earning from that source (member
   * share, leader override), in proportion to how much of the base was refunded. It lands in the current month and
   * is netted off in the next payout. `reference` (e.g. the refund's id) makes the call safe to repeat; a source can
   * never be reversed by more than it earned.
   */
  async recordAdjustment(platformAdminId: string, dto: RecordSalesAdjustmentDto) {
    const earnings = await this.prisma.salesEarning.findMany({
      where: { sourceId: dto.sourceId, kind: { in: SHARE_KINDS }, status: { not: SalesEarningStatus.VOID } },
    });
    if (earnings.length === 0) throw new NotFoundException('Nothing was earned from that payment');
    const now = new Date();
    const rows: Prisma.SalesEarningCreateManyInput[] = [];
    for (const e of earnings) {
      const prior = await this.prisma.salesEarning.findMany({ where: { kind: SalesEarningKind.ADJUSTMENT, sourceId: { startsWith: `${e.id}:` } }, select: { amountKes: true } });
      const alreadyReversed = prior.reduce((t, a) => t - num(a.amountKes), 0);
      const reversal = Math.min(-adjustmentAmount(num(e.amountKes), num(e.baseKes), dto.refundedKes), round2(num(e.amountKes) - alreadyReversed));
      if (reversal <= 0) continue;
      rows.push({
        teamId: e.teamId,
        agentId: e.agentId,
        organizationId: e.organizationId,
        organizationName: e.organizationName,
        kind: SalesEarningKind.ADJUSTMENT,
        sourceId: `${e.id}:${dto.reference}`,
        baseKes: dto.refundedKes,
        rate: e.rate,
        amountKes: -round2(reversal),
        earnedAt: now,
        periodMonth: nairobiMonth(now),
        status: SalesEarningStatus.PENDING,
        note: dto.reason?.trim() || null,
      });
    }
    if (rows.length === 0) throw new BadRequestException('That refund has already been recorded, or the earnings were already fully reversed');
    const created = await this.prisma.salesEarning.createMany({ data: rows, skipDuplicates: true });
    await this.prisma.platformAuditLog.create({ data: { platformAdminId, action: 'sales_earning.adjust', entityType: 'SalesEarning', entityId: dto.sourceId } });
    return { adjustments: created.count, totalKes: round2(rows.reduce((t, r) => t + Number(r.amountKes), 0)) };
  }

  // ── A person's own statement ─────────────────────────────────────────

  /** What they have earned, per shop and month, split into pending (in the hold), payable (ready to pay) and paid. */
  async statement(agent: AuthenticatedAgent, month: string | undefined) {
    await this.accrue();
    const period = month ?? nairobiMonth(new Date());
    const [lines, buckets, payouts, person, settings] = await Promise.all([
      this.prisma.salesEarning.findMany({ where: { agentId: agent.agentId, periodMonth: period, status: { not: SalesEarningStatus.VOID } }, orderBy: { earnedAt: 'desc' } }),
      this.prisma.salesEarning.groupBy({ by: ['status'], where: { agentId: agent.agentId }, _sum: { amountKes: true } }),
      this.prisma.salesPayout.findMany({ where: { agentId: agent.agentId }, orderBy: { createdAt: 'desc' }, take: 24 }),
      this.prisma.salesAgent.findUnique({ where: { id: agent.agentId }, select: { payoutGateway: true, payoutAccount: true } }),
      this.payouts.getSettings(),
    ]);
    const bucket = (status: SalesEarningStatus) => round2(num(buckets.find((b) => b.status === status)?._sum.amountKes));
    const sum = (kind: SalesEarningKind) => round2(lines.filter((l) => l.kind === kind).reduce((total, l) => total + num(l.amountKes), 0));

    const byShop = new Map<string, { shop: string; pending: number; payable: number; paid: number; total: number }>();
    for (const l of lines) {
      const row = byShop.get(l.organizationId) ?? { shop: l.organizationName, pending: 0, payable: 0, paid: 0, total: 0 };
      const amount = num(l.amountKes);
      if (l.status === SalesEarningStatus.PAID) row.paid += amount;
      else if (l.status === SalesEarningStatus.PAYABLE || l.status === SalesEarningStatus.ACCRUED) row.payable += amount;
      else row.pending += amount;
      row.total += amount;
      byShop.set(l.organizationId, row);
    }

    const result = {
      month: period,
      thisMonth: {
        commissionShare: sum(SalesEarningKind.COMMISSION_SHARE),
        subscriptionShare: sum(SalesEarningKind.SUBSCRIPTION_SHARE),
        leaderOverride: sum(SalesEarningKind.LEADER_OVERRIDE),
        onboardingBonus: sum(SalesEarningKind.ONBOARDING_BONUS),
        adjustments: sum(SalesEarningKind.ADJUSTMENT),
        total: round2(lines.reduce((total, l) => total + num(l.amountKes), 0)),
      },
      byShop: [...byShop.values()].map((r) => ({ shop: r.shop, pending: round2(r.pending), payable: round2(r.payable), paid: round2(r.paid), total: round2(r.total) })),
      allTime: { pending: bucket(SalesEarningStatus.PENDING), payable: round2(bucket(SalesEarningStatus.PAYABLE) + bucket(SalesEarningStatus.ACCRUED)), paid: bucket(SalesEarningStatus.PAID) },
      payoutTerms: { minimumKes: num(settings.payoutMinKes), payoutDay: settings.payoutDay, holdDays: settings.holdDays, withholdingTaxRate: num(settings.withholdingTaxRate) },
      payoutDetails: { gateway: person?.payoutGateway ?? null, account: person?.payoutAccount ?? null },
      lines: lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        shop: l.organizationName,
        baseKes: num(l.baseKes),
        rate: l.rate == null ? null : num(l.rate),
        amountKes: num(l.amountKes),
        capped: l.capped,
        earnedAt: l.earnedAt,
        status: l.status,
      })),
      payouts: payouts.map((p) => ({ id: p.id, amountKes: num(p.amountKes), taxWithheldKes: num(p.taxWithheldKes), netKes: round2(num(p.amountKes) - num(p.taxWithheldKes)), throughMonth: p.throughMonth, gateway: p.method, reference: p.reference, status: p.status, paidAt: p.paidAt, failureReason: p.failureReason })),
      team: null as null | { agentId: string; fullName: string; role: SalesAgentRole; earnedThisMonth: number; pending: number; payable: number; paid: number }[],
    };
    if (agent.role !== SalesAgentRole.LEADER) return result;

    // A leader also sees what each person on the team has earned: that is how they monitor their team.
    const [people, inMonth, byStatus] = await Promise.all([
      this.prisma.salesAgent.findMany({ where: { teamId: agent.teamId }, select: { id: true, fullName: true, role: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { teamId: agent.teamId, periodMonth: period, status: { not: SalesEarningStatus.VOID } }, _sum: { amountKes: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId', 'status'], where: { teamId: agent.teamId }, _sum: { amountKes: true } }),
    ]);
    const earned = new Map(inMonth.map((g) => [g.agentId, num(g._sum.amountKes)]));
    const amount = (id: string, ...statuses: SalesEarningStatus[]) => round2(byStatus.filter((g) => g.agentId === id && statuses.includes(g.status)).reduce((t, g) => t + num(g._sum.amountKes), 0));
    result.team = people.map((p) => ({
      agentId: p.id,
      fullName: p.fullName,
      role: p.role,
      earnedThisMonth: round2(earned.get(p.id) ?? 0),
      pending: amount(p.id, SalesEarningStatus.PENDING),
      payable: amount(p.id, SalesEarningStatus.PAYABLE, SalesEarningStatus.ACCRUED),
      paid: amount(p.id, SalesEarningStatus.PAID),
    }));
    return result;
  }

  // ── The platform owner's side ────────────────────────────────────────

  /** Every team and person: earned in the month, and what is pending, payable and paid overall. */
  async overview(month: string | undefined) {
    await this.accrue();
    const period = month ?? nairobiMonth(new Date());
    const [teams, agents, inMonth, byStatus, settings] = await Promise.all([
      this.prisma.salesTeam.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.salesAgent.findMany({ orderBy: [{ role: 'asc' }, { fullName: 'asc' }] }),
      this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { periodMonth: period, status: { not: SalesEarningStatus.VOID } }, _sum: { amountKes: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId', 'status'], _sum: { amountKes: true } }),
      this.payouts.getSettings(),
    ]);
    const earned = new Map(inMonth.map((g) => [g.agentId, num(g._sum.amountKes)]));
    const bucket = (agentId: string, ...statuses: SalesEarningStatus[]) =>
      round2(byStatus.filter((g) => g.agentId === agentId && statuses.includes(g.status)).reduce((t, g) => t + num(g._sum.amountKes), 0));
    return {
      month: period,
      settings: this.payouts.toSettingsView(settings),
      teams: teams.map((team) => {
        const people = agents
          .filter((a) => a.teamId === team.id)
          .map((a) => ({
            agentId: a.id,
            fullName: a.fullName,
            role: a.role,
            status: a.status,
            payoutGateway: a.payoutGateway,
            payoutAccount: a.payoutAccount,
            earnedThisMonth: round2(earned.get(a.id) ?? 0),
            pending: bucket(a.id, SalesEarningStatus.PENDING),
            payable: bucket(a.id, SalesEarningStatus.PAYABLE, SalesEarningStatus.ACCRUED),
            paid: bucket(a.id, SalesEarningStatus.PAID),
          }));
        return {
          teamId: team.id,
          name: team.name,
          earnedThisMonth: round2(people.reduce((t, p) => t + p.earnedThisMonth, 0)),
          pending: round2(people.reduce((t, p) => t + p.pending, 0)),
          payable: round2(people.reduce((t, p) => t + p.payable, 0)),
          people,
        };
      }),
    };
  }
}
