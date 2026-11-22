import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmRoleCode, FarmUnitKind } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import type { FarmContext } from './farm-access';
import { upgradeError } from './farm-access';
import { FarmSetupService } from './farm-setup.service';
import { CreateFarmEnterpriseDto, CreateFarmUnitDto, SetFarmRolesDto, UpdateFarmEnterpriseDto, UpdateFarmSettingsDto, UpdateFarmUnitDto } from './dto/farm.dto';
import { FarmLimitKey, limitProblem } from './farm-plans.util';

/** Land units whose acres count toward the plan (blocks only group them, so counting both would double the land). */
const LAND: FarmUnitKind[] = [FarmUnitKind.FIELD, FarmUnitKind.PADDOCK];

@Injectable()
export class FarmService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly setup: FarmSetupService,
    private readonly audit: AuditLogService,
  ) {}

  /** What the farm uses of each plan limit. Livestock head and birds start counting in F2. */
  async usage(tx: TenantTx): Promise<Record<FarmLimitKey, number>> {
    const [land, people] = await Promise.all([
      tx.farmUnit.aggregate({ where: { active: true, kind: { in: LAND } }, _sum: { acres: true } }),
      tx.farmUserRole.findMany({ select: { orgUserId: true }, distinct: ['orgUserId'] }),
    ]);
    return { head: 0, birds: 0, acres: Number(land._sum.acres ?? 0), users: people.length };
  }

  private async checkLimit(tx: TenantTx, farm: FarmContext, key: FarmLimitKey, extra: number) {
    if (extra <= 0) return;
    const used = (await this.usage(tx))[key];
    const problem = limitProblem(farm.plan, await this.setup.activePlans(), key, used, extra);
    if (problem) throw upgradeError(problem.message, { limit: key, requiredPlan: problem.requiredPlan });
  }

  overview(farm: FarmContext) {
    return this.tenantPrisma.run(async (tx) => {
      const [settings, sub, usage, units, enterprises] = await Promise.all([
        tx.farmSettings.findFirst(),
        tx.farmSubscription.findFirst(),
        this.usage(tx),
        tx.farmUnit.count({ where: { active: true } }),
        tx.farmEnterprise.count({ where: { active: true } }),
      ]);
      return {
        settings,
        plan: farm.plan,
        status: farm.status,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        usage,
        counts: { units, enterprises },
        me: { isOwner: farm.isOwner, roles: farm.roles, unitIds: farm.unitIds },
      };
    });
  }

  updateSettings(dto: UpdateFarmSettingsDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmSettings.findFirst();
      if (!before) throw new NotFoundException('Farm settings not found');
      const after = await tx.farmSettings.update({
        where: { id: before.id },
        data: {
          farmName: dto.farmName?.trim() ?? undefined,
          county: dto.county === undefined ? undefined : dto.county.trim() || null,
          subCounty: dto.subCounty === undefined ? undefined : dto.subCounty.trim() || null,
          ward: dto.ward === undefined ? undefined : dto.ward.trim() || null,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.settings_updated', entityType: 'FarmSettings', entityId: after.id, before, after });
      return after;
    });
  }

  // ── Farm layout ─────────────────────────────────────────────────────────

  listUnits() {
    return this.tenantPrisma.run((tx) => tx.farmUnit.findMany({ orderBy: [{ active: 'desc' }, { kind: 'asc' }, { name: 'asc' }] }));
  }

  createUnit(farm: FarmContext, dto: CreateFarmUnitDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      if (dto.parentId && !(await tx.farmUnit.findUnique({ where: { id: dto.parentId } }))) throw new BadRequestException('The unit it sits in was not found');
      if (dto.branchId && !(await tx.branch.findUnique({ where: { id: dto.branchId } }))) throw new BadRequestException('Farm site not found');
      if (LAND.includes(dto.kind)) await this.checkLimit(tx, farm, 'acres', dto.acres ?? 0);
      const unit = await tx.farmUnit.create({
        data: {
          organizationId,
          kind: dto.kind,
          name: dto.name.trim(),
          code: dto.code?.trim() || null,
          parentId: dto.parentId ?? null,
          branchId: dto.branchId ?? null,
          acres: dto.acres ?? null,
          capacity: dto.capacity ?? null,
          notes: dto.notes?.trim() || null,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.unit_created', entityType: 'FarmUnit', entityId: unit.id, after: unit });
      return unit;
    });
  }

  updateUnit(farm: FarmContext, id: string, dto: UpdateFarmUnitDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmUnit.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Unit not found');
      if (LAND.includes(before.kind)) {
        const wasCounting = before.active ? Number(before.acres ?? 0) : 0;
        const willCount = (dto.active ?? before.active) ? Number(dto.acres ?? before.acres ?? 0) : 0;
        await this.checkLimit(tx, farm, 'acres', willCount - wasCounting);
      }
      const after = await tx.farmUnit.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          code: dto.code === undefined ? undefined : dto.code.trim() || null,
          acres: dto.acres,
          capacity: dto.capacity,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          active: dto.active,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.unit_updated', entityType: 'FarmUnit', entityId: id, before, after });
      return after;
    });
  }

  // ── Enterprises ─────────────────────────────────────────────────────────

  listEnterprises() {
    return this.tenantPrisma.run((tx) => tx.farmEnterprise.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] }));
  }

  private async checkUnits(tx: TenantTx, unitIds: string[] | undefined) {
    if (!unitIds?.length) return;
    const found = await tx.farmUnit.count({ where: { id: { in: unitIds } } });
    if (found !== new Set(unitIds).size) throw new BadRequestException('One of the units was not found');
  }

  createEnterprise(dto: CreateFarmEnterpriseDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      await this.checkUnits(tx, dto.unitIds);
      const e = await tx.farmEnterprise.create({ data: { organizationId, kind: dto.kind, name: dto.name.trim(), unitIds: [...new Set(dto.unitIds ?? [])] } });
      await this.audit.logInTx(tx, { action: 'farm.enterprise_created', entityType: 'FarmEnterprise', entityId: e.id, after: e });
      return e;
    });
  }

  updateEnterprise(id: string, dto: UpdateFarmEnterpriseDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.farmEnterprise.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Enterprise not found');
      await this.checkUnits(tx, dto.unitIds);
      const after = await tx.farmEnterprise.update({
        where: { id },
        data: { name: dto.name?.trim(), unitIds: dto.unitIds ? [...new Set(dto.unitIds)] : undefined, active: dto.active },
      });
      await this.audit.logInTx(tx, { action: 'farm.enterprise_updated', entityType: 'FarmEnterprise', entityId: id, before, after });
      return after;
    });
  }

  // ── Staff and farm roles ────────────────────────────────────────────────

  listStaff() {
    return this.tenantPrisma.run(async (tx) => {
      const [people, roles] = await Promise.all([
        tx.orgUser.findMany({ where: { isActive: true }, select: { id: true, role: true, user: { select: { fullName: true, email: true } } }, orderBy: { user: { fullName: 'asc' } } }),
        tx.farmUserRole.findMany(),
      ]);
      return people.map((p) => ({
        orgUserId: p.id,
        name: p.user.fullName,
        email: p.user.email,
        staffRole: p.role,
        farmRoles: roles.filter((r) => r.orgUserId === p.id).map((r) => r.role),
        unitIds: [...new Set(roles.filter((r) => r.orgUserId === p.id).flatMap((r) => r.unitIds))],
      }));
    });
  }

  /** Replaces a person's farm roles. Only the farm owner may do this; people with a farm role count toward the plan's users. */
  setRoles(farm: FarmContext, orgUserId: string, dto: SetFarmRolesDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const person = await tx.orgUser.findUnique({ where: { id: orgUserId } });
      if (!person || !person.isActive) throw new NotFoundException('Staff member not found');
      if (orgUserId === farm.orgUserId && !dto.roles.includes(FarmRoleCode.FARM_OWNER) && farm.roles.includes(FarmRoleCode.FARM_OWNER)) {
        throw new BadRequestException('You cannot remove your own Farm owner role');
      }
      await this.checkUnits(tx, dto.unitIds);
      const before = await tx.farmUserRole.findMany({ where: { orgUserId } });
      if (before.length === 0 && dto.roles.length > 0) await this.checkLimit(tx, farm, 'users', 1);
      await tx.farmUserRole.deleteMany({ where: { orgUserId } });
      const unitIds = [...new Set(dto.unitIds ?? [])];
      await tx.farmUserRole.createMany({ data: [...new Set(dto.roles)].map((role) => ({ organizationId, orgUserId, role, unitIds })) });
      await this.audit.logInTx(tx, {
        action: 'farm.roles_set',
        entityType: 'OrgUser',
        entityId: orgUserId,
        before: before.map((r) => ({ role: r.role, unitIds: r.unitIds })),
        after: { roles: dto.roles, unitIds },
      });
      return { orgUserId, roles: dto.roles, unitIds };
    });
  }
}
