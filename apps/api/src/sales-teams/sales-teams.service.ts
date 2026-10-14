import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SalesAgent, SalesAgentRole, SalesAgentStatus, SalesTeam } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { generateTempPassword } from '../common/crypto/temp-password';
import { PrismaService } from '../common/prisma/prisma.service';
import { CreateSalesAgentDto, CreateSalesTeamDto, UpdateSalesTeamDto } from './dto/sales-team.dto';

const SALT_ROUNDS = 10;

export const toAgentView = (agent: SalesAgent) => ({
  id: agent.id,
  teamId: agent.teamId,
  role: agent.role,
  fullName: agent.fullName,
  email: agent.email,
  phone: agent.phone,
  status: agent.status,
  mustChangePassword: agent.mustChangePassword,
  lastLoginAt: agent.lastLoginAt,
  createdAt: agent.createdAt,
});

export const toTeamView = (team: SalesTeam) => ({
  id: team.id,
  name: team.name,
  region: team.region,
  status: team.status,
  memberShareRate: Number(team.memberShareRate),
  leaderOverrideRate: Number(team.leaderOverrideRate),
  onboardingBonusKes: Number(team.onboardingBonusKes),
  createdAt: team.createdAt,
});

/** A member earns memberShareRate and the leader also takes leaderOverrideRate of the team's earnings; together they cannot be more than Zaroda's commission. */
function assertRatesFit(memberShareRate: number, leaderOverrideRate: number) {
  if (memberShareRate + leaderOverrideRate > 1) {
    throw new BadRequestException('The member share and the leader override together cannot be more than 100%');
  }
}

/**
 * What the platform owner does with marketing teams: create a team, give it a leader, add members, set the
 * earning terms, suspend people and issue new temporary passwords. These are platform-level records (no
 * tenant), so access is controlled here and by PlatformAdminAuthGuard on the routes - see the SalesTeam
 * comment in schema.prisma. A leader's own, narrower powers over their members live in SalesAgentService.
 */
@Injectable()
export class SalesTeamsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Logged under the platform admin who did it. A leader's own actions on their members have no platform admin, so are not written here. */
  private async audit(platformAdminId: string | null, action: string, entityType: string, entityId: string) {
    if (!platformAdminId) return;
    await this.prisma.platformAuditLog.create({ data: { platformAdminId, action, entityType, entityId } });
  }

  async listTeams() {
    const teams = await this.prisma.salesTeam.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { organizations: true, riders: true } },
        agents: { select: { id: true, role: true, status: true, fullName: true, email: true } },
      },
    });
    return teams.map((team) => {
      const active = team.agents.filter((a) => a.status === SalesAgentStatus.ACTIVE);
      const leader = active.find((a) => a.role === SalesAgentRole.LEADER) ?? null;
      return {
        ...toTeamView(team),
        leader: leader ? { id: leader.id, fullName: leader.fullName, email: leader.email } : null,
        memberCount: active.filter((a) => a.role === SalesAgentRole.MEMBER).length,
        tenantCount: team._count.organizations,
        riderCount: team._count.riders,
      };
    });
  }

  async getTeam(id: string) {
    const team = await this.prisma.salesTeam.findUnique({
      where: { id },
      include: {
        agents: { orderBy: [{ role: 'asc' }, { fullName: 'asc' }] },
        _count: { select: { organizations: true, riders: true } },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return {
      ...toTeamView(team),
      agents: team.agents.map(toAgentView),
      tenantCount: team._count.organizations,
      riderCount: team._count.riders,
    };
  }

  async createTeam(platformAdminId: string, dto: CreateSalesTeamDto) {
    assertRatesFit(dto.memberShareRate ?? 0, dto.leaderOverrideRate ?? 0);
    try {
      const team = await this.prisma.salesTeam.create({
        data: {
          name: dto.name.trim(),
          region: dto.region?.trim() || null,
          memberShareRate: dto.memberShareRate ?? 0,
          leaderOverrideRate: dto.leaderOverrideRate ?? 0,
          onboardingBonusKes: dto.onboardingBonusKes ?? 0,
        },
      });
      await this.audit(platformAdminId, 'sales_team.create', 'SalesTeam', team.id);
      return toTeamView(team);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A team with that name already exists');
      }
      throw e;
    }
  }

  async updateTeam(platformAdminId: string, id: string, dto: UpdateSalesTeamDto) {
    const current = await this.prisma.salesTeam.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Team not found');
    assertRatesFit(dto.memberShareRate ?? Number(current.memberShareRate), dto.leaderOverrideRate ?? Number(current.leaderOverrideRate));
    try {
      const team = await this.prisma.salesTeam.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          region: dto.region === undefined ? undefined : dto.region.trim() || null,
          status: dto.status,
          memberShareRate: dto.memberShareRate,
          leaderOverrideRate: dto.leaderOverrideRate,
          onboardingBonusKes: dto.onboardingBonusKes,
        },
      });
      await this.audit(platformAdminId, 'sales_team.update', 'SalesTeam', id);
      return toTeamView(team);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('A team with that name already exists');
      }
      throw e;
    }
  }

  /**
   * Adds a leader or a member. The temporary password is returned once and never stored in readable form;
   * the person must replace it at first sign-in. A team has one active leader: adding another is refused
   * unless the owner says to replace the current one (who is suspended, not deleted, so their history stays).
   */
  async addAgent(platformAdminId: string | null, teamId: string, role: SalesAgentRole, dto: CreateSalesAgentDto) {
    const team = await this.prisma.salesTeam.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');
    const email = dto.email.trim().toLowerCase();
    if (await this.prisma.salesAgent.findUnique({ where: { email } })) {
      throw new ConflictException('Someone already has an account with that email');
    }

    const temporaryPassword = generateTempPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, SALT_ROUNDS);

    const agent = await this.prisma.$transaction(async (tx) => {
      if (role === SalesAgentRole.LEADER) {
        const existing = await tx.salesAgent.findFirst({ where: { teamId, role: SalesAgentRole.LEADER, status: SalesAgentStatus.ACTIVE } });
        if (existing) {
          if (!dto.replaceExistingLeader) {
            throw new ConflictException(`${existing.fullName} is already this team's leader. Choose to replace them, or suspend them first.`);
          }
          await tx.salesAgent.update({ where: { id: existing.id }, data: { status: SalesAgentStatus.SUSPENDED } });
        }
      }
      return tx.salesAgent.create({
        data: { teamId, role, fullName: dto.fullName.trim(), email, phone: dto.phone?.trim() || null, passwordHash },
      });
    });
    await this.audit(platformAdminId, role === SalesAgentRole.LEADER ? 'sales_agent.create_leader' : 'sales_agent.create_member', 'SalesAgent', agent.id);
    return { agent: toAgentView(agent), temporaryPassword };
  }

  async setAgentStatus(platformAdminId: string | null, agentId: string, status: SalesAgentStatus) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Person not found');
    if (status === SalesAgentStatus.ACTIVE && agent.role === SalesAgentRole.LEADER) {
      const other = await this.prisma.salesAgent.findFirst({
        where: { teamId: agent.teamId, role: SalesAgentRole.LEADER, status: SalesAgentStatus.ACTIVE, id: { not: agentId } },
      });
      if (other) throw new ConflictException(`${other.fullName} is already this team's active leader`);
    }
    const updated = await this.prisma.salesAgent.update({ where: { id: agentId }, data: { status } });
    await this.audit(platformAdminId, status === SalesAgentStatus.ACTIVE ? 'sales_agent.reactivate' : 'sales_agent.suspend', 'SalesAgent', agentId);
    return toAgentView(updated);
  }

  /** A forgotten password: issue a new temporary one (shown once), which the person must replace at next sign-in. */
  async resetAgentPassword(platformAdminId: string | null, agentId: string) {
    const agent = await this.prisma.salesAgent.findUnique({ where: { id: agentId } });
    if (!agent) throw new NotFoundException('Person not found');
    const temporaryPassword = generateTempPassword();
    const updated = await this.prisma.salesAgent.update({
      where: { id: agentId },
      data: { passwordHash: await bcrypt.hash(temporaryPassword, SALT_ROUNDS), mustChangePassword: true },
    });
    await this.audit(platformAdminId, 'sales_agent.reset_password', 'SalesAgent', agentId);
    return { agent: toAgentView(updated), temporaryPassword };
  }
}
