import { randomInt } from 'crypto';

/**
 * Commission billing rules, kept as plain functions so they're easy to
 * test and so the one definition of "overdue" is shared by everything that
 * needs it (the shop-visibility check, the business's own commission page,
 * the platform admin's list).
 */

/** Days after an invoice is issued that payment is due. */
export const INVOICE_DUE_DAYS = 14;
/** Extra days after the due date before the shop is hidden from buyers. */
export const PAUSE_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;
// Kenya has no daylight saving: always UTC+3, so a month boundary is a
// fixed offset from UTC rather than needing a timezone database.
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** "2026-10" for the Nairobi calendar month a moment falls in. */
export function monthOf(date: Date): string {
  const local = new Date(date.getTime() + NAIROBI_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isValidMonth(month: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

/** [start, end) of a Nairobi calendar month, as UTC instants. */
export function monthBounds(month: string): { start: Date; end: Date } {
  if (!isValidMonth(month)) throw new Error(`Invalid month: ${month}`);
  const [year, mon] = month.split('-').map(Number);
  const start = new Date(Date.UTC(year, mon - 1, 1) - NAIROBI_OFFSET_MS);
  const end = new Date(Date.UTC(year, mon, 1) - NAIROBI_OFFSET_MS);
  return { start, end };
}

/** A month can be invoiced once it has fully ended (Nairobi time). */
export function isMonthClosed(month: string, now: Date = new Date()): boolean {
  return monthBounds(month).end <= now;
}

export function invoiceDueDate(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVOICE_DUE_DAYS * DAY_MS);
}

/** When the shop gets hidden if this invoice is still unpaid. */
export function pauseDate(dueDate: Date): Date {
  return new Date(dueDate.getTime() + PAUSE_GRACE_DAYS * DAY_MS);
}

interface InvoiceLike {
  status: 'ISSUED' | 'PAID' | 'WAIVED';
  dueDate: Date;
}

/** Past its due date and still unpaid (a warning), not yet necessarily a pause. */
export function isPastDue(invoice: InvoiceLike, now: Date = new Date()): boolean {
  return invoice.status === 'ISSUED' && invoice.dueDate < now;
}

/** Unpaid past due date + grace: the point the shop stops taking new orders. */
export function isPauseOverdue(invoice: InvoiceLike, now: Date = new Date()): boolean {
  return invoice.status === 'ISSUED' && pauseDate(invoice.dueDate) < now;
}

/** "ZC-202610-7K3Q" - month plus a short unambiguous code, so numbers can be read over the phone. */
export function invoiceNumber(month: string, code: string): string {
  return `ZC-${month.replace('-', '')}-${code}`;
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

// No 0/O/1/I - invoice numbers get read out over the phone.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function randomInvoiceCode(length = 4): string {
  let code = '';
  for (let i = 0; i < length; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}
