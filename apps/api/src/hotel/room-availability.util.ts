/** Pure rules for hotel room bookings: dates, how many rooms are taken on which nights, and the deposit. */

const DAY_MS = 86_400_000;
/** Kenya has no daylight saving: always UTC+3. */
const NAIROBI_OFFSET_MS = 3 * 3_600_000;

export const MAX_NIGHTS = 30;
export const MAX_ROOMS_PER_BOOKING = 5;
/** How long an unpaid booking holds its rooms. An M-Pesa prompt itself times out in about a minute. */
export const BOOKING_PAYMENT_WINDOW_MS = 15 * 60_000;

/** "2026-11-05" -> that calendar day (UTC midnight), or null if it is not a real date. */
export function parseDay(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Today's date in Kenya, as UTC midnight (what a hotel means by "today"). */
export function todayInKenya(now: Date = new Date()): Date {
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

export const nightsBetween = (checkIn: Date, checkOut: Date) => Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS);

/** Every night of a stay: the night of check-in up to, but not including, the check-out day. */
export function eachNight(checkIn: Date, checkOut: Date): Date[] {
  const nights: Date[] = [];
  for (let t = checkIn.getTime(); t < checkOut.getTime(); t += DAY_MS) nights.push(new Date(t));
  return nights;
}

/** A message if the stay is not acceptable, otherwise null. */
export function stayProblem(checkIn: Date | null, checkOut: Date | null, today: Date): string | null {
  if (!checkIn || !checkOut) return 'Choose your check-in and check-out dates';
  if (checkIn.getTime() < today.getTime()) return 'The check-in date has already passed';
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1) return 'Check-out must be after check-in';
  if (nights > MAX_NIGHTS) return `You can book up to ${MAX_NIGHTS} nights at a time`;
  return null;
}

export interface HeldBooking {
  checkIn: Date;
  checkOut: Date;
  rooms: number;
}

/**
 * The most rooms already taken on any single night of the stay. A room type with 5 rooms and a night with 3 taken has
 * 2 free; the stay is only as available as its busiest night. A booking covers its check-in day through the night
 * before its check-out day, so one guest leaving the morning another arrives never clash.
 */
export function roomsTaken(bookings: HeldBooking[], checkIn: Date, checkOut: Date): number {
  let worst = 0;
  for (const night of eachNight(checkIn, checkOut)) {
    const t = night.getTime();
    const taken = bookings.filter((b) => b.checkIn.getTime() <= t && t < b.checkOut.getTime()).reduce((sum, b) => sum + b.rooms, 0);
    worst = Math.max(worst, taken);
  }
  return worst;
}

/** Whether a booking still keeps its rooms from other guests: paid ones, and unpaid ones still inside their payment window. */
export function bookingHoldsRooms(booking: { status: string; paymentDeadline: Date }, now: Date = new Date()): boolean {
  if (booking.status === 'CONFIRMED' || booking.status === 'CHECKED_IN') return true;
  return booking.status === 'PENDING_PAYMENT' && booking.paymentDeadline.getTime() > now.getTime();
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const stayTotal = (pricePerNight: number, nights: number, rooms: number) => round2(pricePerNight * nights * rooms);

/**
 * The deposit paid online: a percentage of the whole stay, rounded UP to a whole shilling (M-Pesa only takes whole
 * amounts), never less than KES 1 and never more than the stay costs.
 */
export function depositFor(total: number, percent: number): number {
  const wanted = Math.ceil((total * Math.min(100, Math.max(0, percent))) / 100 - 1e-9);
  return Math.max(1, Math.min(wanted, Math.ceil(total)));
}

/** Days after the check-out date before a stay nobody checked out completes by itself (time for the hotel to mark a no-show). */
export const AUTO_COMPLETE_GRACE_DAYS = 2;

/** Stays whose check-out date is on or before this day, and are still open and paid, are completed automatically. */
export function autoCompleteCutoff(now: Date = new Date()): Date {
  return new Date(todayInKenya(now).getTime() - AUTO_COMPLETE_GRACE_DAYS * DAY_MS);
}

/** The moment recorded as the check-out of an automatic completion: midday Kenya time on the check-out date, so the stay (and its commission) belongs to the month it really ended in. */
export function checkedOutAtFor(checkOut: Date): Date {
  return new Date(checkOut.getTime() + 9 * 3_600_000);
}
