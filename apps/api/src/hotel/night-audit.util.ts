// The rules of the hotel's daily close, as plain functions.

const DAY_MS = 86_400_000;
const NAIROBI_OFFSET_MS = 3 * 3_600_000;

/** The date and hour in Kenya for a moment ("2026-11-05", 18). */
export function kenyaClock(now: Date): { date: string; hour: number } {
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

export const dayBefore = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
export const dayAfter = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);

/**
 * Whether a day can be closed now. A day that is over can always be closed; today only once the no-show cut-off hour has passed
 * (before that, a guest who is due out at noon would wrongly be counted as staying another night). The future never.
 */
export function auditClosable(
  date: string,
  now: Date,
  cutoffHour: number,
): { ok: true } | { ok: false; reason: string } {
  const clock = kenyaClock(now);
  if (date > clock.date)
    return { ok: false, reason: 'That day has not happened yet' };
  if (date === clock.date && clock.hour < cutoffHour)
    return {
      ok: false,
      reason: `Today can be closed from ${String(cutoffHour).padStart(2, '0')}:00 (or close it tomorrow)`,
    };
  return { ok: true };
}

/** The date the automatic audit should close right now, or null when it is not time (it closes the day that has just ended). */
export function autoAuditDate(now: Date, auditHour: number): string | null {
  const clock = kenyaClock(now);
  return clock.hour >= auditHour ? dayBefore(clock.date) : null;
}

/** The nights a guest who has stayed past their check-out date owes: from their booked check-out day up to and including the audited day. */
export function overstayNights(checkOut: string, auditDate: string): string[] {
  const out: string[] = [];
  for (let d = checkOut; d <= auditDate; d = dayAfter(d)) out.push(d);
  return out;
}

/** A confirmed booking is a no-show for the audit when its arrival has passed, nobody paid anything and the guest never arrived. */
export function isNoShow(
  b: { status: string; checkIn: string; paid: number },
  auditDate: string,
): boolean {
  return b.status === 'CONFIRMED' && b.checkIn <= auditDate && b.paid <= 0.001;
}
