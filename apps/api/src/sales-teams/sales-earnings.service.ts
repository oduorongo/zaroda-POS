import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, SalesAgentRole, SalesAgentStatus, SalesEarningKind, SalesEarningStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { RecordSalesPayoutDto } from './dto/sales-earnings.dto';
import type { AuthenticatedAgent } from './sales-agent-auth';
import { nairobiMonth, round2, splitCommission } from './sales-earnings.util';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
// Looking at a statement brings the ledger up to date, but not more than once a minute.
const ACCRUE_MIN_GAP_MS = 60_000;

const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? 0 : Number(d));

/**
 * What the marketing teams have earned, and what Zaroda has paid them.
 *
 * Nothing is earned until Zaroda has the money:
 * - COMMISSION: when a business's monthly commission invoice is PAID (not waived, not merely issued), the member who
 *   onboarded it earns their team's member share of that commission, and the team leader earns the leader's slice.
 * - BONUS: when a business makes its first subscription payment (after its free trial), the member who onboarded it
 *   earns the team's flat bonus, once.
 * Each is written to an append-only ledger with the rate it was worked out on, so changing a team's terms later never
 * rewrites what was already earned. accrue() is idempotent - (kind, source) is unique - so running it any number of
 * times, or on two servers at once, credits each source once.
 */
@Injectable()
export class SalesEarningsService {
  private lastAccrual = 0;

  constructor(private readonly prisma: PrismaService) {}

  /** Writes any earnings that have become due. Safe to run repeatedly. */
  async accrue(force = false): Promise<{ commission: number; bonuses: number; skipped: boolean }> {
    if (!force && Date.now() - this.lastAccrual < ACCRUE_MIN_GAP_MS) return { commission: 0, bonuses: 0, skipped: true };
    this.lastAccrual = Date.now();

    const orgs = await this.prisma.organization.findMany({
      where: { salesAgentId: { not: null }, salesTeamId: { not: null } },
      select: { id: true, name: true, salesTeamId: true, salesAgentId: true },
    });
    if (orgs.length === 0) return { commission: 0, bonuses: 0, skipped: false };

    const teamIds = [...new Set(orgs.map((o) => o.salesTeamId as string))];
    const teams = new Map((await this.prisma.salesTeam.findMany({ where: { id: { in: teamIds } } })).map((t) => [t.id, t]));
    const leaders = new Map(
      (await this.prisma.salesAgent.findMany({ where: { teamId: { in: teamIds }, role: SalesAgentRole.LEADER, status: SalesAgentStatus.ACTIVE }, select: { id: true, teamId: true } })).map((l) => [l.teamId, l.id]),
    );

    // ── Onboarding bonus: the first subscription payment of each business ──
    let bonuses = 0;
    const orgById = new Map(orgs.map((o) => [o.id, o]));
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { amount: { gt: 0 }, subscription: { organizationId: { in: orgs.map((o) => o.id) } } },
      orderBy: { paidAt: 'asc' },
      select: { id: true, paidAt: true, subscription: { select: { organizationId: true } } },
    });
    const firstPayment = new Map<string, { id: string; paidAt: Date }>();
    for (const p of payments) if (!firstPayment.has(p.subscription.organizationId)) firstPayment.set(p.subscription.organizationId, p);
    const alreadyBonused = new Set(
      (await this.prisma.salesEarning.findMany({ where: { kind: SalesEarningKind.ONBOARDING_BONUS, organizationId: { in: [...firstPayment.keys()] } }, select: { organizationId: true } })).map((e) => e.organizationId),
    );
    for (const [orgId, payment] of firstPayment) {
      if (alreadyBonused.has(orgId)) continue;
      const org = orgById.get(orgId);
      const team = org ? teams.get(org.salesTeamId as string) : undefined;
      const bonus = num(team?.onboardingBonusKes);
      if (!org || !team || bonus <= 0) continue;
      const created = await this.prisma.salesEarning.createMany({
        data: [
          {
            teamId: team.id,
            agentId: org.salesAgentId as string,
            organizationId: org.id,
            organizationName: org.name,
            kind: SalesEarningKind.ONBOARDING_BONUS,
            sourceId: payment.id,
            baseKes: bonus,
            rate: null,
            amountKes: round2(bonus),
            earnedAt: payment.paidAt,
            periodMonth: nairobiMonth(payment.paidAt),
          },
        ],
        skipDuplicates: true,
      });
      bonuses += created.count;
    }

    // ── Commission: each PAID commission invoice, read inside its own business ──
    let commission = 0;
    for (const org of orgs) {
      const team = teams.get(org.salesTeamId as string);
      if (!team) continue;
      const memberRate = num(team.memberShareRate);
      const leaderRate = num(team.leaderOverrideRate);
      if (memberRate <= 0 && leaderRate <= 0) continue;
      const leaderId = leaders.get(team.id);
      commission += await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
        const invoices = await tx.commissionInvoice.findMany({
          where: { status: 'PAID', paidAt: { not: null } },
          select: { id: true, commissionTotal: true, paidAt: true },
        });
        if (invoices.length === 0) return 0;
        const done = new Set(
          (await tx.salesEarning.findMany({ where: { kind: { in: [SalesEarningKind.COMMISSION_SHARE, SalesEarningKind.LEADER_OVERRIDE] }, sourceId: { in: invoices.map((i) => i.id) } }, select: { kind: true, sourceId: true } })).map((e) => `${e.kind}:${e.sourceId}`),
        );
        const rows: Prisma.SalesEarningCreateManyInput[] = [];
        for (const invoice of invoices) {
          const paidAt = invoice.paidAt as Date;
          const base = num(invoice.commissionTotal);
          const split = splitCommission(base, memberRate, leaderRate, Boolean(leaderId));
          const common = { teamId: team.id, organizationId: org.id, organizationName: org.name, sourceId: invoice.id, baseKes: base, earnedAt: paidAt, periodMonth: nairobiMonth(paidAt) };
          if (split.member > 0 && !done.has(`${SalesEarningKind.COMMISSION_SHARE}:${invoice.id}`)) {
            rows.push({ ...common, agentId: org.salesAgentId as string, kind: SalesEarningKind.COMMISSION_SHARE, rate: memberRate, amountKes: split.member });
          }
          if (leaderId && split.leader > 0 && !done.has(`${SalesEarningKind.LEADER_OVERRIDE}:${invoice.id}`)) {
            rows.push({ ...common, agentId: leaderId, kind: SalesEarningKind.LEADER_OVERRIDE, rate: leaderRate, amountKes: split.leader });
          }
        }
        if (rows.length === 0) return 0;
        const created = await tx.salesEarning.createMany({ data: rows, skipDuplicates: true });
        return created.count;
      }, TX_OPTIONS);
    }
    return { commission, bonuses, skipped: false };
  }

  // ── A person's own statement ─────────────────────────────────────────

  async statement(agent: AuthenticatedAgent, month: string | undefined) {
    await this.accrue();
    const period = month ?? nairobiMonth(new Date());
    const [lines, unpaid, paid, payouts] = await Promise.all([
      this.prisma.salesEarning.findMany({ where: { agentId: agent.agentId, periodMonth: period }, orderBy: { earnedAt: 'desc' } }),
      this.prisma.salesEarning.aggregate({ where: { agentId: agent.agentId, status: SalesEarningStatus.ACCRUED }, _sum: { amountKes: true } }),
      this.prisma.salesEarning.aggregate({ where: { agentId: agent.agentId, status: SalesEarningStatus.PAID }, _sum: { amountKes: true } }),
      this.prisma.salesPayout.findMany({ where: { agentId: agent.agentId }, orderBy: { paidAt: 'desc' }, take: 24 }),
    ]);
    const sum = (kind: SalesEarningKind) => round2(lines.filter((l) => l.kind === kind).reduce((total, l) => total + num(l.amountKes), 0));

    const result = {
      month: period,
      thisMonth: {
        commissionShare: sum(SalesEarningKind.COMMISSION_SHARE),
        leaderOverride: sum(SalesEarningKind.LEADER_OVERRIDE),
        onboardingBonus: sum(SalesEarningKind.ONBOARDING_BONUS),
        total: round2(lines.reduce((total, l) => total + num(l.amountKes), 0)),
      },
      allTime: { unpaid: round2(num(unpaid._sum.amountKes)), paid: round2(num(paid._sum.amountKes)) },
      lines: lines.map((l) => ({
        id: l.id,
        kind: l.kind,
        shop: l.organizationName,
        baseKes: num(l.baseKes),
        rate: l.rate == null ? null : num(l.rate),
        amountKes: num(l.amountKes),
        earnedAt: l.earnedAt,
        status: l.status,
      })),
      payouts: payouts.map((p) => ({ id: p.id, amountKes: num(p.amountKes), throughMonth: p.throughMonth, method: p.method, reference: p.reference, paidAt: p.paidAt })),
      team: null as null | { agentId: string; fullName: string; role: SalesAgentRole; earnedThisMonth: number; unpaid: number }[],
    };
    if (agent.role !== SalesAgentRole.LEADER) return result;

    // A leader also sees what each person on the team has earned: that is how they monitor their team.
    const [people, month_, open] = await Promise.all([
      this.prisma.salesAgent.findMany({ where: { teamId: agent.teamId }, select: { id: true, fullName: true, role: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { teamId: agent.teamId, periodMonth: period }, _sum: { amountKes: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { teamId: agent.teamId, status: SalesEarningStatus.ACCRUED }, _sum: { amountKes: true } }),
    ]);
    const earned = new Map(month_.map((g) => [g.agentId, num(g._sum.amountKes)]));
    const owed = new Map(open.map((g) => [g.agentId, num(g._sum.amountKes)]));
    result.team = people.map((p) => ({ agentId: p.id, fullName: p.fullName, role: p.role, earnedThisMonth: round2(earned.get(p.id) ?? 0), unpaid: round2(owed.get(p.id) ?? 0) }));
    return result;
  }

  // ── The platform owner's side ────────────────────────────────────────

  /** Every team and person: earned in the month, still owed (up to that month), and paid so far. */
  async overview(month: string | undefined) {
    await this.accrue();
    const period = month ?? nairobiMonth(new Date());
    const [teams, agents, inMonth, byStatus] = await Promise.all([
      this.prisma.salesTeam.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.salesAgent.findMany({ orderBy: [{ role: 'asc' }, { fullName: 'asc' }] }),
      this.prisma.salesEarning.groupBy({ by: ['agentId'], where: { periodMonth: period }, _sum: { amountKes: true } }),
      this.prisma.salesEarning.groupBy({ by: ['agentId', 'status'], where: { periodMonth: { lte: period } }, _sum: { amountKes: true } }),
    ]);
    const earned = new Map(inMonth.map((g) => [g.agentId, num(g._sum.amountKes)]));
    const bucket = (agentId: string, status: SalesEarningStatus) => num(byStatus.find((g) => g.agentId === agentId && g.status === status)?._sum.amountKes);
    return {
      month: period,
      teams: teams.map((team) => {
        const people = agents
          .filter((a) => a.teamId === team.id)
          .map((a) => ({
            agentId: a.id,
            fullName: a.fullName,
            role: a.role,
            status: a.status,
            earnedThisMonth: round2(earned.get(a.id) ?? 0),
            owed: round2(bucket(a.id, SalesEarningStatus.ACCRUED)),
            paid: round2(bucket(a.id, SalesEarningStatus.PAID)),
          }));
        return {
          teamId: team.id,
          name: team.name,
          earnedThisMonth: round2(people.reduce((t, p) => t + p.earnedThisMonth, 0)),
          owed: round2(people.reduce((t, p) => t + p.owed, 0)),
          people,
        };
      }),
    };
  }

  /**
   * Records that Zaroda paid someone everything they had earned up to a month. The earnings are marked paid in the same
   * transaction the payout is written, and only the ones still unpaid - so a double click, or two admins at once,
   * can never pay the same earnings twice.
   */
  async recordPayout(platformAdminId: string, dto: RecordSalesPayoutDto) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: dto.agentId } });
    if (!agent) throw new BadRequestException('Person not found');
    return this.prisma.$transaction(async (tx) => {
      const due = await tx.salesEarning.findMany({
        where: { agentId: dto.agentId, status: SalesEarningStatus.ACCRUED, periodMonth: { lte: dto.throughMonth } },
        select: { id: true, amountKes: true },
      });
      const amount = round2(due.reduce((total, e) => total + num(e.amountKes), 0));
      if (due.length === 0 || amount <= 0) throw new BadRequestException('Nothing is owed to this person up to that month');
      const payout = await tx.salesPayout.create({
        data: { agentId: dto.agentId, amountKes: amount, throughMonth: dto.throughMonth, method: dto.method, reference: dto.reference?.trim() || null, recordedByPlatformAdminId: platformAdminId },
      });
      const marked = await tx.salesEarning.updateMany({
        where: { id: { in: due.map((e) => e.id) }, status: SalesEarningStatus.ACCRUED },
        data: { status: SalesEarningStatus.PAID, payoutId: payout.id },
      });
      if (marked.count !== due.length) throw new BadRequestException('Those earnings were just paid by someone else - refresh and check');
      await tx.platformAuditLog.create({ data: { platformAdminId, action: 'sales_payout.record', entityType: 'SalesPayout', entityId: payout.id } });
      return { id: payout.id, agentId: payout.agentId, amountKes: amount, throughMonth: payout.throughMonth, method: payout.method, reference: payout.reference, paidAt: payout.paidAt, earningsCount: due.length };
    }, TX_OPTIONS);
  }

  async payouts(agentId: string | undefined) {
    const rows = await this.prisma.salesPayout.findMany({
      where: agentId ? { agentId } : undefined,
      orderBy: { paidAt: 'desc' },
      take: 100,
      include: { agent: { select: { fullName: true } } },
    });
    return rows.map((p) => ({ id: p.id, agentId: p.agentId, fullName: p.agent.fullName, amountKes: num(p.amountKes), throughMonth: p.throughMonth, method: p.method, reference: p.reference, paidAt: p.paidAt }));
  }
}
