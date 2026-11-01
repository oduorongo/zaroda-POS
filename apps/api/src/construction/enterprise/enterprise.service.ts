import { createHash, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../../common/tenant/tenant-context';
import { CON_ROLES } from '../common/con-defaults';
import { parseGrants } from '../common/con-setup.service';
import { ApiKeyDto, AssignCustomRolesDto, AssignOfficeDto, CustomRoleDto, OfficeDto } from '../dto/enterprise.dto';

const unique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');
const ROLE_NAMES = new Map(CON_ROLES.map((r) => [r.code, r.name]));

/** Enterprise (docs/construction/05): branch offices, custom roles and read-only API keys. All set by the Director, all audited. */
@Injectable()
export class EnterpriseService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  // ── Branch offices ──

  async offices() {
    const rows = await this.tenantPrisma.run((tx) => tx.conOffice.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { projects: true, staff: true } } } }));
    return rows.map((o) => ({ id: o.id, name: o.name, county: o.county, projects: o._count.projects, staff: o._count.staff }));
  }

  async saveOffice(dto: OfficeDto, id?: string) {
    const { organizationId } = getTenantStore();
    const data = { name: dto.name.trim(), county: dto.county?.trim() || null };
    return this.tenantPrisma.run(async (tx) => {
      const before = id ? await tx.conOffice.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Office not found');
      try {
        const after = id ? await tx.conOffice.update({ where: { id }, data }) : await tx.conOffice.create({ data: { organizationId, ...data } });
        await this.audit.logInTx(tx, { action: id ? 'con_office.updated' : 'con_office.created', entityType: 'ConOffice', entityId: after.id, before: before ?? undefined, after });
        return after;
      } catch (e) {
        if (unique(e)) throw new ConflictException('There is already an office with that name');
        throw e;
      }
    });
  }

  /** Projects in it become company-wide again; its staff see every project again. */
  async removeOffice(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conOffice.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Office not found');
      await tx.conOffice.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_office.deleted', entityType: 'ConOffice', entityId: id, before });
      return { deleted: true };
    });
  }

  private async office(tx: Prisma.TransactionClient, officeId: string | null) {
    if (officeId && !(await tx.conOffice.findUnique({ where: { id: officeId } }))) throw new NotFoundException('Office not found');
  }

  async setStaffOffice(orgUserId: string, dto: AssignOfficeDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.orgUser.findUnique({ where: { id: orgUserId } }))) throw new NotFoundException('Staff member not found');
      await this.office(tx, dto.officeId);
      const before = await tx.conUserOffice.findUnique({ where: { orgUserId } });
      if (dto.officeId) await tx.conUserOffice.upsert({ where: { orgUserId }, create: { organizationId, orgUserId, officeId: dto.officeId }, update: { officeId: dto.officeId } });
      else await tx.conUserOffice.deleteMany({ where: { orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_user_office.set', entityType: 'OrgUser', entityId: orgUserId, before: { officeId: before?.officeId ?? null }, after: { officeId: dto.officeId } });
      return { orgUserId, officeId: dto.officeId };
    });
  }

  async setProjectOffice(projectId: string, dto: AssignOfficeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await tx.conProject.findUnique({ where: { id: projectId } });
      if (!p) throw new NotFoundException('Project not found');
      await this.office(tx, dto.officeId);
      await tx.conProject.update({ where: { id: projectId }, data: { officeId: dto.officeId } });
      await this.audit.logInTx(tx, { action: 'con_project.office_set', entityType: 'ConProject', entityId: projectId, before: { officeId: p.officeId }, after: { officeId: dto.officeId } });
      return { projectId, officeId: dto.officeId };
    });
  }

  // ── Custom roles ──

  async customRoles() {
    const rows = await this.tenantPrisma.run((tx) => tx.conCustomRole.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { holders: true } } } }));
    return rows.map((r) => {
      const grants = parseGrants(r.grants);
      return { id: r.id, name: r.name, grants, grantNames: grants.map((g) => ROLE_NAMES.get(g) ?? g), approvalLimit: r.approvalLimit === null ? null : Number(r.approvalLimit), holders: r._count.holders };
    });
  }

  async saveCustomRole(dto: CustomRoleDto, id?: string) {
    const { organizationId, orgUserId } = getTenantStore();
    if (!dto.grants.length) throw new BadRequestException('Choose at least one job this role acts as');
    const data = { name: dto.name.trim(), grants: [...new Set(dto.grants)], approvalLimit: dto.approvalLimit ?? null };
    return this.tenantPrisma.run(async (tx) => {
      const before = id ? await tx.conCustomRole.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Role not found');
      try {
        const after = id ? await tx.conCustomRole.update({ where: { id }, data }) : await tx.conCustomRole.create({ data: { organizationId, createdBy: orgUserId, ...data } });
        await this.audit.logInTx(tx, { action: id ? 'con_custom_role.updated' : 'con_custom_role.created', entityType: 'ConCustomRole', entityId: after.id, before: before ?? undefined, after });
        return { id: after.id, name: after.name, grants: parseGrants(after.grants), approvalLimit: after.approvalLimit === null ? null : Number(after.approvalLimit) };
      } catch (e) {
        if (unique(e)) throw new ConflictException('There is already a role with that name');
        throw e;
      }
    });
  }

  async removeCustomRole(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conCustomRole.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Role not found');
      await tx.conCustomRole.delete({ where: { id } });
      await this.audit.logInTx(tx, { action: 'con_custom_role.deleted', entityType: 'ConCustomRole', entityId: id, before });
      return { deleted: true };
    });
  }

  async setStaffCustomRoles(orgUserId: string, dto: AssignCustomRolesDto) {
    const { organizationId } = getTenantStore();
    const ids = [...new Set(dto.customRoleIds)];
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.orgUser.findUnique({ where: { id: orgUserId } }))) throw new NotFoundException('Staff member not found');
      if ((await tx.conCustomRole.count({ where: { id: { in: ids } } })) !== ids.length) throw new NotFoundException('Role not found');
      const before = (await tx.conUserCustomRole.findMany({ where: { orgUserId } })).map((r) => r.customRoleId).sort();
      await tx.conUserCustomRole.deleteMany({ where: { orgUserId, customRoleId: { notIn: ids } } });
      await tx.conUserCustomRole.createMany({ data: ids.map((customRoleId) => ({ organizationId, orgUserId, customRoleId })), skipDuplicates: true });
      await this.audit.logInTx(tx, { action: 'con_user_custom_roles.set', entityType: 'OrgUser', entityId: orgUserId, before: { customRoleIds: before }, after: { customRoleIds: ids.sort() } });
      return { orgUserId, customRoleIds: ids };
    });
  }

  // ── API keys ──

  async apiKeys() {
    const rows = await this.tenantPrisma.run((tx) => tx.conApiKey.findMany({ orderBy: { createdAt: 'desc' } }));
    return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, lastUsedAt: k.lastUsedAt, requests: k.requests, revokedAt: k.revokedAt, createdAt: k.createdAt }));
  }

  /** The key is returned once, here; only its hash is kept. */
  async createApiKey(dto: ApiKeyDto) {
    const { organizationId, orgUserId } = getTenantStore();
    if (!dto.scopes.length) throw new BadRequestException('Choose what the key may read');
    const prefix = randomBytes(6).toString('hex');
    const key = `zcon_${prefix}_${randomBytes(24).toString('base64url')}`;
    return this.tenantPrisma.run(async (tx) => {
      const row = await tx.conApiKey.create({ data: { organizationId, name: dto.name.trim(), prefix, keyHash: hashApiKey(key), scopes: [...new Set(dto.scopes)], createdBy: orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_api_key.created', entityType: 'ConApiKey', entityId: row.id, after: { name: row.name, prefix, scopes: row.scopes } });
      return { id: row.id, name: row.name, prefix, scopes: row.scopes, key };
    });
  }

  async revokeApiKey(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const k = await tx.conApiKey.findUnique({ where: { id } });
      if (!k) throw new NotFoundException('API key not found');
      if (k.revokedAt) return { id, revokedAt: k.revokedAt };
      const after = await tx.conApiKey.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_api_key.revoked', entityType: 'ConApiKey', entityId: id, before: { revokedAt: null }, after: { revokedAt: after.revokedAt } });
      return { id, revokedAt: after.revokedAt };
    });
  }
}
