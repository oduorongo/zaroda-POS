import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FarmMilkUse, InventoryTxnType, QuantityMode } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { FarmContext } from './farm-access';
import { FarmLivestockService } from './farm-livestock.service';
import { addDays, asDate, dayOf, todayKey, withdrawalState } from './farm-livestock.util';
import { YieldBy, bucketsUpTo, eggsToStock, layPct, milkToStock, round3, yields } from './farm-production.util';
import { EggRecordDto, MilkSessionDto, ProduceRecordDto, ProduceSettingsDto } from './dto/production.dto';
import { VoidDto as VoidReason } from './dto/livestock.dto';

const MILKED = ['CATTLE', 'GOAT', 'SHEEP'] as const;
const LAYERS = ['CHICKEN', 'DUCK', 'TURKEY'] as const;

/** Zaroda Shamba F3: milk per milking, eggs per flock per day, other produce; sellable produce becomes POS stock. */
@Injectable()
export class FarmProductionService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly audit: AuditLogService,
  ) {}

  private mustSee(farm: FarmContext, unitId: string | null) {
    if (!FarmLivestockService.sees(farm, unitId)) throw new ForbiddenException('That is outside the parts of the farm you work in.');
  }

  private noFuture(day: string) {
    if (day > todayKey()) throw new BadRequestException('The date cannot be in the future');
  }

  // ── Settings: which POS products milk and eggs go into ──────────────────

  private async settingsIn(tx: TenantTx) {
    const s = await tx.farmProduceSettings.findFirst();
    return s ?? { milkVariantId: null, eggVariantId: null, eggsPerUnit: 30, branchId: null };
  }

  /** The branch that receives produce: the one chosen, else the farm's first. */
  private async stockBranch(tx: TenantTx, chosen: string | null): Promise<string | null> {
    if (chosen) return chosen;
    const b = await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
    return b?.id ?? null;
  }

  getSettings() {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.settingsIn(tx);
      const ids = [s.milkVariantId, s.eggVariantId].filter((x): x is string => !!x);
      const variants = ids.length ? await tx.productVariant.findMany({ where: { id: { in: ids } }, include: { product: { select: { name: true, baseUnit: true } } } }) : [];
      const label = (id: string | null) => {
        const v = variants.find((x) => x.id === id);
        return v ? { id: v.id, name: v.name ? `${v.product.name} - ${v.name}` : v.product.name, unit: v.product.baseUnit, price: Number(v.price), quantityMode: v.quantityMode } : null;
      };
      const branches = await tx.branch.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, name: true } });
      return { milk: label(s.milkVariantId), eggs: label(s.eggVariantId), eggsPerUnit: s.eggsPerUnit, branchId: s.branchId ?? branches[0]?.id ?? null, branches };
    });
  }

  updateSettings(dto: ProduceSettingsDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const before = await tx.farmProduceSettings.findFirst();
      const eggsPerUnit = dto.eggsPerUnit ?? before?.eggsPerUnit ?? 30;
      for (const id of [dto.milkVariantId, dto.eggVariantId].filter((x): x is string => !!x)) {
        if (!(await tx.productVariant.findUnique({ where: { id } }))) throw new BadRequestException('That product was not found');
      }
      const eggVariantId = dto.eggVariantId === undefined ? before?.eggVariantId ?? null : dto.eggVariantId;
      if (eggVariantId && eggsPerUnit > 1) {
        const v = await tx.productVariant.findUnique({ where: { id: eggVariantId } });
        if (v?.quantityMode === QuantityMode.COUNT) {
          throw new BadRequestException(`That egg product is sold by whole count, so part trays cannot go into stock. Choose a product sold by quantity, or set eggs per unit to 1.`);
        }
      }
      if (dto.branchId && !(await tx.branch.findUnique({ where: { id: dto.branchId } }))) throw new BadRequestException('Branch not found');
      const data = {
        milkVariantId: dto.milkVariantId === undefined ? before?.milkVariantId ?? null : dto.milkVariantId,
        eggVariantId,
        eggsPerUnit,
        branchId: dto.branchId === undefined ? before?.branchId ?? null : dto.branchId,
      };
      const after = await tx.farmProduceSettings.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
      await this.audit.logInTx(tx, { action: 'farm.produce_settings_updated', entityType: 'FarmProduceSettings', entityId: after.id, before: before ?? undefined, after });
      return after;
    });
  }

  /** Makes "Fresh milk" (per litre) and "Eggs" (per tray) POS products and links them, for farms that have none yet. */
  createProducts(dto: { milkPrice?: number; trayPrice?: number }) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const s = await this.settingsIn(tx);
      const made: string[] = [];
      const make = async (name: string, unit: string, sku: string, price: number) => {
        const p = await tx.product.create({
          data: { organizationId, name, baseUnit: unit, variants: { create: { sku, price, quantityMode: QuantityMode.WEIGHT } } },
          include: { variants: true },
        });
        made.push(name);
        return p.variants[0].id;
      };
      const milkVariantId = s.milkVariantId ?? (await make('Fresh milk', 'litre', 'FARM-MILK', dto.milkPrice ?? 60));
      const eggVariantId = s.eggVariantId ?? (await make('Eggs (tray of 30)', 'tray', 'FARM-EGGS', dto.trayPrice ?? 450));
      const eggsPerUnit = s.eggVariantId ? s.eggsPerUnit : 30;
      const after = await tx.farmProduceSettings.upsert({
        where: { organizationId },
        create: { organizationId, milkVariantId, eggVariantId, eggsPerUnit },
        update: { milkVariantId, eggVariantId, eggsPerUnit },
      });
      await this.audit.logInTx(tx, { action: 'farm.produce_products_created', entityType: 'FarmProduceSettings', entityId: after.id, after: { made } });
      return { made, settings: after };
    });
  }

  private async putInStock(tx: TenantTx, variantId: string | null, branchId: string | null, qty: number, referenceId: string) {
    if (!variantId || !branchId || qty === 0) return false;
    await this.inventory.recordInTx(tx, { branchId, variantId, type: InventoryTxnType.PRODUCTION, quantityDelta: round3(qty), referenceId });
    return true;
  }

  // ── Withdrawal ──────────────────────────────────────────────────────────

  /** Whether milk/eggs from these animals or groups were under a treatment withdrawal on `day`, by id. */
  private async withheldOn(tx: TenantTx, day: string, ids: { animalIds: string[]; groupIds: string[] }, kind: 'milk' | 'egg') {
    const until = kind === 'milk' ? 'milkWithdrawalUntil' : 'eggWithdrawalUntil';
    const events = await tx.farmHealthEvent.findMany({
      where: {
        voidedAt: null,
        date: { lte: asDate(day) },
        [until]: { gt: asDate(day) },
        OR: [{ animalId: { in: ids.animalIds } }, { groupId: { in: ids.groupIds } }],
      },
    });
    const untilFor = (pick: (e: (typeof events)[number]) => boolean) => {
      const w = withdrawalState(events.filter(pick), day);
      return kind === 'milk' ? w.milkUntil : w.eggUntil;
    };
    return { untilFor, events };
  }

  // ── Milk ────────────────────────────────────────────────────────────────

  /** The milking sheet for a day: every cow/goat in milk (and milking groups), what is already recorded, and who is withheld. */
  milkSheet(farm: FarmContext, day: string) {
    return this.tenantPrisma.run(async (tx) => {
      const seen = farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
      const [animals, groups, records] = await Promise.all([
        tx.farmAnimal.findMany({ where: { ...seen, status: 'ACTIVE', sex: 'FEMALE', species: { in: [...MILKED] } }, orderBy: { tag: 'asc' }, select: { id: true, tag: true, name: true, species: true, groupId: true, unitId: true } }),
        tx.farmGroup.findMany({ where: { ...seen, active: true, species: { in: [...MILKED] } }, orderBy: { name: 'asc' }, select: { id: true, name: true, species: true, headCount: true } }),
        tx.farmMilkRecord.findMany({ where: { date: asDate(day), voidedAt: null }, orderBy: { createdAt: 'asc' } }),
      ]);
      const dried = await tx.farmBreedingEvent.findMany({ where: { animalId: { in: animals.map((a) => a.id) }, voidedAt: null, kind: { in: ['DRIED_OFF', 'BIRTH'] } }, orderBy: { date: 'desc' } });
      const lastBy = new Map<string, string>();
      for (const e of dried) if (!lastBy.has(e.animalId)) lastBy.set(e.animalId, e.kind);
      const { untilFor } = await this.withheldOn(tx, day, { animalIds: animals.map((a) => a.id), groupIds: [...groups.map((g) => g.id), ...animals.map((a) => a.groupId).filter((x): x is string => !!x)] }, 'milk');
      const visibleIds = new Set([...animals.map((a) => a.id), ...groups.map((g) => g.id)]);
      return {
        date: day,
        animals: animals.map((a) => ({
          ...a,
          dry: lastBy.get(a.id) === 'DRIED_OFF',
          withheldUntil: untilFor((e) => e.animalId === a.id || (!!a.groupId && e.groupId === a.groupId)),
        })),
        groups: groups.map((g) => ({ ...g, withheldUntil: untilFor((e) => e.groupId === g.id) })),
        records: records.filter((r) => visibleIds.has(r.animalId ?? r.groupId ?? '')).map((r) => ({ ...r, litres: Number(r.litres), toStock: Number(r.toStock) })),
      };
    });
  }

  /** Saves one milking. Milk from a cow under withdrawal is withheld whatever was chosen, and cannot be for sale. */
  recordMilk(farm: FarmContext, dto: MilkSessionDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      this.noFuture(dto.date);
      const entries = dto.entries.filter((e) => e.litres > 0);
      if (!entries.length) throw new BadRequestException('Enter the litres for at least one cow');
      for (const e of entries) if (!!e.animalId === !!e.groupId) throw new BadRequestException('Each line is either one animal or one group');

      const animalIds = entries.map((e) => e.animalId).filter((x): x is string => !!x);
      const groupIds = entries.map((e) => e.groupId).filter((x): x is string => !!x);
      if (new Set(animalIds).size !== animalIds.length || new Set(groupIds).size !== groupIds.length) throw new BadRequestException('The same animal is listed twice');
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: { id: { in: animalIds } } }),
        tx.farmGroup.findMany({ where: { id: { in: groupIds } } }),
      ]);
      if (animals.length !== animalIds.length || groups.length !== groupIds.length) throw new BadRequestException('An animal or group was not found');
      for (const a of animals) {
        this.mustSee(farm, a.unitId);
        if (a.status !== 'ACTIVE' || a.sex !== 'FEMALE' || !(MILKED as readonly string[]).includes(a.species)) throw new BadRequestException(`${a.tag} is not a milking animal`);
      }
      for (const g of groups) this.mustSee(farm, g.unitId);

      const taken = await tx.farmMilkRecord.findMany({
        where: { date: asDate(dto.date), session: dto.session, voidedAt: null, OR: [{ animalId: { in: animalIds } }, { groupId: { in: groupIds } }] },
      });
      if (taken.length) {
        const names = taken.map((t) => animals.find((a) => a.id === t.animalId)?.tag ?? groups.find((g) => g.id === t.groupId)?.name).join(', ');
        throw new ConflictException(`The ${dto.session} milking is already recorded for ${names}. Void that record first to correct it.`);
      }

      const { untilFor } = await this.withheldOn(tx, dto.date, { animalIds, groupIds: [...groupIds, ...animals.map((a) => a.groupId).filter((x): x is string => !!x)] }, 'milk');
      const settings = await this.settingsIn(tx);
      const branchId = await this.stockBranch(tx, settings.branchId);
      const saved = [];
      const withheld: string[] = [];
      let stocked = 0;
      for (const e of entries) {
        const animal = animals.find((a) => a.id === e.animalId);
        const until = e.animalId ? untilFor((ev) => ev.animalId === e.animalId || (!!animal?.groupId && ev.groupId === animal.groupId)) : untilFor((ev) => ev.groupId === e.groupId);
        const isWithheld = !!until;
        const use: FarmMilkUse = isWithheld && e.use === 'SOLD' ? 'DISCARDED' : e.use;
        if (isWithheld) withheld.push(`${animal?.tag ?? groups.find((g) => g.id === e.groupId)?.name} (until after ${until})`);
        const qty = milkToStock(e.litres, use, isWithheld);
        const rec = await tx.farmMilkRecord.create({
          data: {
            organizationId, animalId: e.animalId ?? null, groupId: e.groupId ?? null, date: asDate(dto.date), session: dto.session, litres: e.litres,
            withheld: isWithheld, use, toStock: 0, createdBy: orgUserId,
          },
        });
        if (qty > 0 && (await this.putInStock(tx, settings.milkVariantId, branchId, qty, rec.id))) {
          await tx.farmMilkRecord.update({ where: { id: rec.id }, data: { toStock: qty, stockVariantId: settings.milkVariantId, stockBranchId: branchId } });
          stocked += qty;
        }
        saved.push(rec.id);
      }
      const total = round3(entries.reduce((s, e) => s + e.litres, 0));
      await this.audit.logInTx(tx, { action: 'farm.milk_recorded', entityType: 'FarmMilkRecord', entityId: saved[0], after: { date: dto.date, session: dto.session, lines: saved.length, litres: total, toStock: round3(stocked), withheld } });
      return {
        saved: saved.length,
        litres: total,
        toStock: round3(stocked),
        withheld,
        stockNote: !settings.milkVariantId && entries.some((e) => e.use === 'SOLD') ? 'Milk for sale was recorded but not put in stock: choose the milk product under Production > Settings.' : null,
      };
    });
  }

  voidMilk(farm: FarmContext, id: string, dto: VoidReason) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmMilkRecord.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Milk record not found');
      if (r.voidedAt) throw new BadRequestException('Already voided');
      const owner = r.animalId ? await tx.farmAnimal.findUnique({ where: { id: r.animalId } }) : await tx.farmGroup.findUnique({ where: { id: r.groupId! } });
      this.mustSee(farm, owner?.unitId ?? null);
      if (Number(r.toStock) > 0) await this.putInStock(tx, r.stockVariantId, r.stockBranchId, -Number(r.toStock), r.id);
      const after = await tx.farmMilkRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.milk_voided', entityType: 'FarmMilkRecord', entityId: id, before: r, after });
      return after;
    });
  }

  // ── Eggs ────────────────────────────────────────────────────────────────

  listEggs(farm: FarmContext, from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const groups = await tx.farmGroup.findMany({
        where: { ...(farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } }), species: { in: [...LAYERS] } },
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        select: { id: true, name: true, species: true, headCount: true, active: true, purpose: true },
      });
      const records = await tx.farmEggRecord.findMany({
        where: { groupId: { in: groups.map((g) => g.id) }, date: { gte: asDate(from), lte: asDate(to) } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      });
      const today = todayKey();
      const { untilFor } = await this.withheldOn(tx, today, { animalIds: [], groupIds: groups.map((g) => g.id) }, 'egg');
      return {
        groups: groups.map((g) => ({ ...g, withheldUntil: untilFor((e) => e.groupId === g.id) })),
        records: records.map((r) => ({
          ...r,
          feedKg: r.feedKg === null ? null : Number(r.feedKg),
          toStock: Number(r.toStock),
          layPct: layPct(r.goodEggs + r.cracked + r.small, r.birds),
          groupName: groups.find((g) => g.id === r.groupId)?.name ?? '',
        })),
      };
    });
  }

  /** One flock's day. Deaths come off the flock's count; eggs under withdrawal are withheld and kept out of stock. */
  recordEggs(farm: FarmContext, dto: EggRecordDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      this.noFuture(dto.date);
      const g = await tx.farmGroup.findUnique({ where: { id: dto.groupId } });
      if (!g) throw new NotFoundException('Flock not found');
      this.mustSee(farm, g.unitId);
      if (!(LAYERS as readonly string[]).includes(g.species)) throw new BadRequestException(`${g.name} is not a poultry flock`);
      if (!g.active) throw new BadRequestException(`${g.name} is closed`);
      if (await tx.farmEggRecord.findFirst({ where: { groupId: g.id, date: asDate(dto.date), voidedAt: null } })) {
        throw new ConflictException(`Eggs for ${g.name} on ${dto.date} are already recorded. Void that record first to correct it.`);
      }
      const deaths = dto.deaths ?? 0;
      if (deaths > g.headCount) throw new BadRequestException(`${g.name} has only ${g.headCount} birds`);

      const { untilFor } = await this.withheldOn(tx, dto.date, { animalIds: [], groupIds: [g.id] }, 'egg');
      const until = untilFor(() => true);
      const settings = await this.settingsIn(tx);
      const branchId = await this.stockBranch(tx, settings.branchId);
      const qty = eggsToStock(dto.goodEggs, settings.eggsPerUnit, !!until);

      const rec = await tx.farmEggRecord.create({
        data: {
          organizationId, groupId: g.id, date: asDate(dto.date), birds: g.headCount, goodEggs: dto.goodEggs, cracked: dto.cracked ?? 0, small: dto.small ?? 0,
          feedKg: dto.feedKg ?? null, deaths, withheld: !!until, createdBy: orgUserId,
        },
      });
      let toStock = 0;
      if (qty > 0 && (await this.putInStock(tx, settings.eggVariantId, branchId, qty, rec.id))) {
        await tx.farmEggRecord.update({ where: { id: rec.id }, data: { toStock: qty, stockVariantId: settings.eggVariantId, stockBranchId: branchId } });
        toStock = qty;
      }
      if (deaths > 0) {
        await tx.farmGroupCount.create({ data: { organizationId, groupId: g.id, date: asDate(dto.date), change: -deaths, reason: 'DIED', note: 'From the egg record', createdBy: orgUserId } });
        await tx.farmGroup.update({ where: { id: g.id }, data: { headCount: { decrement: deaths } } });
      }
      await this.audit.logInTx(tx, { action: 'farm.eggs_recorded', entityType: 'FarmEggRecord', entityId: rec.id, after: { ...rec, toStock } });
      return {
        ...rec,
        toStock,
        layPct: layPct(dto.goodEggs + (dto.cracked ?? 0) + (dto.small ?? 0), g.headCount),
        withheldUntil: until,
        stockNote: !settings.eggVariantId && dto.goodEggs > 0 && !until ? 'Eggs were recorded but not put in stock: choose the egg product under Production > Settings.' : null,
      };
    });
  }

  voidEggs(farm: FarmContext, id: string, dto: VoidReason) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      const r = await tx.farmEggRecord.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Egg record not found');
      if (r.voidedAt) throw new BadRequestException('Already voided');
      const g = await tx.farmGroup.findUnique({ where: { id: r.groupId } });
      this.mustSee(farm, g?.unitId ?? null);
      if (Number(r.toStock) > 0) await this.putInStock(tx, r.stockVariantId, r.stockBranchId, -Number(r.toStock), r.id);
      if (r.deaths > 0 && g) {
        await tx.farmGroupCount.create({ data: { organizationId, groupId: g.id, date: r.date, change: r.deaths, reason: 'ADJUSTED', note: 'Egg record voided: deaths taken back', createdBy: orgUserId } });
        await tx.farmGroup.update({ where: { id: g.id }, data: { headCount: { increment: r.deaths } } });
      }
      const after = await tx.farmEggRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.eggs_voided', entityType: 'FarmEggRecord', entityId: id, before: r, after });
      return after;
    });
  }

  // ── Other produce ───────────────────────────────────────────────────────

  listProduce(from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.farmProduceRecord.findMany({ where: { date: { gte: asDate(from), lte: asDate(to) } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500 });
      const enterprises = await tx.farmEnterprise.findMany({ select: { id: true, name: true } });
      return rows.map((r) => ({ ...r, quantity: Number(r.quantity), enterpriseName: enterprises.find((e) => e.id === r.enterpriseId)?.name ?? null }));
    });
  }

  recordProduce(dto: ProduceRecordDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      this.noFuture(dto.date);
      if (dto.enterpriseId && !(await tx.farmEnterprise.findUnique({ where: { id: dto.enterpriseId } }))) throw new BadRequestException('Enterprise not found');
      let branchId: string | null = null;
      if (dto.variantId) {
        if (!(await tx.productVariant.findUnique({ where: { id: dto.variantId } }))) throw new BadRequestException('That product was not found');
        branchId = await this.stockBranch(tx, (await this.settingsIn(tx)).branchId);
      }
      const rec = await tx.farmProduceRecord.create({
        data: {
          organizationId, enterpriseId: dto.enterpriseId ?? null, date: asDate(dto.date), product: dto.product.trim(), quantity: dto.quantity, unit: dto.unit.trim(),
          note: dto.note?.trim() || null, createdBy: orgUserId,
        },
      });
      if (await this.putInStock(tx, dto.variantId ?? null, branchId, dto.quantity, rec.id)) {
        await tx.farmProduceRecord.update({ where: { id: rec.id }, data: { stockVariantId: dto.variantId, stockBranchId: branchId } });
      }
      await this.audit.logInTx(tx, { action: 'farm.produce_recorded', entityType: 'FarmProduceRecord', entityId: rec.id, after: rec });
      return rec;
    });
  }

  voidProduce(id: string, dto: VoidReason) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmProduceRecord.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Produce record not found');
      if (r.voidedAt) throw new BadRequestException('Already voided');
      if (r.stockVariantId) await this.putInStock(tx, r.stockVariantId, r.stockBranchId, -Number(r.quantity), r.id);
      const after = await tx.farmProduceRecord.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.produce_voided', entityType: 'FarmProduceRecord', entityId: id, before: r, after });
      return after;
    });
  }

  // ── Yields ──────────────────────────────────────────────────────────────

  /** Milk and eggs per day (30 days), week (12 weeks) or month (12 months), plus each cow's milk over the last 30 days. */
  yields(farm: FarmContext, by: YieldBy) {
    return this.tenantPrisma.run(async (tx) => {
      const today = todayKey();
      const buckets = bucketsUpTo(today, by);
      const from = asDate(buckets[0]);
      const seen = farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: seen, select: { id: true, tag: true, name: true } }),
        tx.farmGroup.findMany({ where: seen, select: { id: true } }),
      ]);
      const animalIds = animals.map((a) => a.id);
      const groupIds = groups.map((g) => g.id);
      const [milk, eggs] = await Promise.all([
        tx.farmMilkRecord.findMany({ where: { voidedAt: null, date: { gte: from }, OR: [{ animalId: { in: animalIds } }, { groupId: { in: groupIds } }] } }),
        tx.farmEggRecord.findMany({ where: { voidedAt: null, date: { gte: from }, groupId: { in: groupIds } } }),
      ]);
      const series = yields(
        milk.map((r) => ({ date: dayOf(r.date), litres: Number(r.litres), use: r.use, withheld: r.withheld })),
        eggs.map((r) => ({ date: dayOf(r.date), birds: r.birds, goodEggs: r.goodEggs, cracked: r.cracked, small: r.small, feedKg: r.feedKg === null ? null : Number(r.feedKg), deaths: r.deaths })),
        buckets,
        by,
      );
      const since = addDays(today, -29);
      const perCow = new Map<string, { litres: number; days: Set<string> }>();
      for (const r of milk) {
        if (!r.animalId || dayOf(r.date) < since) continue;
        const c = perCow.get(r.animalId) ?? { litres: 0, days: new Set<string>() };
        c.litres += Number(r.litres);
        c.days.add(dayOf(r.date));
        perCow.set(r.animalId, c);
      }
      const cows = [...perCow.entries()]
        .map(([id, c]) => {
          const a = animals.find((x) => x.id === id);
          return { id, tag: a?.tag ?? '', name: a?.name ?? null, litres: round3(c.litres), days: c.days.size, perDay: round3(c.litres / c.days.size) };
        })
        .sort((a, b) => b.perDay - a.perDay);
      return { by, series, cows };
    });
  }
}
