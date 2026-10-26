// The cash-flow forecast: money expected in and out over the next 13 weeks, week by week, and where cash runs low. Plain functions,
// tested without a database. Every figure comes from a line that can be traced back to an invoice, bill or planned item.

import { addDays, daysBetween } from './school-money.util';
import { fromCents, toCents } from './school-money.util';

export const WEEKS = 13;

export interface Scenario {
  /** The share of what is expected in that actually arrives (0-100). */
  collectPercent: number;
  /** Extra days schools take to pay beyond when it was expected. */
  delayDays: number;
}

export function scenarioProblem(s: Scenario): string | null {
  if (!(s.collectPercent >= 0 && s.collectPercent <= 100))
    return 'The share collected must be between 0 and 100';
  if (!(Number.isInteger(s.delayDays) && s.delayDays >= 0 && s.delayDays <= 180))
    return 'The extra days to pay must be a whole number from 0 to 180';
  return null;
}

/** The share of a receipt expected to arrive in this scenario, to the cent. */
export const scaled = (amount: number, percent: number): number =>
  fromCents(Math.round((toCents(amount) * percent) / 100));

/** When a receipt is now expected: the date plus any delay, and never in the past (money late now is counted today). */
export function receiptDate(expected: string, today: string, delayDays: number): string {
  const d = addDays(expected, delayDays);
  return d < today ? today : d;
}

export interface FlowLine {
  /** What kind of thing it is: INVOICE, RETENTION, ORDER, BILL or PLANNED. */
  source: string;
  /** The document or item it comes from, to find it again. */
  ref: string;
  label: string;
  amount: number;
  /** The day it is expected (already adjusted for the scenario). */
  date: string;
  note?: string | null;
}

/** Which week (0 = this week, from today) a day falls in; null when it is beyond the forecast. A day in the past counts as this week. */
export function weekIndex(date: string, today: string): number | null {
  if (date <= today) return 0;
  const w = Math.floor(daysBetween(today, date) / 7);
  return w < WEEKS ? w : null;
}

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** The same day-of-month some months on, kept inside the month (the 31st becomes the 30th, or the 28th). */
export function addMonths(day: string, months: number, anchorDay: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  const total = d.getUTCFullYear() * 12 + d.getUTCMonth() + months;
  const y = Math.floor(total / 12);
  const m = total % 12;
  const dd = Math.min(anchorDay, lastDayOfMonth(y, m));
  return new Date(Date.UTC(y, m, dd)).toISOString().slice(0, 10);
}

export type Repeat = 'NONE' | 'WEEKLY' | 'MONTHLY';

/** The days a planned item falls on between today and the end of the forecast. */
export function occurrences(
  item: { date: string; repeat: Repeat; repeatUntil: string | null },
  today: string,
  horizonEnd: string,
): string[] {
  const last = item.repeatUntil && item.repeatUntil < horizonEnd ? item.repeatUntil : horizonEnd;
  const out: string[] = [];
  if (item.repeat === 'NONE') {
    if (item.date >= today && item.date <= horizonEnd) out.push(item.date);
    return out;
  }
  const anchor = Number(item.date.slice(8, 10));
  for (let i = 0; i < 400; i++) {
    const d = item.repeat === 'WEEKLY' ? addDays(item.date, 7 * i) : addMonths(item.date, i, anchor);
    if (d > last) break;
    if (d >= today) out.push(d);
  }
  return out;
}

/** The last day the forecast covers. */
export const horizonEnd = (today: string): string => addDays(today, WEEKS * 7 - 1);

export function buildForecast(m: {
  today: string;
  opening: number;
  minimum: number;
  inflows: FlowLine[];
  outflows: FlowLine[];
}) {
  let running = toCents(m.opening);
  const min = toCents(m.minimum);
  const later = { inflow: 0, outflow: 0 };
  const weeks = Array.from({ length: WEEKS }, (_, i) => ({
    index: i + 1,
    start: addDays(m.today, i * 7),
    end: addDays(m.today, i * 7 + 6),
    inflow: 0,
    outflow: 0,
    net: 0,
    opening: 0,
    closing: 0,
    belowMinimum: false,
    inflows: [] as FlowLine[],
    outflows: [] as FlowLine[],
  }));
  const place = (lines: FlowLine[], side: 'inflows' | 'outflows') => {
    for (const l of lines) {
      const w = weekIndex(l.date, m.today);
      if (w === null) {
        if (side === 'inflows') later.inflow += toCents(l.amount);
        else later.outflow += toCents(l.amount);
        continue;
      }
      weeks[w][side].push(l);
    }
  };
  place(m.inflows, 'inflows');
  place(m.outflows, 'outflows');
  let lowest = { week: 1, closing: running };
  let firstBelowMinimum: number | null = null;
  let totalIn = 0;
  let totalOut = 0;
  weeks.forEach((w, i) => {
    const inC = w.inflows.reduce((s, l) => s + toCents(l.amount), 0);
    const outC = w.outflows.reduce((s, l) => s + toCents(l.amount), 0);
    w.opening = fromCents(running);
    running += inC - outC;
    w.inflow = fromCents(inC);
    w.outflow = fromCents(outC);
    w.net = fromCents(inC - outC);
    w.closing = fromCents(running);
    w.belowMinimum = running < min;
    totalIn += inC;
    totalOut += outC;
    if (i === 0 || running < toCents(lowest.closing)) lowest = { week: w.index, closing: fromCents(running) };
    if (w.belowMinimum && firstBelowMinimum === null) firstBelowMinimum = w.index;
  });
  return {
    weeks,
    totalIn: fromCents(totalIn),
    totalOut: fromCents(totalOut),
    closing: fromCents(running),
    lowest,
    firstBelowMinimum,
    later: { inflow: fromCents(later.inflow), outflow: fromCents(later.outflow) },
  };
}
