/** What advertising a unit on "Houses to let" costs. Pure rules only - the database and Tuma are in rental-listing-payments.service.ts. */
export const LISTING_FEE_KES = 100;
/** One payment keeps an advert public for this long; paying again adds another stretch. */
export const LISTING_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * UNPAID  - never paid for, not shown yet.
 * LIVE    - switched on and paid up.
 * EXPIRED - was paid for, the 30 days have run out.
 * PAUSED  - the landlord switched it off (paid time is kept and runs on).
 * BLOCKED - ZARODA took it down; the landlord cannot switch it back on.
 */
export type ListingState = 'UNPAID' | 'LIVE' | 'EXPIRED' | 'PAUSED' | 'BLOCKED';

/** Most adverts one M-Pesa payment may cover. */
export const MAX_ADVERTS_PER_PAYMENT = 30;

export function listingState(l: { isActive: boolean; paidUntil: Date | null; blockedAt?: Date | null }, now: Date = new Date()): ListingState {
  if (l.blockedAt) return 'BLOCKED';
  if (!l.isActive) return 'PAUSED';
  if (!l.paidUntil) return 'UNPAID';
  return l.paidUntil.getTime() > now.getTime() ? 'LIVE' : 'EXPIRED';
}

/**
 * Where "paid until" lands after a payment. Paying early adds the new 30 days on top of what is left, so a landlord
 * who renews a week before it lapses loses nothing; a lapsed or never-paid advert starts from now.
 */
export function extendPaidUntil(current: Date | null, now: Date = new Date()): Date {
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + LISTING_DAYS * DAY_MS);
}
