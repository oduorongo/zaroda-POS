import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConRoleCode, Role } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { ConContext } from './common/con-access';
import { CON_ROLES } from './common/con-defaults';
import { ComplianceService } from './compliance/compliance.service';
import { AddConStaffDto, RoleLimitDto, SITE_STAFF } from './dto/construction.dto';
import { OrgUsersService } from '../org-users/org-users.service';
import { ConPlansService } from './plans/con-plans.service';
import { ProjectsService } from './projects/projects.service';
import { AccreditationDto, RulesDto } from './dto/projects.dto';

const COMPANY_ROLES = new Set(CON_ROLES.filter((r) => r.scope === 'COMPANY').map((r) => r.code));

@Injectable()
export class ConstructionService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly compliance: ComplianceService,
    private readonly plans: ConPlansService,
    private readonly orgUsers: OrgUsersService,
    private readonly projects: ProjectsService,
  ) {}

  me(con: ConContext) {
    return {
      isOwner: con.isOwner,
      companyRoles: con.companyRoles,
      projectRoles: con.projectRoles,
      plan: { code: con.plan.code, name: con.plan.name, features: con.plan.features },
      status: con.status,
    };
  }

  async dashboard(con: ConContext) {
    const [plan, health, projects, alerts] = await Promise.all([
      this.plans.mine(),
      this.compliance.health(),
      this.projects.list(con),
      this.tenantPrisma.run(async (tx) => ({
        unread: await tx.conAlert.count({ where: { readAt: null } }),
        latest: await tx.conAlert.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      })),
    ]);
    return {
      me: this.me(con),
      plan: { planCode: plan.planCode, planName: plan.planName, status: plan.status, currentPeriodEnd: plan.currentPeriodEnd, daysLeft: plan.daysLeft, graceEndsAt: plan.graceEndsAt, usage: plan.usage, limits: plan.limits },
      compliance: health,
      projects: projects.filter((p) => p.status !== 'CLOSED').slice(0, 8),
      alerts,
    };
  }

  async listRoles() {
    const rows = await this.tenantPrisma.run((tx) => tx.conRole.findMany());
    const order = CON_ROLES.map((r) => r.code);
    return rows
      .sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code))
      .map((r) => ({ code: r.code, name: r.name, scope: r.scope, approvalLimit: r.approvalLimit === null ? null : Number(r.approvalLimit) }));
  }

  async updateRoleLimit(code: ConRoleCode, dto: RoleLimitDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conRole.findUnique({ where: { organizationId_code: { organizationId, code } } });
      if (!before) throw new NotFoundException('Role not found');
      const after = await tx.conRole.update({ where: { id: before.id }, data: { approvalLimit: dto.approvalLimit } });
      await this.audit.logInTx(tx, { action: 'con_role.limit_updated', entityType: 'ConRole', entityId: after.id, before: { approvalLimit: before.approvalLimit }, after: { approvalLimit: after.approvalLimit } });
      return { code: after.code, approvalLimit: after.approvalLimit === null ? null : Number(after.approvalLimit) };
    });
  }

  /** The most someone may approve: the highest limit among their roles. null = unlimited (Director only); a role with no limit set approves nothing. */
  async approvalLimitFor(con: ConContext, roles: ConRoleCode[]): Promise<number | null> {
    if (con.isOwner || con.companyRoles.includes('CON_DIRECTOR')) return null;
    const rows = await this.tenantPrisma.run((tx) => tx.conRole.findMany({ where: { code: { in: roles } } }));
    const limits = rows.filter((r) => r.approvalLimit !== null).map((r) => Number(r.approvalLimit));
    return limits.length ? Math.max(...limits) : 0;
  }

  async listStaff() {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.orgUser.findMany({
        select: { id: true, role: true, isActive: true, user: { select: { fullName: true, email: true } }, conUserRoles: { select: { role: true } }, conProjectMembers: { select: { projectId: true, role: true, project: { select: { code: true, name: true } } } }, conAccreditation: { select: { cardNo: true, expiresAt: true } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((u) => ({
      orgUserId: u.id,
      fullName: u.user.fullName,
      email: u.user.email,
      coreRole: u.role,
      isActive: u.isActive,
      roles: u.conUserRoles.map((r) => r.role),
      projectRoles: u.conProjectMembers,
      ncaCard: u.conAccreditation ? { cardNo: u.conAccreditation.cardNo, expiresAt: u.conAccreditation.expiresAt.toISOString().slice(0, 10) } : null,
    }));
  }

  /** Names to pick from when building a project team (no emails or phone numbers). */
  async listPeople() {
    const rows = await this.tenantPrisma.run((tx) => tx.orgUser.findMany({ where: { isActive: true }, select: { id: true, role: true, user: { select: { fullName: true } }, conAccreditation: { select: { expiresAt: true } } }, orderBy: { createdAt: 'asc' } }));
    return rows.map((u) => ({ orgUserId: u.id, fullName: u.user.fullName, coreRole: u.role, ncaCardExpiresAt: u.conAccreditation?.expiresAt.toISOString().slice(0, 10) ?? null }));
  }

  async setUserRoles(orgUserId: string, roles: ConRoleCode[]) {
    const { organizationId, orgUserId: actor } = getTenantStore();
    const wrong = roles.filter((r) => !COMPANY_ROLES.has(r));
    if (wrong.length) throw new BadRequestException(`${wrong.join(', ')} ${wrong.length === 1 ? 'is a project role' : 'are project roles'} - assign it on the project instead`);
    return this.tenantPrisma.run(async (tx) => {
      const user = await tx.orgUser.findUnique({ where: { id: orgUserId }, select: { id: true, conUserRoles: { select: { role: true } } } });
      if (!user) throw new NotFoundException('Staff member not found');
      const before = user.conUserRoles.map((r) => r.role).sort();
      await tx.conUserRole.deleteMany({ where: { orgUserId, role: { notIn: roles } } });
      await tx.conUserRole.createMany({ data: roles.map((role) => ({ organizationId, orgUserId, role, createdBy: actor })), skipDuplicates: true });
      await this.audit.logInTx(tx, { action: 'con_user_roles.set', entityType: 'OrgUser', entityId: orgUserId, before: { roles: before }, after: { roles: [...roles].sort() } });
      return { orgUserId, roles };
    });
  }

  /** Adds a person by their construction job; the matching core access is set for them (office = MANAGER, site = SUPERVISOR). */
  async addStaff(dto: AddConStaffDto) {
    const job = dto.job === SITE_STAFF ? null : (dto.job as ConRoleCode);
    const role = job === 'CON_DIRECTOR' ? Role.OWNER : job ? Role.MANAGER : Role.SUPERVISOR;
    const created = await this.orgUsers.create({ email: dto.email.trim().toLowerCase(), fullName: dto.fullName?.trim() || undefined, password: dto.password || undefined, role });
    if (job) await this.setUserRoles(created.id, [job]);
    return { orgUserId: created.id, role, job };
  }

  async rules() {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => (await tx.conSettings.findUnique({ where: { organizationId } })) ?? { organizationId, ncaProjectRegRule: 'BLOCK' as const });
  }

  async setRules(dto: RulesDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conSettings.findUnique({ where: { organizationId } });
      const after = await tx.conSettings.upsert({ where: { organizationId }, create: { organizationId, ...dto }, update: dto });
      await this.audit.logInTx(tx, { action: 'con_settings.updated', entityType: 'ConSettings', entityId: organizationId, before: before ?? undefined, after });
      return after;
    });
  }

  /** The NCA accreditation card a staff member holds (needed to be a Site Supervisor). */
  async setAccreditation(orgUserId: string, dto: AccreditationDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.orgUser.findUnique({ where: { id: orgUserId } }))) throw new NotFoundException('Staff member not found');
      const before = await tx.conStaffAccreditation.findUnique({ where: { orgUserId } });
      const data = { cardNo: dto.cardNo.trim().toUpperCase(), expiresAt: new Date(`${dto.expiresAt}T00:00:00Z`) };
      const after = await tx.conStaffAccreditation.upsert({ where: { orgUserId }, create: { organizationId, orgUserId, ...data }, update: data });
      await this.audit.logInTx(tx, { action: 'con_accreditation.saved', entityType: 'ConStaffAccreditation', entityId: after.id, before: before ?? undefined, after });
      return { cardNo: after.cardNo, expiresAt: after.expiresAt.toISOString().slice(0, 10) };
    });
  }
}
