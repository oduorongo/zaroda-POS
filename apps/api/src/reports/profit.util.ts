// Calendar maths for the profit report. Everything is in Nairobi time (UTC+3, no daylight saving): "today" and "this week"
// mean the days a shop keeper lives, not UTC days. Weeks run Monday to Sunday.

export type GroupBy = 'day' | 'week' | 'month';

export const MAX_RANGE_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDay(day: string): boolean {
  if (!DAY_PATTERN.test(day)) return false;
  const d = new Date(`${day}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

/** The Nairobi calendar day, "2026-10-21", an instant falls in. */
export function nairobiDayOf(instant: Date): string {
  return new Date(instant.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** The instant a Nairobi day begins (midnight there). */
export function dayStart(day: string): Date {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - NAIROBI_OFFSET_MS);
}

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) / DAY_MS);
}

/** The Monday of the week a day is in. */
export function weekStartOf(day: string): string {
  const dow = new Date(`${day}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Which bucket a day belongs to: the day itself, its week's Monday, or "2026-10". */
export function bucketKey(day: string, groupBy: GroupBy): string {
  if (groupBy === 'day') return day;
  if (groupBy === 'week') return weekStartOf(day);
  return day.slice(0, 7);
}

/** Every bucket from `from` to `to` in order, so a quiet day or week still shows as a row of zeros. */
export function listBuckets(from: string, to: string, groupBy: GroupBy): string[] {
  const keys: string[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const key = bucketKey(day, groupBy);
    if (keys[keys.length - 1] !== key) keys.push(key);
  }
  return keys;
}

/** A plain-words reason the range cannot be used, or null. */
export function rangeProblem(from: string, to: string): string | null {
  if (!isValidDay(from) || !isValidDay(to)) return 'Choose a start and an end date';
  if (to < from) return 'The end date is before the start date';
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) return 'Choose a period of up to a year at a time';
  return null;
}

/** Day buckets for up to 2 months, weeks for up to about 6 months, otherwise months. */
export function defaultGroupBy(from: string, to: string): GroupBy {
  const days = daysBetween(from, to) + 1;
  if (days <= 62) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}
