import { FarmPlanLike } from './farm-plans.util';

const DAY = 86_400_000;

export type FarmCycle = 'MONTHLY' | 'ANNUAL';

/** What a plan costs for a cycle: the annual price (or 12 months) for a year, the monthly price otherwise. */
export function planPrice(plan: FarmPlanLike, cycle: FarmCycle): { amount: number; months: number } {
  if (cycle === 'ANNUAL') return { amount: Math.round(plan.annualPrice ?? plan.monthlyPrice * 12), months: 12 };
  return { amount: Math.round(plan.monthlyPrice), months: 1 };
}

/** A paid period runs on from the current end when the plan is still paid up, else from now. */
export function extendPeriod(currentEnd: Date, months: number, now: Date = new Date()): Date {
  const from = currentEnd > now ? new Date(currentEnd) : new Date(now);
  from.setUTCMonth(from.getUTCMonth() + months);
  return from;
}

/** The free plan never runs out: it is "paid" ten years ahead. */
export const freePeriodEnd = (now: Date = new Date()) => new Date(now.getTime() + 3650 * DAY);

/** What no longer fits when moving to a plan, e.g. "12 acres (the plan allows 10)". */
export function downgradeProblems(usage: Record<string, number>, plan: FarmPlanLike): string[] {
  const labels: Record<string, string> = { head: 'livestock head', birds: 'birds', acres: 'acres', users: 'users with a farm role' };
  return (Object.keys(plan.limits) as (keyof FarmPlanLike['limits'])[])
    .filter((k) => plan.limits[k] !== null && (usage[k] ?? 0) > (plan.limits[k] as number))
    .map((k) => `${usage[k]} ${labels[k]} (the plan allows ${plan.limits[k]})`);
}

/** Monthly recurring revenue of a paying farm: the annual price spread over 12 months for a yearly plan. */
export function farmMrr(plan: FarmPlanLike, cycle: string): number {
  return cycle === 'ANNUAL' ? (plan.annualPrice ?? plan.monthlyPrice * 12) / 12 : plan.monthlyPrice;
}
