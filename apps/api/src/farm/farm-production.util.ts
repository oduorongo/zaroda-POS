import { FarmMilkUse } from '@prisma/client';
import { addDays } from './farm-livestock.util';

export type YieldBy = 'day' | 'week' | 'month';

/** Milk goes into POS stock only when it is for sale and not withheld. */
export const milkToStock = (litres: number, use: FarmMilkUse, withheld: boolean): number => (use === 'SOLD' && !withheld ? round3(litres) : 0);

/** Good eggs as units of the egg product (30 a tray), to 3 decimals; withheld eggs never go to stock. */
export const eggsToStock = (goodEggs: number, eggsPerUnit: number, withheld: boolean): number =>
  withheld || goodEggs <= 0 ? 0 : round3(goodEggs / Math.max(1, eggsPerUnit));

/** Eggs laid (good, cracked and small) per 100 birds. */
export const layPct = (eggs: number, birds: number): number | null => (birds > 0 ? Math.round((eggs / birds) * 1000) / 10 : null);

export const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The bucket a day falls in: the day itself, the Monday of its week, or the first of its month. */
export function bucketOf(day: string, by: YieldBy): string {
  if (by === 'day') return day;
  if (by === 'month') return `${day.slice(0, 7)}-01`;
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

/** The buckets shown, oldest first, ending with the one holding `today`: 30 days, 12 weeks or 12 months. */
export function bucketsUpTo(today: string, by: YieldBy): string[] {
  const out: string[] = [];
  if (by === 'day') for (let i = 29; i >= 0; i--) out.push(addDays(today, -i));
  else if (by === 'week') for (let i = 11; i >= 0; i--) out.push(addDays(bucketOf(today, 'week'), -7 * i));
  else {
    const [y, m] = today.split('-').map(Number);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      out.push(d.toISOString().slice(0, 10));
    }
  }
  return out;
}

export interface MilkRow { date: string; litres: number; use: FarmMilkUse; withheld: boolean }
export interface EggRow { date: string; birds: number; goodEggs: number; cracked: number; small: number; feedKg: number | null; deaths: number }

export interface YieldBucket {
  start: string;
  milk: { total: number; forSale: number; withheld: number; calves: number; home: number; discarded: number };
  eggs: { good: number; cracked: number; small: number; total: number; layPct: number | null; feedKg: number; deaths: number };
}

/** Milk and eggs added up per day, week or month. Lay % is all eggs over all bird-days in the bucket. */
export function yields(milk: MilkRow[], eggs: EggRow[], buckets: string[], by: YieldBy): YieldBucket[] {
  const map = new Map<string, YieldBucket & { birdDays: number }>(
    buckets.map((start) => [
      start,
      { start, birdDays: 0, milk: { total: 0, forSale: 0, withheld: 0, calves: 0, home: 0, discarded: 0 }, eggs: { good: 0, cracked: 0, small: 0, total: 0, layPct: null, feedKg: 0, deaths: 0 } },
    ]),
  );
  for (const r of milk) {
    const b = map.get(bucketOf(r.date, by));
    if (!b) continue;
    b.milk.total += r.litres;
    if (r.withheld) b.milk.withheld += r.litres;
    else if (r.use === 'SOLD') b.milk.forSale += r.litres;
    if (r.use === 'CALVES') b.milk.calves += r.litres;
    if (r.use === 'HOME') b.milk.home += r.litres;
    if (r.use === 'DISCARDED') b.milk.discarded += r.litres;
  }
  for (const r of eggs) {
    const b = map.get(bucketOf(r.date, by));
    if (!b) continue;
    b.eggs.good += r.goodEggs;
    b.eggs.cracked += r.cracked;
    b.eggs.small += r.small;
    b.eggs.feedKg += r.feedKg ?? 0;
    b.eggs.deaths += r.deaths;
    b.birdDays += r.birds;
  }
  return [...map.values()].map(({ birdDays, ...b }) => {
    const total = b.eggs.good + b.eggs.cracked + b.eggs.small;
    return {
      start: b.start,
      milk: { total: round3(b.milk.total), forSale: round3(b.milk.forSale), withheld: round3(b.milk.withheld), calves: round3(b.milk.calves), home: round3(b.milk.home), discarded: round3(b.milk.discarded) },
      eggs: { ...b.eggs, total, feedKg: round3(b.eggs.feedKg), layPct: layPct(total, birdDays) },
    };
  });
}
