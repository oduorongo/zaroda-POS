import { addDays } from './farm-livestock.util';

/** Common harvest units in Kenya and their kg; anything else needs kg per unit typed in. */
export const HARVEST_UNITS: Record<string, number> = { kg: 1, 'bag (90 kg)': 90, 'bag (50 kg)': 50, tonne: 1000, crate: 0, bunch: 0, piece: 0 };

/** kg per unit for a harvest: the one typed in, else the unit's usual weight; null when neither is known. */
export function kgPerUnitFor(unit: string, typed?: number | null): number | null {
  if (typed && typed > 0) return typed;
  const known = HARVEST_UNITS[unit.trim().toLowerCase()];
  return known ? known : null;
}

/** The first day harvest is allowed after a spray: spray day plus the label's pre-harvest interval. null when there is none. */
export const safeHarvestFrom = (sprayDay: string, preHarvestDays: number | null | undefined): string | null =>
  preHarvestDays && preHarvestDays > 0 ? addDays(sprayDay, preHarvestDays) : null;

/** The latest safe-harvest day among a season's sprays (voided ones ignored); harvest before it is refused. */
export function blockedUntil(sprays: { safeHarvestFrom: string | null; voided?: boolean }[]): string | null {
  return sprays.filter((s) => !s.voided && s.safeHarvestFrom).map((s) => s.safeHarvestFrom!).sort().pop() ?? null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface SeasonFigures {
  harvestedKg: number;
  inputCost: number;
  labourCost: number;
  totalCost: number;
  kgPerAcre: number | null;
  costPerAcre: number | null;
  costPerKg: number | null;
}

/** Yield and cost per acre and per kg, from the season's acres, field work and harvests (voided rows left out). */
export function seasonFigures(
  acres: number,
  activities: { inputCost: number; labourCost: number; voided?: boolean }[],
  harvests: { kg: number; voided?: boolean }[],
): SeasonFigures {
  const live = activities.filter((a) => !a.voided);
  const inputCost = r2(live.reduce((s, a) => s + a.inputCost, 0));
  const labourCost = r2(live.reduce((s, a) => s + a.labourCost, 0));
  const totalCost = r2(inputCost + labourCost);
  const harvestedKg = Math.round(harvests.filter((h) => !h.voided).reduce((s, h) => s + h.kg, 0) * 1000) / 1000;
  return {
    harvestedKg,
    inputCost,
    labourCost,
    totalCost,
    kgPerAcre: acres > 0 ? r2(harvestedKg / acres) : null,
    costPerAcre: acres > 0 ? r2(totalCost / acres) : null,
    costPerKg: harvestedKg > 0 ? r2(totalCost / harvestedKg) : null,
  };
}
