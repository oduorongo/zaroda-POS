// Seasonal (school-term) billing: plain functions on days ("2026-01-15") and whole shillings.

export interface TermRule {
  term: number;
  label: string;
  shareRate: number;
  dueMonth: number;
  dueDay: number;
  graceDays: number;
  fromMonth: number;
  toMonth: number;
}

export interface SeasonalRules {
  terms: TermRule[];
  minFirstPaymentKes: number;
  setupFeeKes: number;
  payInFullDiscountRate: number;
  payInFullUntilMonth: number;
}

export interface PlannedInstalment {
  schoolYear: number;
  /** 0 = the setup fee of a business joining when no term is running (Nov-Dec). */
  term: number;
  amount: number;
  dueDate: string;
  graceDays: number;
}

export type ReminderKind = 'BEFORE_DUE' | 'DUE' | 'BEFORE_LOCK';

const DAY = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
export const day = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const later = (a: string, b: string) => (a > b ? a : b);
const byTerm = (terms: TermRule[]) => [...terms].sort((a, b) => a.term - b.term);

/** Every term of a school year at its default due date, its share of the annual price in whole shillings. */
export function yearSchedule(year: number, annualKes: number, terms: TermRule[]): PlannedInstalment[] {
  return byTerm(terms).map((t) => ({
    schoolYear: year,
    term: t.term,
    amount: Math.round(annualKes * t.shareRate),
    dueDate: day(year, t.dueMonth, t.dueDay),
    graceDays: t.graceDays,
  }));
}

/**
 * What a business joining today is charged: the term running now (or the next one this year) and the rest of the school year,
 * whole terms only. Joining when no term is left this year (Nov-Dec): nothing now but the setup fee, if any; the first
 * instalment is next January's Term 1. Nothing is due before today, and the first term instalment is at least the minimum.
 */
export function signupSchedule(today: string, annualKes: number, rules: SeasonalRules): PlannedInstalment[] {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const terms = byTerm(rules.terms);
  const from = terms.find((t) => month >= t.fromMonth && month <= t.toMonth) ?? terms.find((t) => t.fromMonth > month);
  const list: PlannedInstalment[] = from
    ? yearSchedule(year, annualKes, terms).filter((i) => i.term >= from.term)
    : [
        ...(rules.setupFeeKes > 0 ? [{ schoolYear: year + 1, term: 0, amount: Math.round(rules.setupFeeKes), dueDate: today, graceDays: terms[0]?.graceDays ?? 30 }] : []),
        ...yearSchedule(year + 1, annualKes, terms),
      ];
  const first = list.find((i) => i.term > 0);
  return list.map((i) => ({
    ...i,
    dueDate: later(i.dueDate, today),
    amount: i === first ? Math.max(i.amount, Math.round(rules.minFirstPaymentKes)) : i.amount,
  }));
}

/** Paying the whole school year at once: only up to the end of payInFullUntilMonth of that year, and only while nothing of it is paid. */
export function payInFull(
  instalments: { schoolYear: number; term: number; amount: number; status: string }[],
  schoolYear: number,
  today: string,
  rules: Pick<SeasonalRules, 'payInFullDiscountRate' | 'payInFullUntilMonth'>,
): { available: boolean; full: number; discount: number; amount: number } {
  const year = instalments.filter((i) => i.schoolYear === schoolYear && i.term > 0);
  const full = year.reduce((t, i) => t + i.amount, 0);
  const available =
    year.length > 0 &&
    year.every((i) => i.status === 'DUE') &&
    Number(today.slice(0, 4)) === schoolYear &&
    Number(today.slice(5, 7)) <= rules.payInFullUntilMonth;
  const amount = Math.round(full * (1 - rules.payInFullDiscountRate));
  return { available, full, discount: full - amount, amount };
}

/**
 * The subscription's "paid until" for a seasonal plan: the end of the oldest unpaid instalment's due day, with its grace. With nothing
 * unpaid, the next school year's Term 1 due date. Read-only once that and the grace days have passed (see effectiveStatus).
 */
export function paidUntil(open: { dueDate: string; graceDays: number }[], today: string, terms: TermRule[]): { periodEnd: Date; graceDays: number } {
  const oldest = [...open].sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (oldest) return { periodEnd: endOfNairobiDay(oldest.dueDate), graceDays: oldest.graceDays };
  const t1 = byTerm(terms)[0];
  const year = Number(today.slice(0, 4)) + 1;
  return { periodEnd: endOfNairobiDay(t1 ? day(year, t1.dueMonth, t1.dueDay) : day(year, 1, 15)), graceDays: t1?.graceDays ?? 30 };
}

/** 23:59:59 in Nairobi (UTC+3) on that day. */
export const endOfNairobiDay = (d: string) => new Date(Date.parse(`${d}T23:59:59+03:00`));

/** The reminder text due today for an unpaid instalment, if any: 7 days before, on the day, 7 days before the account locks. Up to 2 days late (a missed run). */
export function reminderFor(i: { dueDate: string; graceDays: number; reminders: string[] }, today: string): ReminderKind | null {
  const points: [ReminderKind, string][] = [
    ['BEFORE_LOCK', addDays(i.dueDate, i.graceDays - 7)],
    ['DUE', i.dueDate],
    ['BEFORE_DUE', addDays(i.dueDate, -7)],
  ];
  for (const [kind, on] of points) {
    if (today >= on && today <= addDays(on, 2)) return i.reminders.includes(kind) ? null : kind;
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const shortDay = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

export function reminderText(kind: ReminderKind, i: { label: string; amount: number; dueDate: string; graceDays: number }, payHow: string): string {
  const what = `Your ${i.label} instalment of KES ${i.amount.toLocaleString('en-KE')}`;
  const body =
    kind === 'BEFORE_LOCK'
      ? `${what} is overdue. Pay by ${shortDay(addDays(i.dueDate, i.graceDays))} to keep making sales; after that the account is read-only until paid (nothing is deleted).`
      : kind === 'DUE'
        ? `${what} is due today.`
        : `${what} is due ${shortDay(i.dueDate)}.`;
  return `ZARODA POS: ${body} ${payHow}`;
}
