import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { FarmContext } from './farm-access';
import { addDays, asDate, dayOf, todayKey, withdrawalState } from './farm-livestock.util';
import { seasonFigures } from './farm-crops.util';
import { aging } from './farm-sales.util';
import { EnterpriseMoney, FARM_REPORTS, FarmReport, FarmReportKey, Row, costOf, emptyMoney, perUnit, profitOf, r2, totalsOf } from './farm-reports.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const DAY_VALUE = { PRESENT: 1, HALF_DAY: 0.5, ABSENT: 0 } as const;
const MILK_KINDS = ['DAIRY', 'GOATS', 'SHEEP'];
const EGG_KINDS = ['LAYERS', 'KIENYEJI'];

/** Zaroda Shamba F7: the farm's reports, each as rows that the screen shows and the Excel download writes. */
@Injectable()
export class FarmReportsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  run(farm: FarmContext, key: FarmReportKey, from: string, to: string): Promise<FarmReport> {
    return this.tenantPrisma.run(async (tx) => {
      const subtitle = FARM_REPORTS[key].period ? `${from} to ${to}` : `As at ${todayKey()}`;
      const base = { key, title: FARM_REPORTS[key].title, subtitle };
      switch (key) {
        case 'enterprises':
          return { ...base, ...(await this.enterprises(tx, from, to)) };
        case 'unit-costs':
          return { ...base, ...(await this.unitCosts(tx, from, to)) };
        case 'herd':
          return { ...base, ...(await this.herd(tx, farm)) };
        case 'breeding':
          return { ...base, ...(await this.breeding(tx, farm)) };
        case 'health':
          return { ...base, ...(await this.health(tx, farm, from, to)) };
        case 'crops':
          return { ...base, ...(await this.crops(tx, farm, from, to)) };
        case 'wages':
          return { ...base, ...(await this.wages(tx, from, to)) };
        case 'debtors':
          return { ...base, ...(await this.debtors(tx)) };
      }
    });
  }

  // ── Money per enterprise ────────────────────────────────────────────────

  /** Income and costs per enterprise between two days. Anything not tagged to an enterprise is shown as "Not tagged". */
  async money(tx: TenantTx, from: string, to: string) {
    const start = new Date(Date.parse(`${from}T00:00:00Z`) - 3 * 3600_000);
    const end = new Date(Date.parse(`${addDays(to, 1)}T00:00:00Z`) - 3 * 3600_000);
    const inRange = { gte: asDate(from), lte: asDate(to) };
    const [enterprises, animals, groups, tags, saleLines, deliveries, counts, feedings, health, muster, workers, seasons, activities] = await Promise.all([
      tx.farmEnterprise.findMany({ select: { id: true, name: true, kind: true } }),
      tx.farmAnimal.findMany({ select: { id: true, enterpriseId: true, status: true, statusDate: true, exitAmount: true, boughtOn: true, boughtPrice: true } }),
      tx.farmGroup.findMany({ select: { id: true, enterpriseId: true } }),
      tx.farmProductTag.findMany(),
      tx.saleLineItem.findMany({ where: { sale: { status: 'COMPLETED', createdAt: { gte: start, lt: end } } }, select: { variantId: true, quantity: true, unitPrice: true } }),
      tx.farmDelivery.findMany({ where: { voidedAt: null, date: inRange } }),
      tx.farmGroupCount.findMany({ where: { date: inRange, reason: { in: ['SOLD', 'SLAUGHTERED', 'BOUGHT'] }, amount: { not: null } } }),
      tx.farmFeeding.findMany({ where: { voidedAt: null, date: inRange } }),
      tx.farmHealthEvent.findMany({ where: { voidedAt: null, date: inRange, cost: { not: null } } }),
      tx.farmMuster.findMany({ where: { date: inRange, status: { not: 'ABSENT' } } }),
      tx.farmWorker.findMany({ select: { id: true, dailyRate: true } }),
      tx.farmCropSeason.findMany({ select: { id: true, enterpriseId: true } }),
      tx.farmCropActivity.findMany({ where: { voidedAt: null, date: inRange } }),
    ]);
    const map = new Map<string, EnterpriseMoney>();
    const of = (eid: string | null | undefined) => {
      const k = eid ?? 'none';
      if (!map.has(k)) map.set(k, emptyMoney());
      return map.get(k)!;
    };
    const animalEnt = new Map(animals.map((a) => [a.id, a.enterpriseId]));
    const groupEnt = new Map(groups.map((g) => [g.id, g.enterpriseId]));
    const targetEnt = (x: { animalId: string | null; groupId: string | null }) => (x.animalId ? animalEnt.get(x.animalId) : x.groupId ? groupEnt.get(x.groupId) : null);
    const tagOf = new Map(tags.map((t) => [t.variantId, t.enterpriseId]));

    for (const l of saleLines) {
      const e = tagOf.get(l.variantId);
      if (e) of(e).income += n(l.quantity) * n(l.unitPrice);
    }
    for (const d of deliveries) of(d.enterpriseId ?? tagOf.get(d.variantId)).income += n(d.amount);
    for (const a of animals) {
      const exited = a.statusDate && dayOf(a.statusDate) >= from && dayOf(a.statusDate) <= to;
      if (exited && (a.status === 'SOLD' || a.status === 'SLAUGHTERED')) of(a.enterpriseId).income += n(a.exitAmount);
      if (a.boughtOn && dayOf(a.boughtOn) >= from && dayOf(a.boughtOn) <= to) of(a.enterpriseId).stock += n(a.boughtPrice);
    }
    for (const c of counts) {
      if (c.reason === 'BOUGHT') of(groupEnt.get(c.groupId)).stock += n(c.amount);
      else of(groupEnt.get(c.groupId)).income += n(c.amount);
    }
    for (const f of feedings) of(targetEnt(f)).feed += n(f.cost);
    for (const h of health) of(targetEnt(h)).vet += n(h.cost);
    const rate = new Map(workers.map((w) => [w.id, n(w.dailyRate)]));
    for (const m of muster) of(m.enterpriseId).labour += DAY_VALUE[m.status] * (rate.get(m.workerId) ?? 0);
    const seasonEnt = new Map(seasons.map((s) => [s.id, s.enterpriseId]));
    for (const a of activities) of(seasonEnt.get(a.seasonId)).field += n(a.inputCost) + n(a.labourCost);

    const name = (k: string) => (k === 'none' ? 'Not tagged' : enterprises.find((e) => e.id === k)?.name ?? 'Unknown');
    const kind = (k: string) => enterprises.find((e) => e.id === k)?.kind ?? null;
    return { map, name, kind, enterprises };
  }

  private async enterprises(tx: TenantTx, from: string, to: string) {
    const { map, name } = await this.money(tx, from, to);
    const columns = [
      { key: 'enterprise', label: 'Enterprise' },
      { key: 'income', label: 'Income', type: 'money' as const },
      { key: 'feed', label: 'Feed', type: 'money' as const },
      { key: 'vet', label: 'Vet and drugs', type: 'money' as const },
      { key: 'labour', label: 'Labour', type: 'money' as const },
      { key: 'field', label: 'Field inputs and work', type: 'money' as const },
      { key: 'stock', label: 'Animals bought', type: 'money' as const },
      { key: 'cost', label: 'Total cost', type: 'money' as const },
      { key: 'profit', label: 'Profit', type: 'money' as const },
    ];
    const rows: Row[] = [...map.entries()]
      .map(([k, m]) => ({ enterprise: name(k), income: r2(m.income), feed: r2(m.feed), vet: r2(m.vet), labour: r2(m.labour), field: r2(m.field), stock: r2(m.stock), cost: costOf(m), profit: profitOf(m) }))
      .sort((a, b) => (b.profit as number) - (a.profit as number));
    return {
      columns,
      rows,
      totals: totalsOf(rows, columns),
      notes: [
        'Income: till sales of products tagged to the enterprise, credit deliveries, and animals or birds sold. Costs: feed fed, treatments, muster-roll days at each worker\'s rate, field inputs and work, and animals bought.',
        'Tag products under Buyers & credit > Sales by enterprise, and set the enterprise on animals, flocks, crop seasons and the muster roll, so nothing lands in "Not tagged".',
      ],
    };
  }

  private async unitCosts(tx: TenantTx, from: string, to: string) {
    const { map, enterprises } = await this.money(tx, from, to);
    const inRange = { gte: asDate(from), lte: asDate(to) };
    const [animals, groups, milk, eggs] = await Promise.all([
      tx.farmAnimal.findMany({ select: { id: true, enterpriseId: true } }),
      tx.farmGroup.findMany({ select: { id: true, enterpriseId: true } }),
      tx.farmMilkRecord.findMany({ where: { voidedAt: null, date: inRange }, select: { animalId: true, groupId: true, litres: true } }),
      tx.farmEggRecord.findMany({ where: { voidedAt: null, date: inRange }, select: { groupId: true, goodEggs: true, cracked: true, small: true } }),
    ]);
    const animalEnt = new Map(animals.map((a) => [a.id, a.enterpriseId]));
    const groupEnt = new Map(groups.map((g) => [g.id, g.enterpriseId]));
    const litres = new Map<string, number>();
    for (const m of milk) {
      const e = (m.animalId ? animalEnt.get(m.animalId) : groupEnt.get(m.groupId!)) ?? 'none';
      litres.set(e, (litres.get(e) ?? 0) + n(m.litres));
    }
    const eggCount = new Map<string, number>();
    for (const e of eggs) {
      const k = groupEnt.get(e.groupId) ?? 'none';
      eggCount.set(k, (eggCount.get(k) ?? 0) + e.goodEggs + e.cracked + e.small);
    }
    const rows: Row[] = [];
    for (const e of enterprises) {
      const m = map.get(e.id) ?? emptyMoney();
      if (MILK_KINDS.includes(e.kind) || litres.get(e.id)) {
        const made = r2(litres.get(e.id) ?? 0);
        rows.push({ what: `${e.name}: milk`, made, unit: 'litre', cost: costOf(m), perUnit: perUnit(costOf(m), made), income: r2(m.income), incomePerUnit: perUnit(m.income, made) });
      }
      if (EGG_KINDS.includes(e.kind) || eggCount.get(e.id)) {
        const made = eggCount.get(e.id) ?? 0;
        rows.push({ what: `${e.name}: eggs`, made, unit: 'egg', cost: costOf(m), perUnit: perUnit(costOf(m), made), income: r2(m.income), incomePerUnit: perUnit(m.income, made) });
      }
    }
    const seasons = await tx.farmCropSeason.findMany({ where: { OR: [{ status: { not: 'CLOSED' } }, { closedOn: { gte: asDate(from) } }] } });
    const [acts, harvests, units] = await Promise.all([
      tx.farmCropActivity.findMany({ where: { seasonId: { in: seasons.map((s) => s.id) }, voidedAt: null } }),
      tx.farmHarvest.findMany({ where: { seasonId: { in: seasons.map((s) => s.id) }, voidedAt: null } }),
      tx.farmUnit.findMany({ where: { id: { in: seasons.map((s) => s.unitId) } }, select: { id: true, name: true } }),
    ]);
    for (const s of seasons) {
      const f = seasonFigures(n(s.acres), acts.filter((a) => a.seasonId === s.id).map((a) => ({ inputCost: n(a.inputCost), labourCost: n(a.labourCost) })), harvests.filter((h) => h.seasonId === s.id).map((h) => ({ kg: n(h.kg) })));
      const field = units.find((u) => u.id === s.unitId)?.name ?? '';
      rows.push({ what: `${s.crop} (${field}): per kg`, made: f.harvestedKg, unit: 'kg', cost: f.totalCost, perUnit: f.costPerKg, income: null, incomePerUnit: null });
      rows.push({ what: `${s.crop} (${field}): per acre`, made: n(s.acres), unit: 'acre', cost: f.totalCost, perUnit: f.costPerAcre, income: null, incomePerUnit: null });
    }
    return {
      columns: [
        { key: 'what', label: 'What' },
        { key: 'made', label: 'Made', type: 'number' as const },
        { key: 'unit', label: 'Unit' },
        { key: 'cost', label: 'Cost', type: 'money' as const },
        { key: 'perUnit', label: 'Cost per unit', type: 'money' as const },
        { key: 'income', label: 'Income', type: 'money' as const },
        { key: 'incomePerUnit', label: 'Income per unit', type: 'money' as const },
      ],
      rows,
      notes: ['Milk and egg costs are all the enterprise\'s costs in the period over what it produced. Crops are whole-season figures for seasons open in the period.'],
    };
  }

  // ── Registers ───────────────────────────────────────────────────────────

  private seen(farm: FarmContext) {
    return farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } };
  }

  private async herd(tx: TenantTx, farm: FarmContext) {
    const animals = await tx.farmAnimal.findMany({ where: this.seen(farm), orderBy: [{ status: 'asc' }, { species: 'asc' }, { tag: 'asc' }] });
    const ids = animals.map((a) => a.id);
    const [units, weights, events, groups] = await Promise.all([
      tx.farmUnit.findMany({ select: { id: true, name: true } }),
      tx.farmWeight.findMany({ where: { animalId: { in: ids } }, orderBy: { date: 'desc' } }),
      tx.farmHealthEvent.findMany({ where: { animalId: { in: ids }, voidedAt: null } }),
      tx.farmGroup.findMany({ where: { ...this.seen(farm), active: true } }),
    ]);
    const tagOf = new Map(animals.map((a) => [a.id, a.tag]));
    const today = todayKey();
    const rows: Row[] = animals.map((a) => {
      const w = weights.find((x) => x.animalId === a.id);
      const wd = withdrawalState(events.filter((e) => e.animalId === a.id), today);
      return {
        tag: a.tag, name: a.name, species: a.species, breed: a.breed, sex: a.sex, born: a.birthDate ? dayOf(a.birthDate) : null, status: a.status,
        place: units.find((u) => u.id === a.unitId)?.name ?? null, dam: a.damId ? tagOf.get(a.damId) ?? null : null, sire: a.sireId ? tagOf.get(a.sireId) ?? null : a.sireCode,
        weight: w ? n(w.kg) : null, withheld: [wd.milkUntil && `milk to ${wd.milkUntil}`, wd.meatUntil && `meat to ${wd.meatUntil}`].filter(Boolean).join(', ') || null,
      };
    });
    for (const g of groups) {
      rows.push({ tag: '(flock/group)', name: g.name, species: g.species, breed: g.breed, sex: null, born: dayOf(g.placedOn), status: `${g.headCount} head`, place: units.find((u) => u.id === g.unitId)?.name ?? null, dam: null, sire: null, weight: null, withheld: null });
    }
    return {
      columns: [
        { key: 'tag', label: 'Tag' }, { key: 'name', label: 'Name' }, { key: 'species', label: 'Species' }, { key: 'breed', label: 'Breed' }, { key: 'sex', label: 'Sex' },
        { key: 'born', label: 'Born', type: 'date' as const }, { key: 'status', label: 'Status' }, { key: 'place', label: 'Kept in' }, { key: 'dam', label: 'Dam' }, { key: 'sire', label: 'Sire' },
        { key: 'weight', label: 'Last weight (kg)', type: 'number' as const }, { key: 'withheld', label: 'Withdrawal' },
      ],
      rows,
      notes: [`${animals.filter((a) => a.status === 'ACTIVE').length} animals on the farm, ${groups.reduce((s, g) => s + g.headCount, 0)} in flocks and groups.`],
    };
  }

  private async breeding(tx: TenantTx, farm: FarmContext) {
    const animals = await tx.farmAnimal.findMany({ where: { ...this.seen(farm), status: 'ACTIVE', sex: 'FEMALE' }, select: { id: true, tag: true, name: true, species: true } });
    const ids = animals.map((a) => a.id);
    const [tasks, events] = await Promise.all([
      tx.farmDueTask.findMany({ where: { animalId: { in: ids }, doneOn: null, cancelledAt: null, kind: { in: ['EXPECTED_BIRTH', 'DRY_OFF'] } }, orderBy: { dueOn: 'asc' } }),
      tx.farmBreedingEvent.findMany({ where: { animalId: { in: ids }, voidedAt: null }, orderBy: { date: 'desc' } }),
    ]);
    const label = (id: string | null) => {
      const a = animals.find((x) => x.id === id);
      return a ? `${a.tag}${a.name ? ` ${a.name}` : ''}` : '';
    };
    const rows: Row[] = tasks.map((t) => ({ due: dayOf(t.dueOn), what: t.kind === 'EXPECTED_BIRTH' ? 'Due to give birth' : 'Dry off', animal: label(t.animalId), note: t.title }));
    for (const a of animals) {
      const last = events.find((e) => e.animalId === a.id);
      if (last && (last.kind === 'SERVED' || last.kind === 'AI')) {
        rows.push({ due: addDays(dayOf(last.date), 60), what: 'Pregnancy check due', animal: label(a.id), note: `${last.kind === 'AI' ? 'AI' : 'Served'} on ${dayOf(last.date)}${last.sireCode ? ` (${last.sireCode})` : ''}` });
      }
      if (last && last.kind === 'HEAT') rows.push({ due: addDays(dayOf(last.date), 21), what: 'Next heat expected', animal: label(a.id), note: `Last heat ${dayOf(last.date)}` });
    }
    rows.sort((x, y) => String(x.due).localeCompare(String(y.due)));
    return { columns: [{ key: 'due', label: 'Due', type: 'date' as const }, { key: 'what', label: 'What' }, { key: 'animal', label: 'Animal' }, { key: 'note', label: 'Details' }], rows };
  }

  private async health(tx: TenantTx, farm: FarmContext, from: string, to: string) {
    const [animals, groups] = await Promise.all([
      tx.farmAnimal.findMany({ where: this.seen(farm), select: { id: true, tag: true, name: true } }),
      tx.farmGroup.findMany({ where: this.seen(farm), select: { id: true, name: true } }),
    ]);
    const events = await tx.farmHealthEvent.findMany({
      where: { date: { gte: asDate(from), lte: asDate(to) }, OR: [{ animalId: { in: animals.map((a) => a.id) } }, { groupId: { in: groups.map((g) => g.id) } }] },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    });
    const drugs = await tx.farmDrug.findMany({ select: { id: true, name: true } });
    const rows: Row[] = events.map((e) => ({
      date: dayOf(e.date),
      who: e.animalId ? animals.find((a) => a.id === e.animalId)?.tag ?? '' : groups.find((g) => g.id === e.groupId)?.name ?? '',
      kind: e.kind, diagnosis: e.diagnosis, drug: drugs.find((d) => d.id === e.drugId)?.name ?? null, dose: e.dose, vet: e.vetName, cost: e.cost === null ? null : n(e.cost),
      milk: e.milkWithdrawalUntil ? dayOf(e.milkWithdrawalUntil) : null, meat: e.meatWithdrawalUntil ? dayOf(e.meatWithdrawalUntil) : null, eggs: e.eggWithdrawalUntil ? dayOf(e.eggWithdrawalUntil) : null,
      voided: e.voidedAt ? `voided: ${e.voidReason ?? ''}` : null,
    }));
    const columns = [
      { key: 'date', label: 'Date', type: 'date' as const }, { key: 'who', label: 'Animal or group' }, { key: 'kind', label: 'What' }, { key: 'diagnosis', label: 'Diagnosis' },
      { key: 'drug', label: 'Drug' }, { key: 'dose', label: 'Dose' }, { key: 'vet', label: 'Vet' }, { key: 'cost', label: 'Cost', type: 'money' as const },
      { key: 'milk', label: 'Milk withheld to', type: 'date' as const }, { key: 'meat', label: 'Meat withheld to', type: 'date' as const }, { key: 'eggs', label: 'Eggs withheld to', type: 'date' as const },
      { key: 'voided', label: 'Note' },
    ];
    return { columns, rows, totals: totalsOf(rows.filter((r) => !r.voided), columns), notes: ['Veterinary record kept for the Veterinary Surgeons Act and Kenya Dairy Board: drug, dose, who gave it and the withdrawal dates.'] };
  }

  private async crops(tx: TenantTx, farm: FarmContext, from: string, to: string) {
    const seasons = await tx.farmCropSeason.findMany({
      where: { ...(farm.unitIds === null ? {} : { unitId: { in: farm.unitIds } }), OR: [{ status: { not: 'CLOSED' } }, { closedOn: { gte: asDate(from) } }], createdAt: { lte: new Date(`${to}T23:59:59Z`) } },
      orderBy: { plantedOn: 'desc' },
    });
    const ids = seasons.map((s) => s.id);
    const [acts, harvests, units] = await Promise.all([
      tx.farmCropActivity.findMany({ where: { seasonId: { in: ids }, voidedAt: null } }),
      tx.farmHarvest.findMany({ where: { seasonId: { in: ids }, voidedAt: null } }),
      tx.farmUnit.findMany({ where: { id: { in: seasons.map((s) => s.unitId) } }, select: { id: true, name: true } }),
    ]);
    const rows: Row[] = seasons.map((s) => {
      const a = acts.filter((x) => x.seasonId === s.id);
      const f = seasonFigures(n(s.acres), a.map((x) => ({ inputCost: n(x.inputCost), labourCost: n(x.labourCost) })), harvests.filter((h) => h.seasonId === s.id).map((h) => ({ kg: n(h.kg) })));
      const safe = a.filter((x) => x.kind === 'SPRAYING' && x.safeHarvestFrom).map((x) => dayOf(x.safeHarvestFrom!)).sort().pop() ?? null;
      return {
        field: units.find((u) => u.id === s.unitId)?.name ?? '', crop: s.crop, variety: s.variety, acres: n(s.acres), planted: s.plantedOn ? dayOf(s.plantedOn) : null, status: s.status,
        kg: f.harvestedKg, kgPerAcre: f.kgPerAcre, cost: f.totalCost, costPerAcre: f.costPerAcre, costPerKg: f.costPerKg, safe: safe && safe > todayKey() ? safe : null, seed: [s.seedSupplier, s.seedCertNo].filter(Boolean).join(' lot ') || null,
      };
    });
    const columns = [
      { key: 'field', label: 'Field' }, { key: 'crop', label: 'Crop' }, { key: 'variety', label: 'Variety' }, { key: 'acres', label: 'Acres', type: 'number' as const },
      { key: 'planted', label: 'Planted', type: 'date' as const }, { key: 'status', label: 'Status' }, { key: 'kg', label: 'Harvested kg', type: 'number' as const },
      { key: 'kgPerAcre', label: 'kg an acre', type: 'number' as const }, { key: 'cost', label: 'Cost', type: 'money' as const }, { key: 'costPerAcre', label: 'Cost an acre', type: 'money' as const },
      { key: 'costPerKg', label: 'Cost a kg', type: 'money' as const }, { key: 'safe', label: 'No harvest until', type: 'date' as const }, { key: 'seed', label: 'Seed (KEPHIS)' },
    ];
    return { columns, rows, totals: totalsOf(rows, columns.filter((c) => ['field', 'acres', 'kg', 'cost'].includes(c.key))) };
  }

  // ── Money owed and paid ─────────────────────────────────────────────────

  private async wages(tx: TenantTx, from: string, to: string) {
    const runs = await tx.farmWageRun.findMany({ where: { periodEnd: { gte: asDate(from) }, periodStart: { lte: asDate(to) } }, orderBy: { periodStart: 'asc' } });
    const lines = await tx.farmWageLine.findMany({ where: { runId: { in: runs.map((r) => r.id) } } });
    const workers = await tx.farmWorker.findMany({ where: { id: { in: [...new Set(lines.map((l) => l.workerId))] } }, select: { id: true, name: true, idNumber: true } });
    const by = new Map<string, Row>();
    for (const l of lines) {
      const w = workers.find((x) => x.id === l.workerId);
      const row = by.get(l.workerId) ?? { worker: w?.name ?? '', idNumber: w?.idNumber ?? null, days: 0, gross: 0, nssf: 0, shif: 0, housing: 0, paye: 0, net: 0, unpaid: 0 };
      row.days = r2((row.days as number) + n(l.days));
      for (const [k, v] of [['gross', l.gross], ['nssf', l.nssf], ['shif', l.shif], ['housing', l.housingLevy], ['paye', l.paye], ['net', l.net]] as const) row[k] = r2((row[k] as number) + n(v));
      if (l.status !== 'PAID') row.unpaid = r2((row.unpaid as number) + n(l.net));
      by.set(l.workerId, row);
    }
    const rows = [...by.values()].sort((a, b) => String(a.worker).localeCompare(String(b.worker)));
    const columns = [
      { key: 'worker', label: 'Worker' }, { key: 'idNumber', label: 'ID number' }, { key: 'days', label: 'Days', type: 'number' as const }, { key: 'gross', label: 'Gross', type: 'money' as const },
      { key: 'nssf', label: 'NSSF', type: 'money' as const }, { key: 'shif', label: 'SHIF', type: 'money' as const }, { key: 'housing', label: 'Housing Levy', type: 'money' as const },
      { key: 'paye', label: 'PAYE', type: 'money' as const }, { key: 'net', label: 'Net', type: 'money' as const }, { key: 'unpaid', label: 'Not yet paid', type: 'money' as const },
    ];
    return { columns, rows, totals: totalsOf(rows, columns), notes: [`From ${runs.length} pay run${runs.length === 1 ? '' : 's'} (${runs.map((r) => r.number).join(', ') || 'none'}). The NSSF, SHIF, Housing Levy and PAYE columns are what the farm must remit.`] };
  }

  private async debtors(tx: TenantTx) {
    const buyers = await tx.farmBuyer.findMany({ orderBy: { name: 'asc' } });
    const [deliveries, payments] = await Promise.all([
      tx.farmDelivery.findMany({ where: { voidedAt: null }, select: { buyerId: true, date: true, amount: true } }),
      tx.farmBuyerPayment.findMany({ where: { voidedAt: null }, select: { buyerId: true, date: true, amount: true } }),
    ]);
    const today = todayKey();
    const rows: Row[] = buyers
      .map((b) => {
        const a = aging(
          [
            ...deliveries.filter((d) => d.buyerId === b.id).map((d) => ({ date: dayOf(d.date), kind: 'DELIVERY' as const, amount: n(d.amount) })),
            ...payments.filter((p) => p.buyerId === b.id).map((p) => ({ date: dayOf(p.date), kind: 'PAYMENT' as const, amount: n(p.amount) })),
          ],
          today,
        );
        return { buyer: b.name, kind: b.kind, phone: b.phone, limit: b.creditLimit === null ? null : n(b.creditLimit), current: a.current, d31: a.d31, d61: a.d61, d90: a.d90, owed: a.owed };
      })
      .filter((r) => r.owed > 0);
    const columns = [
      { key: 'buyer', label: 'Buyer' }, { key: 'kind', label: 'Kind' }, { key: 'phone', label: 'Phone' }, { key: 'limit', label: 'Credit limit', type: 'money' as const },
      { key: 'current', label: '0-30 days', type: 'money' as const }, { key: 'd31', label: '31-60 days', type: 'money' as const }, { key: 'd61', label: '61-90 days', type: 'money' as const },
      { key: 'd90', label: 'Over 90 days', type: 'money' as const }, { key: 'owed', label: 'Owed', type: 'money' as const },
    ];
    return { columns, rows, totals: totalsOf(rows, columns.filter((c) => c.key !== 'limit')) };
  }
}
