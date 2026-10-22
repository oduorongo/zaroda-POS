import { RestaurantTableStatus, Role } from '@prisma/client';

// The money and rules of an open tab as plain functions, so they can be tested without a database.
// billTotals mirrors SalesService.create() step for step (line price x quantity, VAT per line, discount on the
// post-tax total, rounded to cents), because the sale refuses to complete if the payments do not match ITS total.

export const round2 = (n: number) => Math.round(n * 100) / 100;

export interface BillLine {
  quantity: number;
  unitPrice: number;
  /** VAT as a fraction (0.16), 0 when exempt or no tax class. */
  taxRate: number;
}
export interface BillDiscount {
  type: 'PERCENT' | 'FIXED';
  value: number;
}

export function billTotals(lines: BillLine[], discount?: BillDiscount) {
  let gross = 0;
  let tax = 0;
  let subtotal = 0;
  for (const l of lines) {
    const lineSubtotal = l.unitPrice * l.quantity;
    const lineTax = lineSubtotal * l.taxRate;
    subtotal += lineSubtotal;
    tax += lineTax;
    gross += lineSubtotal + lineTax;
  }
  let discountAmount = 0;
  if (discount) {
    if (discount.type === 'PERCENT' && discount.value > 100)
      throw new Error('A percent discount cannot exceed 100');
    discountAmount =
      discount.type === 'PERCENT'
        ? round2(gross * (discount.value / 100))
        : round2(discount.value);
    if (discountAmount > gross)
      throw new Error('The discount cannot be more than the bill');
  }
  return {
    subtotal: round2(subtotal),
    tax: round2(tax),
    discountAmount,
    total: round2(round2(gross - discountAmount)),
  };
}

const toCents = (n: number) => Math.round(n * 100);

/** An amount in N parts that add back up to exactly the amount (the odd cents go to the first payers). */
export function splitEqual(total: number, parts: number): number[] {
  if (!Number.isInteger(parts) || parts < 1)
    throw new Error('Split between at least one person');
  const cents = toCents(total);
  const base = Math.floor(cents / parts);
  const extra = cents - base * parts;
  return Array.from(
    { length: parts },
    (_, i) => (base + (i < extra ? 1 : 0)) / 100,
  );
}

/** A tip or service charge shared out in proportion to what each payer owes, adding back up to exactly the amount. */
export function shareProportionally(
  amount: number,
  weights: number[],
): number[] {
  const cents = toCents(amount);
  const sum = weights.reduce((a, b) => a + b, 0);
  if (cents === 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => Math.floor((cents * w) / sum));
  let left = cents - raw.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % raw.length, left--) raw[i] += 1;
  return raw.map((c) => c / 100);
}

const SUPERVISOR_OR_ABOVE: Role[] = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
export const isSupervisorOrAbove = (role: Role) =>
  SUPERVISOR_OR_ABOVE.includes(role);

/** Why a line cannot be voided, or null when it can. Only a supervisor or above, with a reason, and only an unpaid line. */
export function voidProblem(
  role: Role,
  line: { status: string },
  reason: string | undefined,
): string | null {
  if (!SUPERVISOR_OR_ABOVE.includes(role))
    return 'Only a supervisor, manager or owner can void an item';
  if (line.status === 'PAID') return 'That item has already been paid for';
  if (line.status === 'VOIDED') return 'That item is already voided';
  if (!reason || reason.trim().length < 3) return 'Say why it is being voided';
  return null;
}

/** Whether a table can have a tab opened on it right now. */
export function openProblem(hasOpenTab: boolean): string | null {
  return hasOpenTab ? 'This table already has an open bill' : null;
}

// ── Reserved tables ─────────────────────────────────────────────────────

/** How long after its time a confirmed reservation keeps holding the table. */
export const RESERVATION_HOLD_MINUTES = 60;
const NAIROBI_OFFSET_MINUTES = 180;

/** The moment a reservation starts, from its date (a day) and its "19:30" local time (Nairobi, UTC+3). */
export function reservationStart(date: Date, time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      h,
      m,
    ) -
    NAIROBI_OFFSET_MINUTES * 60_000
  );
}

/**
 * What a table should show: a table that is occupied or needs cleaning shows that; otherwise a confirmed reservation for it
 * makes it Reserved from `leadMinutes` before the time until an hour after it. Worked out when the floor is read, so there
 * is nothing to schedule and nothing that can get stuck.
 */
export function floorStatus(
  stored: RestaurantTableStatus,
  reservations: {
    date: Date;
    time: string;
    guestName: string;
    status: string;
  }[],
  leadMinutes: number,
  now: Date = new Date(),
): {
  status: RestaurantTableStatus;
  reservation: { guestName: string; time: string } | null;
} {
  if (stored !== RestaurantTableStatus.AVAILABLE)
    return { status: stored, reservation: null };
  const t = now.getTime();
  const hit = reservations.find((r) => {
    if (r.status !== 'CONFIRMED') return false;
    const start = reservationStart(r.date, r.time);
    return (
      t >= start - leadMinutes * 60_000 &&
      t <= start + RESERVATION_HOLD_MINUTES * 60_000
    );
  });
  return hit
    ? {
        status: RestaurantTableStatus.RESERVED,
        reservation: { guestName: hit.guestName, time: hit.time },
      }
    : { status: stored, reservation: null };
}
