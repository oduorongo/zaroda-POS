import { randomBytes } from 'crypto';

/**
 * Pure helpers for rent billing. Money is handled in whole cents (integers) while allocating, so adding up
 * several part-payments never drifts by a fraction of a shilling. Dates are calendar dates held as UTC midnight,
 * which is how Prisma returns a Postgres DATE column.
 */

export const toCents = (amount: unknown): number => Math.round(Number(amount) * 100);
export const fromCents = (cents: number): number => cents / 100;

/** Today's calendar date in Nairobi (UTC+3, no daylight saving), as UTC midnight. */
export function nairobiToday(now: Date = new Date()): Date {
  const shifted = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

export const monthStart = (d: Date): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * The months a lease should have a rent invoice for: from the month it started up to the current month, or up
 * to the month it ended. A lease that ended before it began (bad data) gets none.
 */
export function billingMonths(startDate: Date, endedAt: Date | null, today: Date): Date[] {
  const last = monthStart(endedAt && endedAt < today ? endedAt : today);
  const months: Date[] = [];
  for (let m = monthStart(startDate); m <= last; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    months.push(m);
  }
  return months;
}

/** Rent falls due on the lease's due day; in the move-in month it cannot be due before the tenant moved in. */
export function rentDueDate(month: Date, dueDay: number, startDate: Date): Date {
  const due = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), Math.min(Math.max(dueDay, 1), 28)));
  return due < startDate ? startDate : due;
}

export const monthLabel = (month: Date): string =>
  month.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export interface UnappliedPayment {
  id: string;
  remainingCents: number;
}
export interface OpenInvoice {
  id: string;
  outstandingCents: number;
}
export interface PlannedAllocation {
  paymentId: string;
  invoiceId: string;
  cents: number;
}

/**
 * Applies money that has not been used yet to invoices that are still open, oldest first on both sides.
 * Whatever cannot be applied simply stays as the tenant's credit.
 */
export function planAllocations(payments: UnappliedPayment[], invoices: OpenInvoice[]): PlannedAllocation[] {
  const plan: PlannedAllocation[] = [];
  const money = payments.map((p) => ({ ...p }));
  let p = 0;
  for (const invoice of invoices) {
    let owed = invoice.outstandingCents;
    while (owed > 0 && p < money.length) {
      if (money[p].remainingCents <= 0) {
        p++;
        continue;
      }
      const take = Math.min(owed, money[p].remainingCents);
      plan.push({ paymentId: money[p].id, invoiceId: invoice.id, cents: take });
      money[p].remainingCents -= take;
      owed -= take;
    }
    if (p >= money.length) break;
  }
  return plan;
}

export type InvoiceStatus = 'PAID' | 'PARTIAL' | 'OVERDUE' | 'UNPAID';

/** PAID once covered; otherwise OVERDUE past its due date, PARTIAL if some has been paid, else UNPAID. */
export function invoiceStatus(amountDue: unknown, amountPaid: unknown, dueDate: Date, today: Date): InvoiceStatus {
  const owed = toCents(amountDue) - toCents(amountPaid);
  if (owed <= 0) return 'PAID';
  if (dueDate < today) return 'OVERDUE';
  return toCents(amountPaid) > 0 ? 'PARTIAL' : 'UNPAID';
}

/** e.g. RR-20261016-K7Q2XM - short enough to read out, random enough not to clash. */
export function newReceiptNumber(today: Date): string {
  const ymd = today.toISOString().slice(0, 10).replace(/-/g, '');
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(6);
  let suffix = '';
  for (const b of bytes) suffix += alphabet[b % alphabet.length];
  return `RR-${ymd}-${suffix}`;
}
