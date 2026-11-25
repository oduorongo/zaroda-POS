import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTxnType, Prisma, QuantityMode } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { averageCost } from '../common/inventory/average-cost.util';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { FarmContext } from './farm-access';
import { FarmLivestockService } from './farm-livestock.service';
import { POULTRY, addDays, asDate, dayOf, todayKey } from './farm-livestock.util';
import { LOW_FEED_DAYS, batchCost, batchNo, daysLeft, feedCostPer, scaleRation } from './farm-feed.util';
import { FeedBatchDto, FeedingDto, RationDto } from './dto/feed.dto';
import { VoidDto } from './dto/livestock.dto';

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? 0 : Number(d));
const MILKED = ['CATTLE', 'GOAT', 'SHEEP'];
const perKg = (baseUnit: string) => baseUnit.trim().toLowerCase() === 'kg';

/** Zaroda Shamba F5: rations, mixing batches (approved by a farm manager), feeding from stock, feed cost and low feed. */
@Injectable()
export class FarmFeedService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly audit: AuditLogService,
  ) {}

  private async stockBranch(tx: TenantTx): Promise<string> {
    const s = await tx.farmProduceSettings.findFirst({ select: { branchId: true } });
    const id = s?.branchId ?? (await tx.branch.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } }))?.id;
    if (!id) throw new BadRequestException('The farm has no branch to keep stock in');
    return id;
  }

  private async move(tx: TenantTx, branchId: string, variantId: string, qty: number, referenceId: string) {
    if (qty === 0) return;
    await this.inventory.recordInTx(tx, { branchId, variantId, type: InventoryTxnType.PRODUCTION, quantityDelta: Math.round(qty * 1000) / 1000, referenceId });
  }

  private async variants(tx: TenantTx, ids: string[]) {
    const list = ids.length ? await tx.productVariant.findMany({ where: { id: { in: [...new Set(ids)] } }, include: { product: { select: { name: true, baseUnit: true } } } }) : [];
    const name = (id: string) => {
      const v = list.find((x) => x.id === id);
      return v ? `${v.product.name}${v.name ? ` - ${v.name}` : ''}` : '';
    };
    return { list, name, get: (id: string) => list.find((x) => x.id === id) };
  }

  // ── Rations ─────────────────────────────────────────────────────────────

  listRations() {
    return this.tenantPrisma.run(async (tx) => {
      const rations = await tx.farmRation.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
      const items = rations.length ? await tx.farmRationItem.findMany({ where: { rationId: { in: rations.map((r) => r.id) } } }) : [];
      const v = await this.variants(tx, [...items.map((i) => i.variantId), ...rations.map((r) => r.outputVariantId)]);
      return rations.map((r) => {
        const mine = items.filter((i) => i.rationId === r.id);
        const cost = batchCost(mine.map((i) => ({ quantity: num(i.quantity), unitCost: v.get(i.variantId)?.cost === null || !v.get(i.variantId) ? null : num(v.get(i.variantId)!.cost) })), num(r.batchKg));
        return {
          ...r,
          batchKg: num(r.batchKg),
          outputName: v.name(r.outputVariantId),
          items: mine.map((i) => ({ variantId: i.variantId, quantity: num(i.quantity), name: v.name(i.variantId), unit: v.get(i.variantId)?.product.baseUnit ?? '' })),
          expectedCostPerKg: cost.costPerKg,
          missingCost: cost.missingCost,
        };
      });
    });
  }

  /** A ration. Its finished feed must be stocked per kg; without one, a per-kg product named after the ration is made. */
  saveRation(dto: RationDto, id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId } = getTenantStore();
      const before = id ? await tx.farmRation.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Ration not found');
      const ids = dto.items.map((i) => i.variantId);
      if (new Set(ids).size !== ids.length) throw new BadRequestException('An ingredient is listed twice');
      const v = await this.variants(tx, [...ids, ...(dto.outputVariantId ? [dto.outputVariantId] : [])]);
      if (ids.some((x) => !v.get(x))) throw new BadRequestException('An ingredient was not found in stock items');

      let outputVariantId = dto.outputVariantId ?? before?.outputVariantId ?? null;
      if (dto.outputVariantId) {
        const out = v.get(dto.outputVariantId);
        if (!out) throw new BadRequestException('The finished feed product was not found');
        if (!perKg(out.product.baseUnit)) throw new BadRequestException(`${out.product.name} is not stocked per kg. Choose a feed product sold per kg, or leave it empty to make one.`);
      }
      if (ids.includes(outputVariantId ?? '')) throw new BadRequestException('The finished feed cannot also be an ingredient');
      if (!outputVariantId) {
        const p = await tx.product.create({
          data: { organizationId, name: dto.name.trim(), baseUnit: 'kg', variants: { create: { sku: `FEED-${Date.now().toString(36).toUpperCase()}`, price: 0, quantityMode: QuantityMode.WEIGHT } } },
          include: { variants: true },
        });
        outputVariantId = p.variants[0].id;
      }
      const data = {
        name: dto.name.trim(), species: dto.species?.trim() || null, stage: dto.stage?.trim() || null, outputVariantId, batchKg: dto.batchKg,
        notes: dto.notes?.trim() || null, active: dto.active ?? before?.active ?? true,
      };
      const ration = id ? await tx.farmRation.update({ where: { id }, data }) : await tx.farmRation.create({ data: { organizationId, ...data } });
      await tx.farmRationItem.deleteMany({ where: { rationId: ration.id } });
      await tx.farmRationItem.createMany({ data: dto.items.map((i) => ({ organizationId, rationId: ration.id, variantId: i.variantId, quantity: i.quantity })) });
      await this.audit.logInTx(tx, { action: id ? 'farm.ration_updated' : 'farm.ration_created', entityType: 'FarmRation', entityId: ration.id, before: before ?? undefined, after: { ...ration, items: dto.items } });
      return ration;
    });
  }

  // ── Mixing batches ──────────────────────────────────────────────────────

  listBatches() {
    return this.tenantPrisma.run(async (tx) => {
      const batches = await tx.farmFeedBatch.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 100 });
      const [rations, items] = await Promise.all([
        tx.farmRation.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.rationId))] } }, select: { id: true, name: true } }),
        batches.length ? tx.farmFeedBatchItem.findMany({ where: { batchId: { in: batches.map((b) => b.id) } } }) : [],
      ]);
      const v = await this.variants(tx, items.map((i) => i.variantId));
      return batches.map((b) => ({
        ...b,
        kgProduced: num(b.kgProduced),
        cost: num(b.cost),
        costPerKg: num(b.costPerKg),
        rationName: rations.find((r) => r.id === b.rationId)?.name ?? '',
        items: items.filter((i) => i.batchId === b.id).map((i) => ({ name: v.name(i.variantId), unit: v.get(i.variantId)?.product.baseUnit ?? '', quantity: num(i.quantity), cost: num(i.cost) })),
      }));
    });
  }

  /** The feed miller records a mixing. Nothing moves in stock until a farm manager approves it. */
  recordBatch(dto: FeedBatchDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      const ration = await tx.farmRation.findUnique({ where: { id: dto.rationId } });
      if (!ration || !ration.active) throw new BadRequestException('That ration was not found');
      const recipe = await tx.farmRationItem.findMany({ where: { rationId: ration.id } });
      const used = new Map(scaleRation(recipe.map((i) => ({ variantId: i.variantId, quantity: num(i.quantity) })), dto.batches ?? 1).map((i) => [i.variantId, i.quantity]));
      for (const i of dto.items ?? []) used.set(i.variantId, i.quantity);
      const v = await this.variants(tx, [...used.keys()]);
      if ([...used.keys()].some((x) => !v.get(x))) throw new BadRequestException('An ingredient was not found in stock items');
      const lines = [...used.entries()].filter(([, q]) => q > 0).map(([variantId, quantity]) => ({ variantId, quantity, unitCost: v.get(variantId)!.cost === null ? null : num(v.get(variantId)!.cost) }));
      const costed = batchCost(lines, dto.kgProduced);
      const nth = (await tx.farmFeedBatch.count({ where: { date: asDate(dto.date) } })) + 1;
      const batch = await tx.farmFeedBatch.create({
        data: {
          organizationId, batchNo: batchNo(dto.date, nth), rationId: ration.id, date: asDate(dto.date), kgProduced: dto.kgProduced, cost: costed.cost, costPerKg: costed.costPerKg,
          outputVariantId: ration.outputVariantId, mixedBy: orgUserId, notes: dto.notes?.trim() || null,
        },
      });
      await tx.farmFeedBatchItem.createMany({ data: costed.lines.map((l) => ({ organizationId, batchId: batch.id, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost ?? 0, cost: l.cost })) });
      await this.audit.logInTx(tx, { action: 'farm.feed_batch_recorded', entityType: 'FarmFeedBatch', entityId: batch.id, after: { ...batch, items: costed.lines } });
      return { ...batch, kgProduced: num(batch.kgProduced), cost: costed.cost, costPerKg: costed.costPerKg, missingCost: costed.missingCost };
    });
  }

  /** Approval: ingredients leave stock and the feed comes in at its actual cost per kg (averaged into the product's cost). */
  approveBatch(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const { orgUserId } = getTenantStore();
      const b = await tx.farmFeedBatch.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Batch not found');
      if (b.status !== 'PENDING') throw new BadRequestException(`Batch ${b.batchNo} is already ${b.status.toLowerCase()}`);
      const items = await tx.farmFeedBatchItem.findMany({ where: { batchId: id } });
      const v = await this.variants(tx, [...items.map((i) => i.variantId), b.outputVariantId]);
      const costed = batchCost(items.map((i) => ({ quantity: num(i.quantity), unitCost: v.get(i.variantId)?.cost === null || !v.get(i.variantId) ? null : num(v.get(i.variantId)!.cost) })), num(b.kgProduced));
      for (const [k, i] of items.entries()) await tx.farmFeedBatchItem.update({ where: { id: i.id }, data: { unitCost: costed.lines[k].unitCost ?? 0, cost: costed.lines[k].cost } });

      const branchId = await this.stockBranch(tx);
      for (const i of items) await this.move(tx, branchId, i.variantId, -num(i.quantity), b.id);
      const out = v.get(b.outputVariantId)!;
      const held = await tx.inventoryItem.aggregate({ where: { variantId: out.id }, _sum: { quantity: true } });
      const cost = averageCost({ onHand: num(held._sum.quantity), oldCost: out.cost === null ? null : num(out.cost), receivedQty: num(b.kgProduced), unitCost: costed.costPerKg });
      await tx.productVariant.update({ where: { id: out.id }, data: { cost } });
      await this.move(tx, branchId, out.id, num(b.kgProduced), b.id);

      const after = await tx.farmFeedBatch.update({
        where: { id },
        data: { status: 'APPROVED', approvedBy: orgUserId, approvedAt: new Date(), cost: costed.cost, costPerKg: costed.costPerKg, stockBranchId: branchId },
      });
      await this.audit.logInTx(tx, { action: 'farm.feed_batch_approved', entityType: 'FarmFeedBatch', entityId: id, before: b, after });
      return { ...after, kgProduced: num(after.kgProduced), cost: costed.cost, costPerKg: costed.costPerKg };
    });
  }

  /** An approved batch is fixed; reversing puts the ingredients back and takes the feed out. A pending one is just turned down. */
  reverseBatch(id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { orgUserId } = getTenantStore();
      const b = await tx.farmFeedBatch.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('Batch not found');
      if (b.status === 'REVERSED') throw new BadRequestException('Already reversed');
      if (b.status === 'APPROVED') {
        const items = await tx.farmFeedBatchItem.findMany({ where: { batchId: id } });
        const branchId = b.stockBranchId ?? (await this.stockBranch(tx));
        for (const i of items) await this.move(tx, branchId, i.variantId, num(i.quantity), b.id);
        await this.move(tx, branchId, b.outputVariantId, -num(b.kgProduced), b.id);
      }
      const after = await tx.farmFeedBatch.update({ where: { id }, data: { status: 'REVERSED', reversedBy: orgUserId, reversedAt: new Date(), reverseReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: b.status === 'APPROVED' ? 'farm.feed_batch_reversed' : 'farm.feed_batch_rejected', entityType: 'FarmFeedBatch', entityId: id, before: b, after });
      return after;
    });
  }

  // ── Feeding ─────────────────────────────────────────────────────────────

  listFeedings(farm: FarmContext, from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const seen = farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: { ...seen, status: 'ACTIVE' }, orderBy: { tag: 'asc' }, select: { id: true, tag: true, name: true, species: true } }),
        tx.farmGroup.findMany({ where: { ...seen, active: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, species: true, headCount: true } }),
      ]);
      const ids = { animalIds: animals.map((a) => a.id), groupIds: groups.map((g) => g.id) };
      const rows = await tx.farmFeeding.findMany({
        where: { date: { gte: asDate(from), lte: asDate(to) }, OR: [{ animalId: { in: ids.animalIds } }, { groupId: { in: ids.groupIds } }] },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 500,
      });
      const v = await this.variants(tx, rows.map((r) => r.variantId));
      const feeds = await tx.productVariant.findMany({ where: { product: { baseUnit: { equals: 'kg', mode: 'insensitive' }, isActive: true } }, include: { product: { select: { name: true } } } });
      return {
        animals,
        groups,
        feeds: feeds.map((f) => ({ id: f.id, name: `${f.product.name}${f.name ? ` - ${f.name}` : ''}`, cost: f.cost === null ? null : num(f.cost) })),
        records: rows.map((r) => ({
          ...r,
          kg: num(r.kg),
          cost: num(r.cost),
          feedName: v.name(r.variantId),
          target: r.animalId ? animals.find((a) => a.id === r.animalId)?.tag ?? '' : groups.find((g) => g.id === r.groupId)?.name ?? '',
        })),
      };
    });
  }

  /** A day's feeding: each line comes off stock at the feed's cost. Feed must be stocked per kg. */
  recordFeeding(farm: FarmContext, dto: FeedingDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { organizationId, orgUserId } = getTenantStore();
      if (dto.date > todayKey()) throw new BadRequestException('The date cannot be in the future');
      for (const e of dto.entries) if (!!e.animalId === !!e.groupId) throw new BadRequestException('Each line is either one animal or one group');
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: { id: { in: dto.entries.map((e) => e.animalId).filter((x): x is string => !!x) } } }),
        tx.farmGroup.findMany({ where: { id: { in: dto.entries.map((e) => e.groupId).filter((x): x is string => !!x) } } }),
      ]);
      for (const e of dto.entries) {
        const t = e.animalId ? animals.find((a) => a.id === e.animalId) : groups.find((g) => g.id === e.groupId);
        if (!t) throw new BadRequestException('An animal or group was not found');
        if (!FarmLivestockService.sees(farm, t.unitId)) throw new ForbiddenException('That is outside the parts of the farm you work in.');
      }
      const v = await this.variants(tx, dto.entries.map((e) => e.variantId));
      for (const e of dto.entries) {
        const f = v.get(e.variantId);
        if (!f) throw new BadRequestException('That feed was not found in stock items');
        if (!perKg(f.product.baseUnit)) throw new BadRequestException(`${f.product.name} is not stocked per kg. Feed is recorded in kg, so keep feed products per kg.`);
      }
      const branchId = await this.stockBranch(tx);
      let kg = 0;
      let cost = 0;
      for (const e of dto.entries) {
        const f = v.get(e.variantId)!;
        const c = Math.round(e.kg * num(f.cost) * 100) / 100;
        const row = await tx.farmFeeding.create({
          data: { organizationId, animalId: e.animalId ?? null, groupId: e.groupId ?? null, date: asDate(dto.date), variantId: e.variantId, kg: e.kg, cost: c, stockBranchId: branchId, createdBy: orgUserId },
        });
        await this.move(tx, branchId, e.variantId, -e.kg, row.id);
        kg += e.kg;
        cost += c;
      }
      await this.audit.logInTx(tx, { action: 'farm.feeding_recorded', entityType: 'FarmFeeding', entityId: dto.date, after: { date: dto.date, lines: dto.entries.length, kg, cost } });
      return { saved: dto.entries.length, kg: Math.round(kg * 1000) / 1000, cost: Math.round(cost * 100) / 100 };
    });
  }

  voidFeeding(farm: FarmContext, id: string, dto: VoidDto) {
    return this.tenantPrisma.run(async (tx) => {
      const r = await tx.farmFeeding.findUnique({ where: { id } });
      if (!r) throw new NotFoundException('Feeding record not found');
      if (r.voidedAt) throw new BadRequestException('Already voided');
      const t = r.animalId ? await tx.farmAnimal.findUnique({ where: { id: r.animalId } }) : await tx.farmGroup.findUnique({ where: { id: r.groupId! } });
      if (!FarmLivestockService.sees(farm, t?.unitId ?? null)) throw new ForbiddenException('That is outside the parts of the farm you work in.');
      if (r.stockBranchId) await this.move(tx, r.stockBranchId, r.variantId, num(r.kg), r.id);
      const after = await tx.farmFeeding.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.audit.logInTx(tx, { action: 'farm.feeding_voided', entityType: 'FarmFeeding', entityId: id, before: r, after });
      return after;
    });
  }

  // ── Figures ─────────────────────────────────────────────────────────────

  /** Feed cost per head per day, per litre of milk and per egg over the last `days`; and each feed's days left in stock. */
  report(farm: FarmContext, days = 30) {
    return this.tenantPrisma.run(async (tx) => {
      const today = todayKey();
      const from = addDays(today, -(days - 1));
      const seen = farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
      const [animals, groups] = await Promise.all([
        tx.farmAnimal.findMany({ where: seen, select: { id: true, tag: true, name: true, species: true } }),
        tx.farmGroup.findMany({ where: seen, select: { id: true, name: true, species: true, headCount: true } }),
      ]);
      const animalIds = animals.map((a) => a.id);
      const groupIds = groups.map((g) => g.id);
      const scope = { OR: [{ animalId: { in: animalIds } }, { groupId: { in: groupIds } }] };
      const [feedings, milk, eggs] = await Promise.all([
        tx.farmFeeding.findMany({ where: { voidedAt: null, date: { gte: asDate(from) }, ...scope } }),
        tx.farmMilkRecord.findMany({ where: { voidedAt: null, date: { gte: asDate(from) }, ...scope } }),
        tx.farmEggRecord.findMany({ where: { voidedAt: null, date: { gte: asDate(from) }, groupId: { in: groupIds } } }),
      ]);

      const targets = new Map<string, { id: string; kind: 'animal' | 'group'; label: string; species: string; head: number; kg: number; cost: number; days: Set<string> }>();
      for (const f of feedings) {
        const key = f.animalId ?? f.groupId!;
        if (!targets.has(key)) {
          const a = animals.find((x) => x.id === f.animalId);
          const g = groups.find((x) => x.id === f.groupId);
          targets.set(key, { id: key, kind: a ? 'animal' : 'group', label: a ? `${a.tag}${a.name ? ` ${a.name}` : ''}` : g?.name ?? '', species: (a ?? g)?.species ?? '', head: a ? 1 : g?.headCount ?? 0, kg: 0, cost: 0, days: new Set() });
        }
        const t = targets.get(key)!;
        t.kg += num(f.kg);
        t.cost += num(f.cost);
        t.days.add(dayOf(f.date));
      }
      const fed = [...targets.values()].map(({ days: d, ...t }) => ({
        ...t,
        kg: Math.round(t.kg * 1000) / 1000,
        cost: Math.round(t.cost * 100) / 100,
        daysFed: d.size,
        costPerHeadPerDay: t.head > 0 && d.size > 0 ? Math.round((t.cost / t.head / d.size) * 100) / 100 : null,
      }));

      const speciesOf = (f: { animalId: string | null; groupId: string | null }) => animals.find((a) => a.id === f.animalId)?.species ?? groups.find((g) => g.id === f.groupId)?.species ?? '';
      const dairyCost = feedings.filter((f) => MILKED.includes(speciesOf(f))).reduce((s, f) => s + num(f.cost), 0);
      const poultryCost = feedings.filter((f) => (POULTRY as string[]).includes(speciesOf(f))).reduce((s, f) => s + num(f.cost), 0);
      const litres = milk.reduce((s, r) => s + num(r.litres), 0);
      const eggCount = eggs.reduce((s, r) => s + r.goodEggs + r.cracked + r.small, 0);

      const window = 14;
      const since = addDays(today, -(window - 1));
      const rations = await tx.farmRation.findMany({ where: { active: true }, select: { outputVariantId: true } });
      const variantIds = [...new Set([...feedings.map((f) => f.variantId), ...rations.map((r) => r.outputVariantId)])];
      const v = await this.variants(tx, variantIds);
      const branchId = await this.stockBranch(tx);
      const held = variantIds.length ? await tx.inventoryItem.findMany({ where: { branchId, variantId: { in: variantIds } } }) : [];
      const feeds = variantIds
        .map((id) => {
          const onHand = num(held.find((h) => h.variantId === id)?.quantity);
          const used = feedings.filter((f) => f.variantId === id && dayOf(f.date) >= since).reduce((s, f) => s + num(f.kg), 0);
          const left = daysLeft(onHand, used, window);
          return { variantId: id, name: v.name(id), onHand: Math.round(onHand * 1000) / 1000, kgPerDay: Math.round((used / window) * 100) / 100, daysLeft: left, low: left !== null && left < LOW_FEED_DAYS };
        })
        .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

      return {
        days,
        from,
        totalCost: Math.round(feedings.reduce((s, f) => s + num(f.cost), 0) * 100) / 100,
        totalKg: Math.round(feedings.reduce((s, f) => s + num(f.kg), 0) * 1000) / 1000,
        milk: { feedCost: Math.round(dairyCost * 100) / 100, litres: Math.round(litres * 1000) / 1000, perLitre: feedCostPer(dairyCost, litres) },
        eggs: { feedCost: Math.round(poultryCost * 100) / 100, eggs: eggCount, perEgg: feedCostPer(poultryCost, eggCount), perTray: feedCostPer(poultryCost * 30, eggCount) },
        fed: fed.sort((a, b) => b.cost - a.cost),
        feeds,
        lowFeeds: feeds.filter((f) => f.low),
      };
    });
  }
}
