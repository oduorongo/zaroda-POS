import { parseDay, todayInKenya } from '../hotel/room-availability.util';

/** Pure rules for table reservations: what can be asked for, and when two reservations get in each other's way. */

export const MAX_PARTY_SIZE = 30;
/** How far ahead a table can be requested. */
export const MAX_DAYS_AHEAD = 60;
/** A request for today needs at least this much notice. */
export const MIN_NOTICE_MINUTES = 30;
/** Open (not yet answered or still upcoming) requests one phone number may have, so the form cannot be used to spam. */
export const MAX_OPEN_PER_PHONE = 3;
/** How long a party is assumed to keep its table: two reservations closer together than this clash on the same table. */
export const SITTING_MINUTES = 120;

const DAY_MS = 86_400_000;

/** "19:30" -> minutes after midnight, or null if it is not a real time. */
export function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Minutes since midnight in Kenya right now. */
export function nowMinutesInKenya(now: Date = new Date()): number {
  const local = new Date(now.getTime() + 3 * 3_600_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** A message if the request is not acceptable, otherwise null. */
export function reservationProblem(input: { date: unknown; time: unknown; partySize: number }, now: Date = new Date()): string | null {
  const date = parseDay(input.date);
  if (!date) return 'Choose the date you would like the table for';
  const minutes = parseTime(input.time);
  if (minutes === null) return 'Choose the time, for example 19:30';
  if (!Number.isInteger(input.partySize) || input.partySize < 1 || input.partySize > MAX_PARTY_SIZE) return `A table can be requested for 1 to ${MAX_PARTY_SIZE} people - call the restaurant for larger groups`;
  const today = todayInKenya(now);
  if (date.getTime() < today.getTime()) return 'That date has already passed';
  if (date.getTime() > today.getTime() + MAX_DAYS_AHEAD * DAY_MS) return `Tables can be requested up to ${MAX_DAYS_AHEAD} days ahead`;
  if (date.getTime() === today.getTime() && minutes < nowMinutesInKenya(now) + MIN_NOTICE_MINUTES) return `For today, please ask at least ${MIN_NOTICE_MINUTES} minutes ahead - or call the restaurant`;
  return null;
}

/** Whether two bookings of the same table on the same date are too close together (a party is assumed to stay SITTING_MINUTES). */
export function timesClash(a: string, b: string): boolean {
  const x = parseTime(a);
  const y = parseTime(b);
  return x !== null && y !== null && Math.abs(x - y) < SITTING_MINUTES;
}
