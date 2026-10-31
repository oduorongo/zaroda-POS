import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { PlantDto, PlantLogDto } from '../dto/materials.dto';
import { plantCost } from './materials.util';

const day = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Plant register (owned or hired), daily logs of hours and fuel, and what plant costs each project. */
@Injectable()
export class PlantService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list() {
    const rows = await this.tenantPrisma.run((tx) => tx.conPlant.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }], include: { supplier: { select: { id: true, name: true } }, project: { select: { id: true, code: true } } } }));
    return rows.map((p) => ({ id: p.id, name: p.name, regNo: p.regNo, ownership: p.ownership, hireRate: num(p.hireRate), rateUnit: p.rateUnit, supplier: p.supplier, project: p.project, isActive: p.isActive }));
  }

  async save(con: ConContext, dto: PlantDto, id?: string) {
    if (dto.ownership === 'HIRED' && (dto.hireRate === undefined || dto.hireRate <= 0)) throw new BadRequestException('Enter the hire rate for hired plant.');
    return this.tenantPrisma.run(async (tx) => {
      if (dto.supplierId && !(await tx.supplier.findUnique({ where: { id: dto.supplierId } }))) throw new NotFoundException('Supplier not found');
      if (dto.projectId && !(await tx.conProject.findUnique({ where: { id: dto.projectId } }))) throw new NotFoundException('Project not found');
      const data = { name: dto.name.trim(), regNo: dto.regNo?.trim().toUpperCase() || null, ownership: dto.ownership, hireRate: dto.hireRate ?? null, rateUnit: dto.rateUnit ?? 'DAY', supplierId: dto.supplierId ?? null, projectId: dto.projectId ?? null, isActive: dto.isActive ?? true };
      if (!id) {
        const after = await tx.conPlant.create({ data: { organizationId: con.organizationId, createdBy: con.orgUserId, ...data } });
        await this.audit.logInTx(tx, { action: 'con_plant.created', entityType: 'ConPlant', entityId: after.id, after });
        return after;
      }
      const before = await tx.conPlant.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Plant not found');
      const after = await tx.conPlant.update({ where: { id }, data });
      await this.audit.logInTx(tx, { action: 'con_plant.updated', entityType: 'ConPlant', entityId: id, before, after });
      return after;
    });
  }

  /** One log per machine per day; logging again for the same day corrects it. */
  async log(con: ConContext, projectId: string, dto: PlantLogDto) {
    if (dto.date > todayKey()) throw new BadRequestException('Plant cannot be logged for a future day.');
    if ((dto.fuelCost ?? 0) > 0 && !dto.fuelLitres) throw new BadRequestException('Enter the litres for the fuel cost.');
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.conProject.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Project not found');
      const plant = await tx.conPlant.findUnique({ where: { id: dto.plantId } });
      if (!plant) throw new NotFoundException('Plant not found');
      if (!plant.isActive) throw new ConflictException(`${plant.name} is no longer in use.`);
      const d = new Date(`${dto.date}T00:00:00Z`);
      const before = await tx.conPlantLog.findUnique({ where: { plantId_date: { plantId: dto.plantId, date: d } } });
      if (before && before.projectId !== projectId) throw new ConflictException(`${plant.name} is already logged on another project for ${dto.date}.`);
      const data = { hours: dto.hours, fuelLitres: dto.fuelLitres ?? null, fuelCost: dto.fuelCost ?? null, operator: dto.operator?.trim() || null, notes: dto.notes?.trim() || null };
      const after = await tx.conPlantLog.upsert({
        where: { plantId_date: { plantId: dto.plantId, date: d } },
        create: { organizationId: con.organizationId, plantId: dto.plantId, projectId, date: d, createdBy: con.orgUserId, ...data },
        update: data,
      });
      await this.audit.logInTx(tx, { action: before ? 'con_plant_log.corrected' : 'con_plant_log.created', entityType: 'ConPlantLog', entityId: after.id, before: before ?? undefined, after });
      return after;
    });
  }

  async logs(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conPlantLog.findMany({ where: { projectId }, orderBy: { date: 'desc' }, take: 200, include: { plant: { select: { name: true, regNo: true } } } }));
    return rows.map((l) => ({ id: l.id, plant: l.plant.name, regNo: l.plant.regNo, plantId: l.plantId, date: day(l.date), hours: Number(l.hours), fuelLitres: num(l.fuelLitres), fuelCost: num(l.fuelCost), operator: l.operator, notes: l.notes }));
  }

  /** Plant cost on a project: per machine, hours, days, fuel and hire, and the total. */
  async projectCost(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const logs = await tx.conPlantLog.findMany({ where: { projectId }, include: { plant: true } });
      const byPlant = new Map<string, typeof logs>();
      for (const l of logs) byPlant.set(l.plantId, [...(byPlant.get(l.plantId) ?? []), l]);
      const rows = [...byPlant.values()].map((ls) => {
        const p = ls[0].plant;
        return { plantId: p.id, name: p.name, regNo: p.regNo, ownership: p.ownership, rateUnit: p.rateUnit, hireRate: num(p.hireRate), ...plantCost({ ownership: p.ownership, hireRate: num(p.hireRate), rateUnit: p.rateUnit }, ls.map((l) => ({ hours: Number(l.hours), fuelLitres: num(l.fuelLitres), fuelCost: num(l.fuelCost) }))) };
      });
      return { rows: rows.sort((a, b) => b.total - a.total), total: Math.round(rows.reduce((a, r) => a + r.total, 0) * 100) / 100 };
    });
  }
}
