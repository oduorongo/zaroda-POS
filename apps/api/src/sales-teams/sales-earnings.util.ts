/** Pure money and date helpers for the teams' earnings ledger. */

/** Kenyan shillings to two decimal places, without floating-point dust (1.005 -> 1.01). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** "2026-10" for a moment, in Nairobi time (UTC+3 all year) - the month a payment counts in. */
export function nairobiMonth(date: Date): string {
  const shifted = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isMonth = (value: unknown): value is string => typeof value === 'string' && MONTH_PATTERN.test(value);

/** `n` calendar months after `date` (a shop signed up on 31 Jan is 1 month old on the last day of February). */
export function addMonths(date: Date, n: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + n);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Whether money received at `earnedAt` is still inside the shop's earning window (`earningMonths` after sign-up). */
export const withinEarningWindow = (signedUpAt: Date, earnedAt: Date, earningMonths: number): boolean =>
  earnedAt.getTime() <= addMonths(signedUpAt, earningMonths).getTime();

/** The first moment AFTER a month ("2026-10") in Nairobi time, i.e. 00:00 on the 1st of the next month, as a UTC instant. */
export function monthEnd(periodMonth: string): Date {
  const [year, month] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1) - 3 * 60 * 60 * 1000);
}

/** Earnings stay pending for `holdDays` after their month ends; this is the moment they become payable. */
export const payableFrom = (periodMonth: string, holdDays: number): Date => new Date(monthEnd(periodMonth).getTime() + holdDays * 24 * 60 * 60 * 1000);

/**
 * The payout cap: member + leader together may earn at most `headroom` (the cap share of Zaroda's revenue from one
 * shop in one month, less what they already earned from it). If they would earn more, both are reduced in proportion.
 */
export function applyCap(member: number, leader: number, headroom: number): { member: number; leader: number; capped: boolean } {
  const total = member + leader;
  const room = Math.max(0, headroom);
  if (total <= room + 0.005) return { member, leader, capped: false };
  const factor = total === 0 ? 0 : room / total;
  return { member: round2(member * factor), leader: round2(leader * factor), capped: true };
}

/** Withholding tax taken from a payout: the person receives `net`, Zaroda remits `tax`. */
export function withholdTax(gross: number, rate: number): { tax: number; net: number } {
  const tax = rate > 0 ? round2(gross * rate) : 0;
  return { tax, net: round2(gross - tax) };
}

/** A refund of `refundedBase` out of an earlier `originalBase` reverses that fraction of an earning (a negative amount). */
export function adjustmentAmount(originalAmount: number, originalBase: number, refundedBase: number): number {
  if (originalBase <= 0) return 0;
  const fraction = Math.min(1, Math.max(0, refundedBase / originalBase));
  return -round2(originalAmount * fraction);
}
