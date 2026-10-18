/** Which hotels the platform owner should look at: pure rules, so they can be tested without a database. */

/** A rate means little on a handful of bookings. */
export const WATCH_MIN_PAID_BOOKINGS = 5;
/** Cancelled or no-show bookings, as a share of paid bookings, at which a hotel is flagged. */
export const WATCH_RATE = 0.3;

export interface HotelCounts {
  /** Bookings whose deposit was paid. */
  paid: number;
  noShow: number;
  cancelled: number;
}

export const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/**
 * Why a hotel is worth a look, or null. Paid bookings that end as a no-show or a cancellation are how a hotel can keep a
 * deposit (or dodge commission, which is only charged on stays that happen): a high share of them deserves a phone call.
 */
export function watchReason(counts: HotelCounts): string | null {
  if (counts.paid < WATCH_MIN_PAID_BOOKINGS) return null;
  const lost = counts.noShow + counts.cancelled;
  if (lost / counts.paid < WATCH_RATE) return null;
  return `${lost} of ${counts.paid} paid bookings (${percent(lost, counts.paid)}%) ended as a no-show (${counts.noShow}) or a cancellation (${counts.cancelled})`;
}
