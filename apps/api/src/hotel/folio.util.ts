import { createHash } from 'crypto';
import { HotelRoomStatus, Role } from '@prisma/client';

// The rules of a guest's folio and front desk as plain functions, so they can be tested without a database.
// All money is worked in whole cents.

const cents = (n: number) => Math.round(n * 100);
const fromCents = (c: number) => c / 100;
const SUPERVISOR_OR_ABOVE: Role[] = [Role.SUPERVISOR, Role.MANAGER, Role.OWNER];
const MANAGER_OR_ABOVE: Role[] = [Role.MANAGER, Role.OWNER];
export const isSupervisorOrAbove = (role: Role) =>
  SUPERVISOR_OR_ABOVE.includes(role);
export const isManagerOrAbove = (role: Role) => MANAGER_OR_ABOVE.includes(role);

export type EntryType =
  'ROOM_NIGHT' | 'CHARGE' | 'PAYMENT' | 'REFUND' | 'ADJUSTMENT';

/** What an entry does to what the guest owes: a payment lowers it, a refund raises it again, an adjustment is signed. */
export function signedAmount(type: EntryType, amount: number): number {
  return type === 'PAYMENT' ? -amount : amount;
}

/** What the guest still owes (negative = the hotel owes the guest). */
export function folioBalance(
  entries: { type: EntryType; amount: number }[],
): number {
  return fromCents(
    entries.reduce((sum, e) => sum + cents(signedAmount(e.type, e.amount)), 0),
  );
}

export function folioTotals(
  entries: { type: EntryType; amount: number; taxAmount?: number }[],
) {
  const sum = (types: EntryType[]) =>
    fromCents(
      entries
        .filter((e) => types.includes(e.type))
        .reduce((s, e) => s + cents(e.amount), 0),
    );
  return {
    roomNights: sum(['ROOM_NIGHT']),
    roomTax: fromCents(
      entries
        .filter((e) => e.type === 'ROOM_NIGHT')
        .reduce((s, e) => s + cents(e.taxAmount ?? 0), 0),
    ),
    charges: sum(['CHARGE']),
    adjustments: sum(['ADJUSTMENT']),
    payments: sum(['PAYMENT']),
    refunds: sum(['REFUND']),
    balance: folioBalance(entries),
  };
}

/**
 * The room-night entries for a stay: one per night, tax included in each amount and also shown on its own. They add up to
 * exactly what the sale made at check-out will total (rate x rooms x nights, plus tax, rounded once) - the odd cents land on
 * the last night - because the sale refuses to complete if its payments do not match its own total.
 */
export function nightEntries(
  rate: number,
  rooms: number,
  nights: number,
  taxRate: number,
): { amount: number; taxAmount: number }[] {
  if (nights < 1) return [];
  const net = rate * rooms * nights;
  const totalGross = cents(net * (1 + taxRate));
  const totalTax = cents(net * taxRate);
  const baseGross = Math.floor(totalGross / nights);
  const baseTax = Math.floor(totalTax / nights);
  return Array.from({ length: nights }, (_, i) => {
    const last = i === nights - 1;
    return {
      amount: fromCents(
        last ? totalGross - baseGross * (nights - 1) : baseGross,
      ),
      taxAmount: fromCents(last ? totalTax - baseTax * (nights - 1) : baseTax),
    };
  });
}

export interface PaymentEntry {
  id: string;
  method: string;
  amount: number;
  reference: string | null;
  createdAt: Date;
}

/**
 * Which of the guest's payments pay the room nights in the settlement sale: oldest first, each in its own method, up to the
 * room total. Money beyond that pays charges that already had their own sale, so it is not part of this sale.
 */
export function allocateToSettlement(
  settlementTotal: number,
  payments: PaymentEntry[],
) {
  let left = cents(settlementTotal);
  const allocations: {
    entryId: string;
    method: string;
    amount: number;
    reference: string | null;
  }[] = [];
  for (const p of [...payments].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  )) {
    if (left <= 0) break;
    const take = Math.min(left, cents(p.amount));
    if (take <= 0) continue;
    allocations.push({
      entryId: p.id,
      method: p.method,
      amount: fromCents(take),
      reference: p.reference,
    });
    left -= take;
  }
  return { allocations, unpaid: fromCents(left) };
}

// ── Rules ───────────────────────────────────────────────────────────────

/** Why a guest cannot be checked in right now, or null. The date rule can be overridden by a manager. */
export function checkInProblem(
  today: Date,
  checkIn: Date,
  checkOut: Date,
  role: Role,
  overrideEarly: boolean,
): string | null {
  if (today.getTime() >= checkOut.getTime())
    return 'The check-out date of this booking has already passed';
  if (today.getTime() < checkIn.getTime()) {
    if (!overrideEarly)
      return `Check-in opens on ${checkIn.toISOString().slice(0, 10)}. A manager can allow an early check-in.`;
    if (!isManagerOrAbove(role))
      return 'Only a manager or owner can check a guest in before the arrival date';
  }
  return null;
}

/** Why a guest cannot be checked out with this balance, or null. A balance left owing (or an overpayment) needs a manager and a reason. */
export function checkOutProblem(
  balance: number,
  role: Role,
  leaveReason: string | undefined,
): string | null {
  if (Math.abs(balance) < 0.01) return null;
  if (!leaveReason) {
    return balance > 0
      ? `The guest still owes KES ${balance.toFixed(2)}. Take the payment first, or ask a manager to approve leaving it.`
      : `The guest has overpaid by KES ${(-balance).toFixed(2)}. Refund it first (a manager), or ask a manager to approve leaving it.`;
  }
  if (leaveReason.trim().length < 3) return 'Say why the balance is being left';
  if (!isManagerOrAbove(role))
    return 'Only a manager or owner can approve checking out with a balance';
  return null;
}

/** Why a housekeeping status cannot be set, or null. Occupied is only ever set by checking in. */
export function roomStatusProblem(
  role: Role,
  from: HotelRoomStatus,
  to: HotelRoomStatus,
): string | null {
  if (to === 'OCCUPIED')
    return 'A room becomes occupied by checking a guest in';
  if (from === 'OCCUPIED')
    return 'A guest is in this room - check them out (or move them) first';
  if (to === 'OUT_OF_ORDER' && !isSupervisorOrAbove(role))
    return 'Only a supervisor or above can mark a room out of order';
  return null;
}

/** A room type's quantity: the number of active rooms once it has any, otherwise whatever was set by hand. */
export const quantityFor = (activeRooms: number, current: number) =>
  activeRooms > 0 ? activeRooms : current;

// ── Charging to a room ──────────────────────────────────────────────────

const ROOM_PREFIX = 'ROOM:';
export const SETTLE_PREFIX = 'SETTLE:';

/** The payment reference of a charge to a room: unique per sale (payment references are unique), and carries the booking. */
export const roomChargeReference = (bookingId: string, saleClientId: string) =>
  `${ROOM_PREFIX}${bookingId}:${saleClientId}`;
export const settlementReference = (bookingId: string) =>
  `${SETTLE_PREFIX}${bookingId}`;

export function parseRoomChargeReference(
  reference: string | null | undefined,
): { bookingId: string } | null {
  const m = /^ROOM:([0-9a-fA-F-]{36}):.+$/.exec(reference ?? '');
  return m ? { bookingId: m[1] } : null;
}

/** Same stay always maps to the same sale id, so settling it twice can never make two sales. */
export function settlementClientId(bookingId: string): string {
  const h = createHash('sha256')
    .update(`hotel-settlement:${bookingId}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * The payments that are still the guest's money after refunds: a refund takes back from the newest payments first (a refund of a
 * deposit is the usual case), so what is left is what can pay the stay.
 */
export function netPayments(
  payments: PaymentEntry[],
  refundsTotal: number,
): PaymentEntry[] {
  let refund = cents(refundsTotal);
  const out: PaymentEntry[] = [];
  for (const p of [...payments].sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
  )) {
    const take = Math.min(refund, cents(p.amount));
    refund -= take;
    const left = cents(p.amount) - take;
    if (left > 0) out.push({ ...p, amount: fromCents(left) });
  }
  return out.reverse();
}

/** What the settlement sale of the room nights totals: the nights (with tax) less any adjustments taken off, rounded once, as the sale rounds. */
export function settlementTotal(
  rate: number,
  quantity: number,
  taxRate: number,
  discount: number,
): number {
  return (
    Math.round(
      Math.round(rate * quantity * (1 + taxRate) * 100 - discount * 100),
    ) / 100
  );
}
