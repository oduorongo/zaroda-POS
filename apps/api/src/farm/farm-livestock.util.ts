import { FarmCountReason, FarmSpecies } from '@prisma/client';

const DAY = 86_400_000;

/** Days from service to birth (docs/farm/01-domain-spec.md). Species not listed have no expected birth. */
export const GESTATION_DAYS: Partial<Record<FarmSpecies, number>> = { CATTLE: 283, GOAT: 150, SHEEP: 147, PIG: 114, RABBIT: 31 };
/** A cow is dried off this many days before she is due to calve. */
export const DRY_OFF_DAYS = 60;

/** Poultry are counted as birds; fish and bees count toward neither limit. */
export const POULTRY: FarmSpecies[] = ['CHICKEN', 'DUCK', 'TURKEY'];
export const NOT_COUNTED: FarmSpecies[] = ['FISH', 'BEE'];
export const limitOf = (species: FarmSpecies): 'head' | 'birds' | null => (POULTRY.includes(species) ? 'birds' : NOT_COUNTED.includes(species) ? null : 'head');

/** "2027-01-15" plus n days. Days are calendar days in East Africa. */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}
export const dayOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
export const asDate = (day: string) => new Date(`${day}T00:00:00Z`);
export const todayKey = (now: Date = new Date()) => new Date(now.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/** The day after which milk/meat/eggs may be sold again; null when the drug has no withdrawal. */
export const withdrawalUntil = (day: string, days: number): string | null => (days > 0 ? addDays(day, days) : null);

/** The latest withdrawal end of each kind still running on `today` (null = nothing blocks a sale). */
export function withdrawalState(
  events: { milkWithdrawalUntil: Date | string | null; meatWithdrawalUntil: Date | string | null; eggWithdrawalUntil: Date | string | null; voidedAt?: Date | null }[],
  today: string,
): { milkUntil: string | null; meatUntil: string | null; eggUntil: string | null } {
  const latest = (pick: (e: (typeof events)[number]) => Date | string | null) =>
    events
      .filter((e) => !e.voidedAt)
      .map((e) => pick(e))
      .filter((d): d is Date | string => !!d)
      .map(dayOf)
      .filter((d) => d > today)
      .sort()
      .pop() ?? null;
  return { milkUntil: latest((e) => e.milkWithdrawalUntil), meatUntil: latest((e) => e.meatWithdrawalUntil), eggUntil: latest((e) => e.eggWithdrawalUntil) };
}

/** Expected birth from a service or AI date; null for species without a known gestation. */
export const expectedBirth = (species: FarmSpecies, served: string): string | null => (GESTATION_DAYS[species] ? addDays(served, GESTATION_DAYS[species]!) : null);

/** When a programme is next due for an animal or group: after the last dose, else at the first age, never in the past. */
export function nextDue(p: { firstAgeDays: number | null; intervalDays: number }, t: { born: string | null; lastDone: string | null }, today: string): string {
  if (t.lastDone) return addDays(t.lastDone, p.intervalDays);
  if (p.firstAgeDays !== null && t.born) {
    const first = addDays(t.born, p.firstAgeDays);
    return first > today ? first : today;
  }
  return today;
}

/** How a head-count change moves the count: in for placements, births and purchases; out otherwise; adjustments as given. */
export function signedChange(reason: FarmCountReason, count: number): number {
  if (reason === 'ADJUSTED') return count;
  const n = Math.abs(count);
  return reason === 'PLACED' || reason === 'BORN' || reason === 'BOUGHT' ? n : -n;
}

/** Age in whole months, for showing "4 yr 2 mo". */
export function ageText(born: string | null, today: string): string {
  if (!born) return '';
  const [by, bm, bd] = born.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0);
  if (months < 0) months = 0;
  if (months < 1) return `${Math.max(0, Math.round((Date.parse(today) - Date.parse(born)) / DAY))} days`;
  const y = Math.floor(months / 12);
  const m = months % 12;
  return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
}
