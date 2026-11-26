import { FarmSpecies } from '@prisma/client';

/** What the farmer sets per animal type. Starting values only: every farm edits them to its local market. */
export interface ValuationRate {
  /** What an animal born on the farm is worth at birth (KES). */
  birthValue: number;
  /** Market price per kg live weight (KES): what a similar animal sells for. */
  pricePerKg: number;
  /** Past this age it has fewer productive years left and its value drops; null = age never lowers it. */
  primeAgeMonths: number | null;
  /** How much the value drops for each year past prime age (0.15 = 15%). */
  ageDropRate: number;
}

export const DEFAULT_RATES: Record<FarmSpecies, ValuationRate> = {
  CATTLE: { birthValue: 5000, pricePerKg: 250, primeAgeMonths: 96, ageDropRate: 0.15 },
  GOAT: { birthValue: 1500, pricePerKg: 400, primeAgeMonths: 72, ageDropRate: 0.15 },
  SHEEP: { birthValue: 1500, pricePerKg: 350, primeAgeMonths: 72, ageDropRate: 0.15 },
  PIG: { birthValue: 2000, pricePerKg: 250, primeAgeMonths: 48, ageDropRate: 0.15 },
  CHICKEN: { birthValue: 100, pricePerKg: 400, primeAgeMonths: 18, ageDropRate: 0.15 },
  DUCK: { birthValue: 150, pricePerKg: 400, primeAgeMonths: 36, ageDropRate: 0.15 },
  TURKEY: { birthValue: 300, pricePerKg: 450, primeAgeMonths: 36, ageDropRate: 0.15 },
  RABBIT: { birthValue: 300, pricePerKg: 400, primeAgeMonths: 36, ageDropRate: 0.15 },
  FISH: { birthValue: 10, pricePerKg: 400, primeAgeMonths: null, ageDropRate: 0 },
  BEE: { birthValue: 0, pricePerKg: 0, primeAgeMonths: null, ageDropRate: 0 },
  OTHER: { birthValue: 0, pricePerKg: 0, primeAgeMonths: null, ageDropRate: 0 },
};

export const DEFAULT_MARGIN = 0.2;
export const DEFAULT_SELLING_COST = 0.05;
/** Age never takes more than this off: an old animal still sells for meat. */
export const MAX_AGE_DROP = 0.5;

const r2 = (n: number) => Math.round(n * 100) / 100;
/** Prices are offered in round 50s. */
export const round50 = (n: number) => Math.round(n / 50) * 50;

export interface ValuationInput {
  /** Bought price, or the birth value for one born on the farm (per head for a group). */
  entry: number;
  feed: number;
  vet: number;
  /** Latest weight, kg (per head for a group); null if never weighed. */
  weightKg: number | null;
  ageMonths: number | null;
  rate: ValuationRate;
  margin: number;
  /** Transport, commission and market fees, as a share of the market value. */
  sellingCost: number;
}

export interface Valuation {
  entry: number;
  feed: number;
  vet: number;
  /** What it has cost: bought or born value, feed and vet (rearing costs). */
  cost: number;
  /** MARKET (IAS 41 fair value from its weight at the market price) or COST (no market price: cost model). */
  basis: 'MARKET' | 'COST';
  /** Weight x market price per kg; null when not weighed or no price set. */
  marketValue: number | null;
  /** Fewer productive years left: the drop past prime age (negative). */
  ageAdjustment: number;
  /** Selling costs taken off (negative); none on the cost model. */
  sellingCosts: number;
  /** The animal's value in the books: fair value less costs to sell, or cost less the age drop. */
  value: number;
  /** A sensible asking price: its market value, and never below cost plus the margin. */
  askingPrice: number;
}

/**
 * An animal's value as an asset (IAS 41). With a market price it is its fair value: last weight x the market price per kg, less
 * the drop past prime age, less the costs to sell. With no market price it is the cost model: what it cost to buy or raise
 * (bought or born value, feed, vet) less the drop past prime age. Milk, eggs and young it produced are income, never part of it.
 */
export function valueOf(i: ValuationInput): Valuation {
  const cost = r2(i.entry + i.feed + i.vet);
  const marketValue = i.weightKg != null && i.weightKg > 0 && i.rate.pricePerKg > 0 ? r2(i.weightKg * i.rate.pricePerKg) : null;
  const basis = marketValue != null ? 'MARKET' : 'COST';
  const gross = marketValue ?? cost;
  let drop = 0;
  if (i.rate.primeAgeMonths != null && i.ageMonths != null && i.ageMonths > i.rate.primeAgeMonths) {
    drop = Math.min(MAX_AGE_DROP, i.rate.ageDropRate * ((i.ageMonths - i.rate.primeAgeMonths) / 12));
  }
  const ageAdjustment = drop > 0 ? r2(-gross * drop) : 0;
  const afterAge = gross + ageAdjustment;
  const sellingCosts = basis === 'MARKET' ? r2(-afterAge * i.sellingCost) : 0;
  return {
    entry: r2(i.entry),
    feed: r2(i.feed),
    vet: r2(i.vet),
    cost,
    basis,
    marketValue,
    ageAdjustment,
    sellingCosts,
    value: r2(afterAge + sellingCosts),
    askingPrice: round50(Math.max(afterAge, cost * (1 + i.margin))),
  };
}

/** What an animal has brought in and cost so far, with its value today: is it paying its way? */
export function profitOf(p: { income: number; offspringValue: number; value: number; cost: number }) {
  return r2(p.income + p.offspringValue + p.value - p.cost);
}

/** What is missing for a fair value: never weighed, or no feed recorded for an animal past weaning. */
export function valuationWarnings(i: { weightKg: number | null; feed: number; ageMonths: number | null; pricePerKg: number }): string[] {
  const out: string[] = [];
  if (i.weightKg == null && i.pricePerKg > 0) out.push('Not weighed: valued at cost; weigh it for its market value');
  if (i.feed === 0 && (i.ageMonths ?? 0) > 6) out.push('No feed recorded against it');
  return out;
}

/** Whole months between two days. */
export function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0));
}
