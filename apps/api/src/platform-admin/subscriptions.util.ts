/** READ_ONLY: a seasonal (school-term) plan past its grace days - the business can still sign in and look, but not sell or change stock. */
export type EffectiveStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'READ_ONLY';

interface SubscriptionLike {
  currentPeriodEnd: Date;
  graceDays: number;
  isTrial: boolean;
  manuallySuspended: boolean;
  plan?: { billingCycle: string } | null;
}

/**
 * Computed at read time, never stored - see Subscription's schema comment
 * for why (avoids a cron job just to keep a status column truthful; the
 * three inputs here are cheap to re-derive from on every read).
 */
export function effectiveStatus(sub: SubscriptionLike, now: Date = new Date()): EffectiveStatus {
  if (sub.manuallySuspended) return 'SUSPENDED';
  const graceEnd = new Date(sub.currentPeriodEnd.getTime() + sub.graceDays * 24 * 60 * 60 * 1000);
  if (now <= sub.currentPeriodEnd) return sub.isTrial ? 'TRIAL' : 'ACTIVE';
  if (now <= graceEnd) return 'GRACE';
  return sub.plan?.billingCycle === 'SEASONAL' ? 'READ_ONLY' : 'SUSPENDED';
}

/**
 * Whether a business gets the device/branch subscription (BASIC, STANDARD...) with its trial and payments.
 * A rental landlord does not: their plan is the rental plan (Bure, Starter, Pay-as-you-collect), billed from the
 * rentals screens (see rental/rental-platform-billing.service.ts), so a second, unrelated subscription would only
 * show up as "payment overdue" in the platform admin's billing screen. A construction contractor is on a construction
 * plan instead (construction/plans), and its project sites are branches the device plan's branch limit must not block.
 */
export function needsDeviceSubscription(industryType: string): boolean {
  return industryType !== 'RENTAL' && industryType !== 'CONSTRUCTION' && industryType !== 'FARM';
}

/** The free "Online Shop only" plan: for a shop that sells in-store on another POS. No tills; ZARODA earns the 3% shopper fee. */
export const ONLINE_ONLY_TIER = 'ONLINE_ONLY';
/** Business types the free Online Shop only plan is for (the online shop add-on is a retail shop's). */
export const ONLINE_ONLY_TYPES: readonly string[] = ['RETAIL'];
/** A free plan never falls due, so its paid-up date is set far ahead and it is never a trial. */
export const FREE_PLAN_UNTIL = new Date('2099-12-31T00:00:00Z');

export function isFreePlan(plan: { priceKes: unknown }): boolean {
  return Number(plan.priceKes) === 0;
}

/** The price of one till a month: the price agreed with the business, else the plan's price. */
export function tillPrice(sub: { agreedPriceKes?: unknown; plan: { priceKes: unknown } }): number {
  return sub.agreedPriceKes != null ? Number(sub.agreedPriceKes) : Number(sub.plan.priceKes);
}

export type BillingChoice = 'MONTHLY' | 'ANNUAL' | 'INSTALMENTS';
export const BILLING_CHOICES: readonly BillingChoice[] = ['MONTHLY', 'ANNUAL', 'INSTALMENTS'];

interface PricedSub {
  agreedPriceKes?: unknown;
  extraTills?: number | null;
  billingChoice?: string | null;
  plan: { priceKes: unknown; billingPeriodDays?: number; annualPriceKes?: unknown; instalmentCount?: number | null; instalmentKes?: unknown; extraTillKes?: unknown; extraTillAnnualKes?: unknown };
}

/** One extra till a month. A business keeping an old agreed price pays its till price for each (as it always has); others pay the plan's extra till price. */
export function extraTillPrice(sub: PricedSub): number {
  return sub.agreedPriceKes != null ? tillPrice(sub) : Number(sub.plan.extraTillKes ?? 500);
}

/** What a business pays a month on monthly billing: its plan (or agreed) price plus its extra tills. */
export function monthlyPrice(sub: PricedSub): number {
  return tillPrice(sub) + (sub.extraTills ?? 0) * extraTillPrice(sub);
}

/** Whether a plan can be paid this way: yearly needs a paid plan, instalments a plan with an instalment option. */
export function choiceProblem(plan: { name: string; priceKes: unknown; billingCycle?: string; instalmentCount?: number | null }, choice: BillingChoice): string | null {
  if (plan.billingCycle === 'SEASONAL') return 'A seasonal plan is paid by school term (Seasonal billing)';
  if (choice !== 'MONTHLY' && isFreePlan(plan)) return `The ${plan.name} plan is free`;
  if (choice === 'INSTALMENTS' && !plan.instalmentCount) return `The ${plan.name} plan has no instalment option`;
  return null;
}

/** One bill for the way the business pays: its amount and how far it moves the paid-up date (days for monthly, months otherwise). */
export function billFor(sub: PricedSub): { choice: BillingChoice; amount: number; days?: number; months?: number; label: string } {
  const extras = sub.extraTills ?? 0;
  const choice = (BILLING_CHOICES as readonly string[]).includes(sub.billingChoice ?? '') ? (sub.billingChoice as BillingChoice) : 'MONTHLY';
  const annual = sub.plan.annualPriceKes != null ? Number(sub.plan.annualPriceKes) : Number(sub.plan.priceKes) * 12;
  const tillYear = Number(sub.plan.extraTillAnnualKes ?? 5000);
  if (choice === 'ANNUAL') return { choice, amount: Math.round(annual + extras * tillYear), months: 12, label: 'a year' };
  const n = sub.plan.instalmentCount ?? 0;
  if (choice === 'INSTALMENTS' && n > 0) {
    const each = sub.plan.instalmentKes != null ? Number(sub.plan.instalmentKes) : Math.round(annual / n);
    return { choice, amount: Math.round(each + (extras * tillYear) / n), months: Math.round(12 / n), label: `each of ${n} instalments` };
  }
  return { choice: 'MONTHLY', amount: monthlyPrice(sub), days: sub.plan.billingPeriodDays ?? 30, label: 'a month' };
}

/** The paid-up date after paying one bill: from the current end while still paid up, else from now. */
export function periodAfterBill(currentEnd: Date, bill: { days?: number; months?: number }, now: Date = new Date()): Date {
  const from = new Date(Math.max(currentEnd.getTime(), now.getTime()));
  if (bill.months) {
    from.setUTCMonth(from.getUTCMonth() + bill.months);
    return from;
  }
  return new Date(from.getTime() + (bill.days ?? 30) * 86_400_000);
}

/** Recurring revenue a month from this subscription, whichever way it pays. */
export function monthlyEquivalent(sub: PricedSub): number {
  const bill = billFor(sub);
  return bill.months ? bill.amount / bill.months : (bill.amount / (bill.days ?? 30)) * 30;
}

/** How many tills the business may have: its plan's, plus the extra tills it pays for. */
export function tillLimit(sub: { extraTills?: number | null; plan: { maxDevices: number } }): number {
  return sub.plan.maxDevices + (sub.extraTills ?? 0);
}

/** Why a price can't be agreed on this plan, or null. A plan without minPriceKes has one fixed price. */
export function priceProblem(plan: { name: string; priceKes: unknown; minPriceKes?: unknown }, price: number): string | null {
  const max = Number(plan.priceKes);
  const min = plan.minPriceKes != null ? Number(plan.minPriceKes) : max;
  if (!Number.isFinite(price) || price !== Math.round(price)) return 'Enter the monthly price in whole shillings';
  if (price < min || price > max) {
    return min === max
      ? `The ${plan.name} plan has one price: KES ${max.toLocaleString('en-KE')} a month`
      : `The ${plan.name} plan is KES ${min.toLocaleString('en-KE')} - ${max.toLocaleString('en-KE')} a month`;
  }
  return null;
}
