export type EffectiveStatus = 'TRIAL' | 'ACTIVE' | 'GRACE' | 'SUSPENDED';

interface SubscriptionLike {
  currentPeriodEnd: Date;
  graceDays: number;
  isTrial: boolean;
  manuallySuspended: boolean;
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
  return 'SUSPENDED';
}

/**
 * Whether a business gets the device/branch subscription (BASIC, STANDARD...) with its trial and payments.
 * A rental landlord does not: their plan is the rental plan (Bure, Starter, Pay-as-you-collect), billed from the
 * rentals screens (see rental/rental-platform-billing.service.ts), so a second, unrelated subscription would only
 * show up as "payment overdue" in the platform admin's billing screen. A construction contractor is on a construction
 * plan instead (construction/plans), and its project sites are branches the device plan's branch limit must not block.
 */
export function needsDeviceSubscription(industryType: string): boolean {
  return industryType !== 'RENTAL' && industryType !== 'CONSTRUCTION';
}
