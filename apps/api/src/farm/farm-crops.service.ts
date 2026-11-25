import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmCropSeason, InventoryTxnType, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { FarmContext } from './farm-access';
import { FarmLivestockService } from './farm-livestock.service';
import { asDate, dayOf, todayKey } from './farm-livestock.util';
import { blockedUntil, kgPerUnitFor, safeHarvestFrom, seasonFigures } from './farm-crops.util';
import { CreateSeasonDto, CropActivityDto, HarvestDto, UpdateSeasonDto } from './dto/crops.dto';
import { VoidDto } from './dto/livestock.dto';

const LAND = ['FIELD', 'PADDOCK', 'OTHER'];
const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));

/** Zaroda Shamba F4: crop seasons per field, field work with inputs from stock, spraying with pre-harvest intervals, harvests into stock. */
@Injectable()
export class FarmCropsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly audit: AuditLogService,
  ) {}

  private mustSee(farm: FarmContext, unitId: string | null) {
    if (!FarmLivestockService.sees(farm, unitId)) throw new ForbiddenException('That field is outside the parts of the farm you work in.');
  }

  private noFuture(day: string) {
    if (day > todayKey()) throw new BadRequestException('The date cannot be in the future');
  }

  private async season(tx: TenantTx, farm: FarmContext, id: string): Promise<FarmCropSeason> {
    const s = await tx.farmCropSeason.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Crop season not found');
    this.mustSee(farm, s.unitId);
    return s;
  }

  /** Stock moves at the field's own branch, else the produce branch, else the farm's first branch. */
  private async stockBranch(tx: TenantTx, unitId: string): Promise<string | null> {
    const unit = await tx.farmUnit.findUnique({ where: { id: unitId }, select: { branchId: true } });
    if (unit?.branchId) return unit.branchId;
    const settings = await tx.farmProduceSettings.findFirst({ select: { branchId: true } });
    if (settings?.branchId) return settings.branchId;
    return (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id ?? null;
  }

  private async moveStock(tx: TenantTx, branchId: string | null, variantId: string | null, qty: number, referenceId: string) {
    if (!branchId || !variantId || qty === 0) return;
    await this.inventory.recordInTx(tx, { branchId, variantId, type: InventoryTxnType.PRODUCTION, quantityDelta: Math.round(qty * 1000) / 1000, referenceId });
  }

  private async figuresFor(tx: TenantTx, seasons: FarmCropSeason[]) {
    const ids = seasons.map((s) => s.id);
    const [acts, harvests] = await Promise.all([
      ids.length ? tx.farmCropActivity.findMany({ where: { seasonId: { in: ids }, voidedAt: null } }) : [],
      ids.length ? tx.farmHarvest.findMany({ where: { seasonId: { in: ids }, voidedAt: null } }) : [],
    ]);
    return new Map(
      seasons.map((s) => {
        const a = acts.filter((x) => x.seasonId === s.id);
        const fig = seasonFigures(num(s.acres), a.map((x) => ({ inputCost: num(x.inputCost), labourCost: num(x.labourCost) })), harvests.filter((h) => h.seasonId === s.id).map((h) => ({ kg: num(h.kg) })));
        const until = blockedUntil(a.filter((x) => x.kind === 'SPRAYING').map((x) => ({ safeHarvestFrom: x.safeHarvestFrom ? dayOf(x.safeHarvestFrom) : null })));
        return [s.id, { ...fig, safeHarvestFrom: until && until > todayKey() ? until : null }];
      }),
    );
  }

  // ── Seasons ─────────────────────────────────────────────────────────────

  listSeasons(farm: FarmContext, status?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const where: Prisma.FarmCropSeasonWhereInput = {
        ...(farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } }),
        ...(status === 'ALL' ? {} : status === 'CLOSED' ? { status: 'CLOSED' } : { status: { not: 'CLOSED' } }),
      };
      const seasons = await tx.farmCropSeason.findMany({ where, orderBy: [{ plantedOn: 'desc' }, { createdAt: 'desc' }], take: 300 });
      const [units, figures] = await Promise.all([
        tx.farmUnit.findMany({ where: { id: { in: [...new Set(seasons.map((s) => s.unitId))] } }, select: { id: true, name: true } }),
        this.figuresFor(tx, seasons),
      ]);
      return seasons.map((s) => ({ ...s, acres: num(s.acres), unitName: units.find((u) => u.id === s.unitId)?.name ?? '', ...figures.get(s.id) }));
    });
  }

  getSeason(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.season(tx, farm, id);
      const [activities, harvests, unit, enterprise, figures] = await Promise.all([
        tx.farmCropActivity.findMany({ where: { seasonId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmHarvest.findMany({ where: { seasonId: id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
        tx.farmUnit.findUnique({ where: { id: s.unitId }, select: { name: true, acres: true } }),
        s.enterpriseId ? tx.farmEnterprise.findUnique({ where: { id: s.enterpriseId }, select: { name: true } }) : null,
        this.figuresFor(tx, [s]),
      ]);
      const variantIds = [...new Set([...activities.map((a) => a.inputVariantId), ...harvests.map((h) => h.stockVariantId)].filter((x): x is string => !!x))];
      const variants = variantIds.length ? await tx.productVariant.findMany({ where: { id: { in: variantIds } }, include: { product: { select: { name: true, baseUnit: true } } } }) : [];
      const vName = (vid: string | null) => {
        const v = variants.find((x) => x.id === vid);
        return v ? `${v.product.name}${v.name ? ` - ${v.name}` : ''}` : null;
      };
      return {
        ...s,
        acres: num(s.acres),
        unitName: unit?.name ?? '',
        unitAcres: unit?.acres === null || unit?.acres === undefined ? null : num(unit.acres),
        enterpriseName: enterprise?.name ?? null,
        ...figures.get(s.id),
        activities: activities.map((a) => ({ ...a, quantity: a.quantity === null ? null : num(a.quantity), inputCost: num(a.inputCost), labourCost: num(a.labourCost), inputName: vName(a.inputVariantId) })),
        harvests: harvests.map((h) => ({ ...h, quantity: num(h.quantity), kgPerUnit: num(h.kgPerUnit), kg: num(h.kg), stockName: vName(h.stockVariantId) })),
      };
    });
  }

  createSeason(farm: FarmContext, dto: CreateSeasonDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const unit = await tx.farmUnit.findUnique({ where: { id: dto.unitId } });
      if (!unit || !unit.active) throw new BadRequestException('That field was not found');
      this.mustSee(farm, unit.id);
      if (!LAND.includes(unit.kind)) throw new BadRequestException(`${unit.name} is not a field or paddock`);
      if (unit.acres !== null && dto.acres > num(unit.acres)) throw new BadRequestException(`${unit.name} has only ${num(unit.acres)} acres`);
      if (dto.enterpriseId && !(await tx.farmEnterprise.findUnique({ where: { id: dto.enterpriseId } }))) throw new BadRequestException('Enterprise not found');
      if (dto.plantedOn) this.noFuture(dto.plantedOn);
      if (dto.plantedOn && dto.expectedHarvest && dto.expectedHarvest < dto.plantedOn) throw new BadRequestException('The expected harvest is before planting');
      const s = await tx.farmCropSeason.create({
        data: {
          organizationId, unitId: unit.id, enterpriseId: dto.enterpriseId ?? null, crop: dto.crop.trim(), variety: dto.variety?.trim() || null, acres: dto.acres,
          plantedOn: dto.plantedOn ? asDate(dto.plantedOn) : null, expectedHarvest: dto.expectedHarvest ? asDate(dto.expectedHarvest) : null,
          status: dto.plantedOn ? 'GROWING' : 'PLANNED', seedSupplier: dto.seedSupplier?.trim() || null, seedCertNo: dto.seedCertNo?.trim() || null,
          notes: dto.notes?.trim() || null, createdBy: orgUserId,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.crop_season_created', entityType: 'FarmCropSeason', entityId: s.id, after: s });
      return s;
    });
  }

  updateSeason(farm: FarmContext, id: string, dto: UpdateSeasonDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.season(tx, farm, id);
      if (before.status === 'CLOSED') throw new BadRequestException('This season is closed');
      if (dto.status === 'CLOSED') throw new BadRequestException('Use "Close season" to close it');
      const plantedOn = dto.plantedOn ?? (before.plantedOn ? dayOf(before.plantedOn) : undefined);
      if (dto.plantedOn) this.noFuture(dto.plantedOn);
      if (plantedOn && dto.expectedHarvest && dto.expectedHarvest < plantedOn) throw new BadRequestException('The expected harvest is before planting');
      const after = await tx.farmCropSeason.update({
        where: { id },
        data: {
          variety: dto.variety === undefined ? undefined : dto.variety.trim() || null,
          plantedOn: dto.plantedOn ? asDate(dto.plantedOn) : undefined,
          expectedHarvest: dto.expectedHarvest ? asDate(dto.expectedHarvest) : undefined,
          status: dto.status ?? (dto.plantedOn && before.status === 'PLANNED' ? 'GROWING' : undefined),
          seedSupplier: dto.seedSupplier === undefined ? undefined : dto.seedSupplier.trim() || null,
          seedCertNo: dto.seedCertNo === undefined ? undefined : dto.seedCertNo.trim() || null,
          notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
        },
      });
      await this.audit.logInTx(tx, { action: 'farm.crop_season_updated', entityType: 'FarmCropSeason', entityId: id, before, after });
      return after;
    });
  }

  closeSeason(farm: FarmContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.season(tx, farm, id);
      if (before.status === 'CLOSED') throw new BadRequestException('Already closed');
      const after = await tx.farmCropSeason.update({ where: { id }, data: { status: 'CLOSED', closedOn: asDate(todayKey()) } });
      await this.audit.logInTx(tx, { action: 'farm.crop_season_closed', entityType: 'FarmCropSeason', entityId: id, before, after });
      return after;
    });
  }

  // ── Field work ──────────────────────────────────────────────────────────

  /** Field work. Inputs come off stock at their cost; a spray needs the chemical and its pre-harvest interval. */
  addActivity(farm: FarmContext, seasonId: string, dto: CropActivityDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const s = await this.season(tx, farm, seasonId);
      if (s.status === 'CLOSED') throw new BadRequestException('This season is closed');
      this.noFuture(dto.date);
      if (dto.kind === 'SPRAYING') {
        if (!dto.product?.trim()) throw new BadRequestException('Name the chemical sprayed, as on the label');
        if (dto.preHarvestDays === undefined) throw new BadRequestException('Enter the pre-harvest interval (days) from the label - 0 if it has none');
      }
      if (!!dto.inputVariantId !== !!dto.quantity) throw new BadRequestException('Choose the stock item and how much was used together');

      let inputCost = dto.inputCost ?? 0;
      let branchId: string | null = null;
      if (dto.inputVariantId) {
        const v = await tx.productVariant.findUnique({ where: { id: dto.inputVariantId } });
        if (!v) throw new BadRequestException('That stock item was not found');
        if (dto.inputCost === undefined && v.cost !== null) inputCost = Math.round(num(v.cost) * dto.quantity! * 100) / 100;
        branchId = await this.stockBranch(tx, s.unitId);
      }
      const safe = dto.kind === 'SPRAYING' ? safeHarvestFrom(dto.date, dto.preHarvestDays) : null;
      const a = await tx.farmCropActivity.create({
        data: {
          organizationId, seasonId, date: asDate(dto.date), kind: dto.kind, product: dto.product?.trim() || null, rate: dto.rate?.trim() || null,
          inputVariantId: dto.inputVariantId ?? null, quantity: dto.quantity ?? null, stockBranchId: branchId, inputCost, workers: dto.workers ?? null,
          labourCost: dto.labourCost ?? 0, preHarvestDays: dto.kind === 'SPRAYING' ? dto.preHarvestDays ?? 0 : null, safeHarvestFrom: safe ? asDate(safe) : null,
          doneBy: dto.doneBy?.trim() || null, notes: dto.notes?.trim() || null, createdBy: orgUserId,
        },
      });
      if (dto.inputVariantId) await this.moveStock(tx, branchId, dto.inputVariantId, -dto.quantity!, a.id);
      if (dto.kind === 'PLANTING' && s.status === 'PLANNED') {
        await tx.farmCropSeason.update({ where: { id: seasonId }, data: { status: 'GROWING', plantedOn: s.plantedOn ?? asDate(dto.date) } });
      }
      await this.audit.logInTx(tx, { action: 'farm.crop_activity_recorded', entityType: 'FarmCropActivity', entityId: a.id, after: a });
      return { ...a, inputCost, safeHarvestFrom: safe };
    });
  }

  voidActivity(farm: FarmContext, id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const a = await tx.farmCropActivity.findUnique({ where: { id } });
      if (!a) throw new NotFoundException('Field record not found');
      if (a.voidedAt) throw new BadRequestException('Already voided');
      await this.season(tx, farm, a.seasonId);
      if (a.inputVariantId && a.quantity !== null) await this.moveStock(tx, a.stockBranchId, a.inputVariantId, num(a.quantity), a.id);
      const after = await tx.farmCropActivity.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.crop_activity_voided', entityType: 'FarmCropActivity', entityId: id, before: a, after });
      return after;
    });
  }

  // ── Harvests ────────────────────────────────────────────────────────────

  /** A harvest. Refused before the last spray's pre-harvest interval ends; goes into stock when a product is chosen. */
  addHarvest(farm: FarmContext, seasonId: string, dto: HarvestDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const s = await this.season(tx, farm, seasonId);
      if (s.status === 'CLOSED') throw new BadRequestException('This season is closed');
      this.noFuture(dto.date);
      if (s.plantedOn && dto.date < dayOf(s.plantedOn)) throw new BadRequestException('The harvest is before the planting date');

      const sprays = await tx.farmCropActivity.findMany({ where: { seasonId, kind: 'SPRAYING', voidedAt: null, date: { lte: asDate(dto.date) } }, orderBy: { date: 'desc' } });
      const latest = sprays
        .filter((x) => x.safeHarvestFrom && dayOf(x.safeHarvestFrom) > dto.date)
        .sort((x, y) => dayOf(y.safeHarvestFrom!).localeCompare(dayOf(x.safeHarvestFrom!)))[0];
      if (latest) {
        throw new ConflictException(
          `${s.crop} was sprayed with ${latest.product} on ${dayOf(latest.date)}. Its pre-harvest interval is ${latest.preHarvestDays} days, so harvest is not allowed until ${dayOf(latest.safeHarvestFrom!)}.`,
        );
      }

      const kgPerUnit = kgPerUnitFor(dto.unit, dto.kgPerUnit);
      if (kgPerUnit === null) throw new BadRequestException(`How many kg is one ${dto.unit}? Enter kg per unit so yield per acre and cost per kg can be worked out.`);

      let branchId: string | null = null;
      let stockQty = 0;
      if (dto.variantId) {
        const v = await tx.productVariant.findUnique({ where: { id: dto.variantId }, include: { product: { select: { baseUnit: true } } } });
        if (!v) throw new BadRequestException('That product was not found');
        stockQty = dto.stockQuantity ?? (v.product.baseUnit.trim().toLowerCase() === 'kg' ? dto.quantity * kgPerUnit : dto.quantity);
        branchId = await this.stockBranch(tx, s.unitId);
      }
      const h = await tx.farmHarvest.create({
        data: {
          organizationId, seasonId, date: asDate(dto.date), quantity: dto.quantity, unit: dto.unit.trim(), kgPerUnit, kg: Math.round(dto.quantity * kgPerUnit * 1000) / 1000,
          grade: dto.grade?.trim() || null, stockVariantId: dto.variantId ?? null, stockBranchId: branchId, notes: dto.notes?.trim() || null, createdBy: orgUserId,
        },
      });
      if (dto.variantId) await this.moveStock(tx, branchId, dto.variantId, stockQty, h.id);
      if (s.status !== 'HARVESTING') await tx.farmCropSeason.update({ where: { id: seasonId }, data: { status: 'HARVESTING' } });
      await this.audit.logInTx(tx, { action: 'farm.harvest_recorded', entityType: 'FarmHarvest', entityId: h.id, after: { ...h, stockQty } });
      return { ...h, quantity: num(h.quantity), kg: num(h.kg), stockQty };
    });
  }

  voidHarvest(farm: FarmContext, id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const h = await tx.farmHarvest.findUnique({ where: { id } });
      if (!h) throw new NotFoundException('Harvest not found');
      if (h.voidedAt) throw new BadRequestException('Already voided');
      await this.season(tx, farm, h.seasonId);
      if (h.stockVariantId) {
        const moved = await tx.inventoryTransaction.aggregate({ where: { referenceId: h.id, variantId: h.stockVariantId }, _sum: { quantityDelta: true } });
        await this.moveStock(tx, h.stockBranchId, h.stockVariantId, -num(moved._sum.quantityDelta), h.id);
      }
      const after = await tx.farmHarvest.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.harvest_voided', entityType: 'FarmHarvest', entityId: id, before: h, after });
      return after;
    });
  }
}
