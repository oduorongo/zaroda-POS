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
