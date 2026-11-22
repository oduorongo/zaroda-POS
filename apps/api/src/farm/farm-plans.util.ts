import { FarmPlan, FarmSubscriptionStatus, Prisma } from '@prisma/client';

const DAY = 86_400_000;

/** Plan features (docs/farm/05-pricing-plans.md). */
export const FARM_FEATURES = {
  layout: 'Farm layout and enterprises',
  livestock: 'Animals, groups, health and breeding',
  production: 'Milk and egg records',
  crops: 'Crops',
  sales_cash: 'Selling produce',
  reports_basic: 'Basic reports',
  programmes: 'Vaccination programmes and SMS reminders',
  feed: 'Feed production',
  sales_credit: 'Credit buyers and statements',
  labour: 'Casual workers and M-Pesa wages',
  reports_full: 'Full reports and downloads',
  ledger: 'Accounts (general ledger)',
  multi_site: 'Several farm sites',
  enterprise: 'Custom roles, API and co-op member farms',
} as const;
export type FarmFeatureKey = keyof typeof FARM_FEATURES;

/** What a plan allows; null = unlimited. */
export interface FarmLimits {
  head: number | null;
  birds: number | null;
  acres: number | null;
  users: number | null;
}
export type FarmLimitKey = keyof FarmLimits;
export const LIMIT_LABELS: Record<FarmLimitKey, string> = { head: 'livestock head', birds: 'birds', acres: 'acres', users: 'users' };

export interface FarmPlanLike {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  quoteOnly: boolean;
  limits: FarmLimits;
  features: string[];
  sortOrder: number;
}

export const TRIAL_PLAN = 'FARM_FARMER';
export const TRIAL_DAYS = 14;
export const FALLBACK_PLAN = 'FARM_KIENYEJI';

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function parseLimits(raw: Prisma.JsonValue): FarmLimits {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { head: num(o.head), birds: num(o.birds), acres: num(o.acres), users: num(o.users) };
}

export const parseFeatures = (raw: Prisma.JsonValue): string[] => (Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : []);

export const toPlan = (p: FarmPlan): FarmPlanLike => ({
  code: p.code,
  name: p.name,
  monthlyPrice: Number(p.monthlyPrice),
  annualPrice: p.annualPrice === null ? null : Number(p.annualPrice),
  quoteOnly: p.quoteOnly,
  limits: parseLimits(p.limits),
  features: parseFeatures(p.features),
  sortOrder: p.sortOrder,
});

/** The status right now: a trial or paid period runs to currentPeriodEnd, then the grace days, then the farm is read-only. */
export function subscriptionStatus(sub: { status: FarmSubscriptionStatus; currentPeriodEnd: Date; graceDays: number }, now: Date = new Date()): FarmSubscriptionStatus {
  if (sub.status === 'CANCELLED' || sub.status === 'SUSPENDED') return sub.status;
  if (now <= sub.currentPeriodEnd) return sub.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
  if (now.getTime() <= sub.currentPeriodEnd.getTime() + sub.graceDays * DAY) return 'GRACE';
  return 'SUSPENDED';
}

export const isReadOnly = (status: FarmSubscriptionStatus) => status === 'SUSPENDED' || status === 'CANCELLED';

export function cheapestWith(plans: FarmPlanLike[], test: (p: FarmPlanLike) => boolean): FarmPlanLike | undefined {
  return [...plans].sort((a, b) => a.sortOrder - b.sortOrder).find(test);
}

/** Why adding `extra` of a limit would go over the plan, with the cheapest plan that fits, or null when it fits. */
export function limitProblem(
  plan: FarmPlanLike,
  plans: FarmPlanLike[],
  key: FarmLimitKey,
  used: number,
  extra: number,
): { message: string; requiredPlan: string | null } | null {
  const cap = plan.limits[key];
  if (cap === null || used + extra <= cap) return null;
  const fits = cheapestWith(plans, (p) => p.limits[key] === null || (p.limits[key] as number) >= used + extra);
  const amount = Number.isInteger(cap) ? cap.toLocaleString('en-KE') : cap.toFixed(1);
  return {
    message: `Your ${plan.name} plan allows ${amount} ${LIMIT_LABELS[key]}.${fits ? ` Upgrade to ${fits.name} to add more.` : ''}`,
    requiredPlan: fits?.code ?? null,
  };
}
