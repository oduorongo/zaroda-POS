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

export interface CommissionSplit {
  /** What the member who onboarded the business earns. */
  member: number;
  /** What the team leader earns on the same commission (0 when there is no leader or no override). */
  leader: number;
}

/**
 * How one paid commission is shared out. Both slices are fractions of the SAME commission Zaroda collected, so
 * together they can never be more than Zaroda took (the team's terms are checked to fit inside 100% when saved,
 * and this never pays out more than the commission even if they somehow did not).
 */
export function splitCommission(commission: number, memberRate: number, leaderRate: number, hasLeader: boolean): CommissionSplit {
  const member = round2(commission * memberRate);
  const leader = hasLeader ? round2(commission * leaderRate) : 0;
  const total = member + leader;
  if (total <= commission + 0.005) return { member, leader };
  // Never pay out more than was collected: scale both down to fit.
  const factor = commission / total;
  return { member: round2(member * factor), leader: round2(leader * factor) };
}
