import { Injectable } from '@nestjs/common';
import { FarmSpecies, Prisma } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { FarmContext } from './farm-access';
import { asDate, todayKey } from './farm-livestock.util';
import { DEFAULT_MARGIN, DEFAULT_RATES, DEFAULT_SELLING_COST, Valuation, ValuationRate, monthsBetween, profitOf, valuationWarnings, valueOf } from './farm-valuation.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const r2 = (x: number) => Math.round(x * 100) / 100;
const sumBy = <T>(rows: T[], key: (r: T) => string | null, val: (r: T) => number) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = key(r);
    if (k) m.set(k, (m.get(k) ?? 0) + val(r));
  }
  return m;
};

export interface ValuationSettings {
  margin: number;
  sellingCost: number;
  rates: Record<FarmSpecies, ValuationRate>;
}

export interface AnimalValuation extends Valuation {
  id: string;
  kind: 'ANIMAL' | 'GROUP';
  tag: string | null;
  name: string | null;
  species: FarmSpecies;
  sex: string | null;
  ageMonths: number | null;
  weightKg: number | null;
  heads: number;
  /** value x heads (a flock's whole value). */
  total: number;
  /** Profitability, kept apart from the value: what its milk or eggs brought in, its young, and profit so far (per head for a flock). */
  produce: 'MILK' | 'EGGS' | null;
  produceIncome: number;
  offspring: number;
  offspringValue: number;
  profit: number;
  warnings: string[];
}

/**
 * Animals and flocks as assets (IAS 41): fair value less costs to sell from the last weight at the market price, or the cost
 * model when there is no market price, less a drop past prime age. Milk, eggs and young are income, shown apart as
 * profitability. Flocks are valued per head.
 */
@Injectable()
export class FarmValuationService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  settings(): Promise<ValuationSettings> {
    return this.tenantPrisma.run((tx) => this.loadSettings(tx));
  }

  private async loadSettings(tx: TenantTx): Promise<ValuationSettings> {
    const [s, rows] = await Promise.all([tx.farmSettings.findFirst({ select: { valuationMarginRate: true, valuationSellingCostRate: true } }), tx.farmValuationRate.findMany()]);
    const rates = { ...DEFAULT_RATES };
    for (const r of rows) rates[r.species] = { birthValue: n(r.birthValueKes), pricePerKg: n(r.pricePerKgKes), primeAgeMonths: r.primeAgeMonths, ageDropRate: n(r.ageDropRate) };
    return { margin: s ? n(s.valuationMarginRate) : DEFAULT_MARGIN, sellingCost: s ? n(s.valuationSellingCostRate) : DEFAULT_SELLING_COST, rates };
  }

  updateSettings(dto: { margin?: number; sellingCost?: number; rates?: ({ species: FarmSpecies } & ValuationRate)[] }) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.loadSettings(tx);
      if (dto.margin !== undefined || dto.sellingCost !== undefined) {
        await tx.farmSettings.updateMany({ data: { valuationMarginRate: dto.margin, valuationSellingCostRate: dto.sellingCost } });
      }
      const { organizationId } = getTenantStore();
      for (const r of dto.rates ?? []) {
        const data = { birthValueKes: r.birthValue, pricePerKgKes: r.pricePerKg, primeAgeMonths: r.primeAgeMonths, ageDropRate: r.ageDropRate };
        await tx.farmValuationRate.upsert({ where: { organizationId_species: { organizationId, species: r.species } }, create: { organizationId, species: r.species, ...data }, update: data });
      }
      const after = await this.loadSettings(tx);
      await this.audit.logInTx(tx, { action: 'farm.valuation_settings_updated', entityType: 'FarmSettings', entityId: 'valuation', before, after });
      return after;
    });
  }

  /** Every active animal and flock the person may see, with its value. */
  list(farm: FarmContext): Promise<{ settings: ValuationSettings; asOf: string; items: AnimalValuation[] }> {
    return this.tenantPrisma.run(async (tx) => {
      const settings = await this.loadSettings(tx);
      return { settings, asOf: todayKey(), items: await this.itemsInTx(tx, settings, farm.unitIds) };
    });
  }

  /** The farm's livestock in the books: every active animal and flock at its value (for the general ledger). */
  async totalInTx(tx: TenantTx): Promise<number> {
    if (!(await tx.farmSettings.findFirst({ select: { id: true } }))) return 0;
    const items = await this.itemsInTx(tx, await this.loadSettings(tx), null);
    return r2(items.reduce((s, v) => s + v.total, 0));
  }

  private async itemsInTx(tx: TenantTx, settings: ValuationSettings, unitIds: string[] | null): Promise<AnimalValuation[]> {
    const seen = unitIds === null ? {} : { unitId: { in: unitIds } };
    const [animals, groups] = await Promise.all([
      tx.farmAnimal.findMany({ where: { ...seen, status: 'ACTIVE' }, orderBy: [{ species: 'asc' }, { tag: 'asc' }] }),
      tx.farmGroup.findMany({ where: { ...seen, active: true }, orderBy: { name: 'asc' } }),
    ]);
    const today = todayKey();
    const animalIds = animals.map((a) => a.id);
    const groupIds = [...new Set([...groups.map((g) => g.id), ...animals.map((a) => a.groupId).filter((x): x is string => !!x)])];
    const both = { OR: [{ animalId: { in: animalIds } }, { groupId: { in: groupIds } }] };
    const [feedings, health, weights, milk, eggs, entries, groupHeads, young, produce] = await Promise.all([
      tx.farmFeeding.findMany({ where: { ...both, voidedAt: null }, select: { animalId: true, groupId: true, cost: true } }),
      tx.farmHealthEvent.findMany({ where: { ...both, voidedAt: null, cost: { not: null } }, select: { animalId: true, groupId: true, cost: true } }),
      tx.farmWeight.findMany({ where: both, orderBy: { date: 'desc' }, select: { animalId: true, groupId: true, kg: true } }),
      tx.farmMilkRecord.findMany({ where: { animalId: { in: animalIds }, voidedAt: null, withheld: false }, select: { animalId: true, litres: true } }),
      tx.farmEggRecord.findMany({ where: { groupId: { in: groupIds }, voidedAt: null, withheld: false }, select: { groupId: true, goodEggs: true } }),
      tx.farmGroupCount.findMany({ where: { groupId: { in: groupIds }, reason: { in: ['PLACED', 'BOUGHT', 'BORN'] } }, select: { groupId: true, change: true, amount: true } }),
      tx.farmGroup.findMany({ where: { id: { in: groupIds } }, select: { id: true, headCount: true } }),
      tx.farmAnimal.findMany({ where: { damId: { in: animalIds } }, select: { damId: true } }),
      tx.farmProduceSettings.findFirst({ select: { milkVariantId: true, eggVariantId: true, eggsPerUnit: true } }),
    ]);
    const prices = produce
      ? await tx.productVariant.findMany({ where: { id: { in: [produce.milkVariantId, produce.eggVariantId].filter((x): x is string => !!x) } }, select: { id: true, price: true } })
      : [];
    const milkPrice = n(prices.find((p) => p.id === produce?.milkVariantId)?.price);
    const eggPrice = produce?.eggVariantId ? n(prices.find((p) => p.id === produce.eggVariantId)?.price) / Math.max(1, produce.eggsPerUnit) : 0;

    const heads = new Map(groupHeads.map((g) => [g.id, Math.max(1, g.headCount)]));
    const feedOwn = sumBy(feedings, (f) => f.animalId, (f) => n(f.cost));
    const feedGroup = sumBy(feedings, (f) => (f.animalId ? null : f.groupId), (f) => n(f.cost));
    const vetOwn = sumBy(health, (h) => h.animalId, (h) => n(h.cost));
    const vetGroup = sumBy(health, (h) => (h.animalId ? null : h.groupId), (h) => n(h.cost));
    const litres = sumBy(milk, (m) => m.animalId, (m) => n(m.litres));
    const goodEggs = sumBy(eggs, (e) => e.groupId, (e) => e.goodEggs);
    const calves = sumBy(young, (y) => y.damId, () => 1);
    const lastWeight = (key: 'animalId' | 'groupId', id: string) => {
      const w = weights.find((x) => x[key] === id);
      return w ? n(w.kg) : null;
    };
    const share = (m: Map<string, number>, groupId: string | null) => (groupId ? (m.get(groupId) ?? 0) / (heads.get(groupId) ?? 1) : 0);
    const now = asDate(today);

    const out: AnimalValuation[] = animals.map((a) => {
      const rate = settings.rates[a.species];
      const ageMonths = a.birthDate ? monthsBetween(a.birthDate, now) : null;
      const weightKg = lastWeight('animalId', a.id);
      const v = valueOf({
        entry: a.boughtPrice != null ? n(a.boughtPrice) : rate.birthValue,
        feed: (feedOwn.get(a.id) ?? 0) + share(feedGroup, a.groupId),
        vet: (vetOwn.get(a.id) ?? 0) + share(vetGroup, a.groupId),
        weightKg,
        ageMonths,
        rate,
        margin: settings.margin,
        sellingCost: settings.sellingCost,
      });
      const produceIncome = r2((litres.get(a.id) ?? 0) * milkPrice);
      const offspring = calves.get(a.id) ?? 0;
      const offspringValue = r2(offspring * rate.birthValue);
      return {
        ...v, id: a.id, kind: 'ANIMAL', tag: a.tag, name: a.name, species: a.species, sex: a.sex, ageMonths, weightKg, heads: 1, total: v.value,
        produce: produceIncome > 0 ? 'MILK' : null, produceIncome, offspring, offspringValue, profit: profitOf({ income: produceIncome, offspringValue, value: v.value, cost: v.cost }),
        warnings: valuationWarnings({ weightKg, feed: v.feed, ageMonths, pricePerKg: rate.pricePerKg }),
      };
    });

    for (const g of groups) {
      const rate = settings.rates[g.species];
      const h = heads.get(g.id) ?? Math.max(1, g.headCount);
      const added = entries.filter((e) => e.groupId === g.id);
      const placed = added.reduce((s, e) => s + Math.max(0, e.change), 0);
      const paid = added.reduce((s, e) => s + n(e.amount), 0);
      const unpaid = added.filter((e) => e.amount == null).reduce((s, e) => s + Math.max(0, e.change), 0);
      const entryPerHead = placed > 0 ? (paid + unpaid * rate.birthValue) / placed : rate.birthValue;
      const ageMonths = monthsBetween(g.placedOn, now);
      const weightKg = lastWeight('groupId', g.id);
      const v = valueOf({ entry: entryPerHead, feed: (feedGroup.get(g.id) ?? 0) / h, vet: (vetGroup.get(g.id) ?? 0) / h, weightKg, ageMonths, rate, margin: settings.margin, sellingCost: settings.sellingCost });
      const produceIncome = r2(((goodEggs.get(g.id) ?? 0) * eggPrice) / h);
      out.push({
        ...v, id: g.id, kind: 'GROUP', tag: null, name: g.name, species: g.species, sex: null, ageMonths, weightKg, heads: g.headCount, total: r2(v.value * g.headCount),
        produce: produceIncome > 0 ? 'EGGS' : null, produceIncome, offspring: 0, offspringValue: 0, profit: profitOf({ income: produceIncome, offspringValue: 0, value: v.value, cost: v.cost }),
        warnings: valuationWarnings({ weightKg, feed: v.feed, ageMonths, pricePerKg: rate.pricePerKg }),
      });
    }
    return out;
  }
}
