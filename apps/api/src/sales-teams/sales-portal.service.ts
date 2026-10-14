import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SalesAgentRole, SalesAgentStatus } from '@prisma/client';
import { generateTempPassword } from '../common/crypto/temp-password';
import { PrismaService } from '../common/prisma/prisma.service';
import { OnboardTenantDto } from '../platform-admin/dto/onboard-tenant.dto';
import { PlatformAdminService } from '../platform-admin/platform-admin.service';
import { effectiveStatus } from '../platform-admin/subscriptions.util';
import { CreateShopRiderDto } from '../riders/dto/rider.dto';
import { RidersService } from '../riders/riders.service';
import { AddMemberDto, OnboardTenantByAgentDto } from './dto/sales-portal.dto';
import type { AuthenticatedAgent } from './sales-agent-auth';
import { SalesTeamsService, toAgentView } from './sales-teams.service';

const TX_OPTIONS = { timeout: 15_000, maxWait: 15_000 };
const MAX_ROWS = 200;

/**
 * What a team leader or member does from their own account: onboard shops and riders (credited to them),
 * and see how those are doing. The organizations table lets a request with no tenant set read every row (the
 * same exception the platform admin relies on), and riders and the sales_* tables have no row security at
 * all - so EVERY query here is scoped by the verified agent in code: a member sees only what they brought in,
 * a leader only their own team's. Nothing returns another team's rows, and nothing here can change who was
 * credited with a shop or rider once it is set.
 */
@Injectable()
export class SalesPortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly platformAdmin: PlatformAdminService,
    private readonly riders: RidersService,
    private readonly teams: SalesTeamsService,
  ) {}

  private isLeader(agent: AuthenticatedAgent) {
    return agent.role === SalesAgentRole.LEADER;
  }

  private assertLeader(agent: AuthenticatedAgent) {
    if (!this.isLeader(agent)) throw new ForbiddenException('Only the team leader can do that');
  }

  /** Whose work this person may see: a member their own; a leader the whole team's. Always inside their team. */
  private scope(agent: AuthenticatedAgent): { salesTeamId: string; salesAgentId?: string } {
    return this.isLeader(agent) ? { salesTeamId: agent.teamId } : { salesTeamId: agent.teamId, salesAgentId: agent.agentId };
  }

  private async agentNames(teamId: string): Promise<Map<string, string>> {
    const agents = await this.prisma.salesAgent.findMany({ where: { teamId }, select: { id: true, fullName: true } });
    return new Map(agents.map((a) => [a.id, a.fullName]));
  }

  // ── Shops ────────────────────────────────────────────────────────────

  async listTenants(agent: AuthenticatedAgent) {
    const organizations = await this.prisma.organization.findMany({
      where: this.scope(agent),
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    if (organizations.length === 0) return [];
    const subscriptions = await this.prisma.subscription.findMany({
      where: { organizationId: { in: organizations.map((o) => o.id) } },
      include: { plan: true },
    });
    const subByOrg = new Map(subscriptions.map((s) => [s.organizationId, s]));
    const names = await this.agentNames(agent.teamId);

    const rows = [];
    for (const org of organizations) {
      // Sequential on purpose (see PlatformAdminService's note on Neon's connection pool).
      const detail = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${org.id}, true)`;
        const [saleCount, lastSale, store, branch] = await Promise.all([
          tx.sale.count(),
          tx.sale.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
          tx.onlineStore.findUnique({ where: { organizationId: org.id }, select: { addonActive: true, isPublished: true } }),
          tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { county: true, subCounty: true } }),
        ]);
        return { saleCount, lastSaleAt: lastSale?.createdAt ?? null, store, branch };
      }, TX_OPTIONS);
      const sub = subByOrg.get(org.id);
      rows.push({
        id: org.id,
        name: org.name,
        industryType: org.industryType,
        county: detail.branch?.county ?? null,
        subCounty: detail.branch?.subCounty ?? null,
        isActive: org.isActive,
        createdAt: org.createdAt,
        onboardedBy: org.salesAgentId ? { id: org.salesAgentId, fullName: names.get(org.salesAgentId) ?? 'Unknown' } : null,
        subscription: sub
          ? { planName: sub.plan.name, status: effectiveStatus(sub), currentPeriodEnd: sub.currentPeriodEnd, isTrial: sub.isTrial }
          : null,
        onlineShop: { addonActive: detail.store?.addonActive ?? false, isPublished: detail.store?.isPublished ?? false },
        saleCount: detail.saleCount,
        lastSaleAt: detail.lastSaleAt,
      });
    }
    return rows;
  }

  async onboardTenant(agent: AuthenticatedAgent, dto: OnboardTenantByAgentDto) {
    const generated = !dto.ownerPassword;
    const ownerPassword = dto.ownerPassword ?? generateTempPassword();
    const result = await this.platformAdmin.onboardTenant(
      { ...dto, ownerPassword, planTier: 'BASIC' } as OnboardTenantDto,
      { attribution: { salesTeamId: agent.teamId, salesAgentId: agent.agentId }, trial: true },
    );
    return {
      organizationId: result.organizationId,
      ownerEmail: dto.ownerEmail,
      // Only when we made it up: shown once, for the member to hand to the owner.
      ...(generated ? { temporaryPassword: ownerPassword } : {}),
    };
  }

  // ── Riders ───────────────────────────────────────────────────────────

  async listRiders(agent: AuthenticatedAgent) {
    const riders = await this.prisma.rider.findMany({ where: this.scope(agent), orderBy: { createdAt: 'desc' }, take: MAX_ROWS });
    const names = await this.agentNames(agent.teamId);
    return riders.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      email: r.email,
      phone: r.phone,
      vehicleType: r.vehicleType,
      area: r.area,
      status: r.status,
      createdAt: r.createdAt,
      onboardedBy: r.salesAgentId ? { id: r.salesAgentId, fullName: names.get(r.salesAgentId) ?? 'Unknown' } : null,
    }));
  }

  createRider(agent: AuthenticatedAgent, dto: CreateShopRiderDto) {
    return this.riders.createForAgent(dto, { salesTeamId: agent.teamId, salesAgentId: agent.agentId });
  }

  // ── Overview ─────────────────────────────────────────────────────────

  async overview(agent: AuthenticatedAgent) {
    const [tenants, riders] = await Promise.all([this.listTenants(agent), this.listRiders(agent)]);
    const base = {
      shops: {
        total: tenants.length,
        onTrial: tenants.filter((t) => t.subscription?.status === 'TRIAL').length,
        paying: tenants.filter((t) => t.subscription?.status === 'ACTIVE').length,
        lapsed: tenants.filter((t) => t.subscription && ['GRACE', 'SUSPENDED'].includes(t.subscription.status)).length,
        sellingOnline: tenants.filter((t) => t.onlineShop.isPublished).length,
      },
      riders: {
        total: riders.length,
        waitingForApproval: riders.filter((r) => r.status === 'PENDING').length,
        approved: riders.filter((r) => r.status === 'APPROVED').length,
      },
    };
    if (!this.isLeader(agent)) return { ...base, members: null };

    const members = await this.prisma.salesAgent.findMany({
      where: { teamId: agent.teamId, role: SalesAgentRole.MEMBER },
      orderBy: { fullName: 'asc' },
    });
    return {
      ...base,
      members: members.map((m) => ({
        id: m.id,
        fullName: m.fullName,
        status: m.status,
        shops: tenants.filter((t) => t.onboardedBy?.id === m.id).length,
        riders: riders.filter((r) => r.onboardedBy?.id === m.id).length,
      })),
    };
  }

  // ── A leader's own members ───────────────────────────────────────────

  async listMembers(agent: AuthenticatedAgent) {
    this.assertLeader(agent);
    const members = await this.prisma.salesAgent.findMany({
      where: { teamId: agent.teamId, role: SalesAgentRole.MEMBER },
      orderBy: { fullName: 'asc' },
    });
    const [orgCounts, riderCounts] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['salesAgentId'], where: { salesTeamId: agent.teamId, salesAgentId: { not: null } }, _count: { _all: true } }),
      this.prisma.rider.groupBy({ by: ['salesAgentId'], where: { salesTeamId: agent.teamId, salesAgentId: { not: null } }, _count: { _all: true } }),
    ]);
    const shops = new Map(orgCounts.map((c) => [c.salesAgentId, c._count._all]));
    const riders = new Map(riderCounts.map((c) => [c.salesAgentId, c._count._all]));
    return members.map((m) => ({ ...toAgentView(m), shopCount: shops.get(m.id) ?? 0, riderCount: riders.get(m.id) ?? 0 }));
  }

  async addMember(agent: AuthenticatedAgent, dto: AddMemberDto) {
    this.assertLeader(agent);
    return this.teams.addAgent(null, agent.teamId, SalesAgentRole.MEMBER, dto);
  }

  /** A leader may act only on a MEMBER of their own team - never another team's people, and never another leader. */
  private async ownMember(agent: AuthenticatedAgent, memberId: string) {
    this.assertLeader(agent);
    const member = await this.prisma.salesAgent.findFirst({ where: { id: memberId, teamId: agent.teamId, role: SalesAgentRole.MEMBER } });
    if (!member) throw new NotFoundException('Member not found');
    return member;
  }

  async setMemberStatus(agent: AuthenticatedAgent, memberId: string, status: SalesAgentStatus) {
    await this.ownMember(agent, memberId);
    return this.teams.setAgentStatus(null, memberId, status);
  }

  async resetMemberPassword(agent: AuthenticatedAgent, memberId: string) {
    await this.ownMember(agent, memberId);
    return this.teams.resetAgentPassword(null, memberId);
  }
}
