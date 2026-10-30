import { ConBillingCycle, ConSubscriptionStatus } from '@prisma/client';

export const CON_FEATURES = {
  compliance: 'Compliance vault',
  projects: 'Projects, BQ and site diary',
  labour: 'Workers and muster roll',
  safety: 'Safety registers',
  tenders: 'Tenders register',
  procurement: 'Requisitions, LPOs and site stock',
  approval_limits: 'Approval limits',
  commercial: 'Valuations, IPCs and variations',
  etims: 'eTIMS invoicing of IPCs',
  payroll: 'Labour payroll and M-Pesa payouts',
  portal: 'Client and consultant portal',
  subcontracts: 'Subcontract accounts',
  plant: 'Plant and fuel',
  full_reports: 'Full reports and exports',
  multi_branch: 'Multi-branch',
  custom_roles: 'Custom roles',
  api: 'API access',
  extra_projects: 'Extra projects (KES 1,500/month each)',
} as const;
export type ConFeatureKey = keyof typeof CON_FEATURES;

export type LimitKey = 'activeProjects' | 'workers' | 'users';
export const LIMIT_LABELS: Record<LimitKey, string> = { activeProjects: 'active projects', workers: 'workers', users: 'staff users' };
export type Limits = Record<LimitKey, number | null>;

export interface PlanLike {
  code: string;
  name: string;
  monthlyPrice: number;
  annualPrice: number | null;
  quoteOnly: boolean;
  setupFee: number | null;
  setupFeeOptional: boolean;
  limits: Limits;
  features: string[];
  sortOrder: number;
}

export function parseLimits(raw: unknown): Limits {
  const o = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' ? v : null);
  return { activeProjects: n(o.activeProjects), workers: n(o.workers), users: n(o.users) };
}

export const parseFeatures = (raw: unknown): string[] => (Array.isArray(raw) ? raw.filter((f): f is string => typeof f === 'string') : []);

const DAY = 86_400_000;

/** TRIAL/ACTIVE until the period ends, then GRACE for graceDays (full access + banner), then SUSPENDED (read-only). */
export function subscriptionStatus(
  sub: { status: ConSubscriptionStatus; currentPeriodEnd: Date; graceDays: number },
  now: Date = new Date(),
): ConSubscriptionStatus {
  if (sub.status === 'CANCELLED' || sub.status === 'SUSPENDED') return sub.status;
  if (now <= sub.currentPeriodEnd) return sub.status === 'TRIAL' ? 'TRIAL' : 'ACTIVE';
  if (now.getTime() <= sub.currentPeriodEnd.getTime() + sub.graceDays * DAY) return 'GRACE';
  return 'SUSPENDED';
}

export const isReadOnly = (status: ConSubscriptionStatus) => status === 'SUSPENDED' || status === 'CANCELLED';

export const cycleMonths = (cycle: ConBillingCycle) => (cycle === 'ANNUAL' ? 12 : 1);

export interface Quote {
  months: number;
  gross: number;
  discount: number;
  amount: number;
  couponMonthsUsed: number;
}

/** What one payment costs. A coupon takes percentOff off up to couponMonths of the months being paid for. */
export function quote(plan: PlanLike, cycle: ConBillingCycle, coupon?: { percentOff: number; monthsLeft: number }): Quote {
  if (plan.quoteOnly) throw new Error(`${plan.name} is priced by quote - contact ZARODA`);
  const months = cycleMonths(cycle);
  const gross = cycle === 'ANNUAL' ? plan.annualPrice ?? plan.monthlyPrice * 12 : plan.monthlyPrice;
  const couponMonthsUsed = coupon ? Math.min(Math.max(coupon.monthsLeft, 0), months) : 0;
  const discount = coupon ? Math.round((gross / months) * couponMonthsUsed * (coupon.percentOff / 100)) : 0;
  return { months, gross, discount, amount: gross - discount, couponMonthsUsed };
}

export function addMonths(d: Date, months: number): Date {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
}

/** A payment extends from the current end if it is still ahead, otherwise from now. */
export const extendPeriod = (currentEnd: Date, months: number, now: Date = new Date()) => addMonths(currentEnd > now ? currentEnd : now, months);

export const withinLimit = (limit: number | null, current: number) => limit === null || current < limit;

/** Why usage does not fit a plan's limits (empty = fits). */
export function downgradeProblems(usage: Record<LimitKey, number>, limits: Limits): string[] {
  return (Object.keys(LIMIT_LABELS) as LimitKey[])
    .filter((k) => limits[k] !== null && usage[k] > (limits[k] as number))
    .map((k) => `You have ${usage[k]} ${LIMIT_LABELS[k]}; this plan allows ${limits[k]}`);
}

export function cheapestWith(plans: PlanLike[], feature: string): PlanLike | undefined {
  return [...plans].sort((a, b) => a.sortOrder - b.sortOrder).find((p) => p.features.includes(feature));
}

export function nextPlanUp(plans: PlanLike[], current: string): PlanLike | undefined {
  const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
  const i = sorted.findIndex((p) => p.code === current);
  return i >= 0 ? sorted[i + 1] : undefined;
}

/** Going over a limit: extra projects only where the plan sells them (not Mjengo - two Mjengo sites cost about a Fundi), else upgrade. */
export function limitMessage(plan: PlanLike, plans: PlanLike[], kind: LimitKey, limit: number | null, extraProjectPrice: number): string {
  const up = nextPlanUp(plans, plan.code);
  const upgrade = up ? `upgrade to ${up.name}` : 'contact ZARODA';
  const extra = kind === 'activeProjects' && plan.features.includes('extra_projects');
  const how = extra ? `Add an extra project for KES ${extraProjectPrice.toLocaleString('en-KE')}/month, or ${upgrade}` : upgrade.charAt(0).toUpperCase() + upgrade.slice(1);
  const label = limit === 1 ? LIMIT_LABELS[kind].replace(/s$/, '') : LIMIT_LABELS[kind];
  return `Your ${plan.name} plan allows ${limit} ${label}. ${how} to add more.`;
}
