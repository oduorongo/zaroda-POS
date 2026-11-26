import { FarmSpecies } from '@prisma/client';

/** What the farmer sets per animal type. Starting values only: every farm edits them to its local market. */
export interface ValuationRate {
  /** What an animal born on the farm is worth at birth (KES). */
  birthValue: number;
  /** Market price per kg live weight (KES). */
  pricePerKg: number;
  /** Past this age the price starts to drop; null = age never lowers it. */
  primeAgeMonths: number | null;
  /** How much the price drops for each year past prime age (0.15 = 15%). */
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
export const DEFAULT_PRODUCTION_DAYS = 90;

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
  /** Average milk (litres) or good eggs a day over the last 30 days, and what one sells for. */
  dailyProduce: number;
  producePrice: number;
  ageMonths: number | null;
  rate: ValuationRate;
  margin: number;
  productionDays: number;
}

export interface Valuation {
  entry: number;
  feed: number;
  vet: number;
  cost: number;
  costPrice: number;
  weightValue: number | null;
  productionValue: number;
  ageAdjustment: number;
  suggested: number;
  basis: 'COST' | 'WEIGHT';
}

/**
 * The suggested selling price: the higher of cost to date plus the margin and live weight x the market price, plus the
 * value of what it produces (recent daily milk or eggs x price x the production days). Past prime age the price drops by
 * the yearly rate, but never below its weight (meat) value.
 */
export function valueOf(i: ValuationInput): Valuation {
  const cost = r2(i.entry + i.feed + i.vet);
  const costPrice = r2(cost * (1 + i.margin));
  const weightValue = i.weightKg != null && i.rate.pricePerKg > 0 ? r2(i.weightKg * i.rate.pricePerKg) : null;
  const productionValue = r2(Math.max(0, i.dailyProduce) * Math.max(0, i.producePrice) * Math.max(0, i.productionDays));
  const basis = weightValue != null && weightValue > costPrice ? 'WEIGHT' : 'COST';
  const base = Math.max(costPrice, weightValue ?? 0) + productionValue;
  let price = base;
  if (i.rate.primeAgeMonths != null && i.ageMonths != null && i.ageMonths > i.rate.primeAgeMonths) {
    const yearsPast = (i.ageMonths - i.rate.primeAgeMonths) / 12;
    price = Math.max(base * Math.max(0, 1 - i.rate.ageDropRate * yearsPast), weightValue ?? 0);
  }
  return { entry: r2(i.entry), feed: r2(i.feed), vet: r2(i.vet), cost, costPrice, weightValue, productionValue, ageAdjustment: r2(price - base), suggested: round50(price), basis };
}

/** What is missing for a fair price: never weighed, or no feed recorded for an animal past weaning. */
export function valuationWarnings(i: { weightKg: number | null; feed: number; ageMonths: number | null; pricePerKg: number }): string[] {
  const out: string[] = [];
  if (i.weightKg == null && i.pricePerKg > 0) out.push('Not weighed: weigh it for a fairer price');
  if (i.feed === 0 && (i.ageMonths ?? 0) > 6) out.push('No feed recorded against it');
  return out;
}

/** Whole months between two days. */
export function monthsBetween(from: Date, to: Date): number {
  return Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) - (to.getUTCDate() < from.getUTCDate() ? 1 : 0));
}
