// The money rules of selling to schools on credit, kept as plain functions so they can be tested without a database.
// Everything is worked in whole cents (integers) so a total can never drift by a fraction of a shilling.

export const toCents = (value: number | string | { toString(): string }): number => Math.round(Number(value) * 100);
export const fromCents = (cents: number): number => cents / 100;

export interface PricedLine {
  quantity: number;
  unitPrice: number;
  /** VAT as a fraction: 0.16 for 16%, 0 when exempt. */
  taxRate: number;
}

/** One line: quantity x price before VAT, the VAT on it, and the line in total. */
export function lineAmounts(line: PricedLine): { lineTotal: number; taxAmount: number; gross: number } {
  const lineTotal = toCents(line.quantity * line.unitPrice);
  const taxAmount = Math.round(lineTotal * line.taxRate);
  return { lineTotal: fromCents(lineTotal), taxAmount: fromCents(taxAmount), gross: fromCents(lineTotal + taxAmount) };
}

/** An invoice (or an order) added up: before VAT, VAT, and what the school pays. */
export function documentTotals(lines: PricedLine[]): { subtotal: number; taxAmount: number; total: number } {
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    const a = lineAmounts(l);
    subtotal += toCents(a.lineTotal);
    tax += toCents(a.taxAmount);
  }
  return { subtotal: fromCents(subtotal), taxAmount: fromCents(tax), total: fromCents(subtotal + tax) };
}

// ── Payments against invoices ───────────────────────────────────────────

export interface OpenInvoice {
  id: string;
  /** What is still owed on it. */
  balance: number;
  /** Oldest first is decided by this (the invoice date). */
  issueDate: string;
}

export interface Allocation {
  invoiceId: string;
  amount: number;
}

/**
 * Spreads a payment over what a school owes, oldest invoice first, and says what is left over (credit on the account).
 * Nothing is ever allocated beyond an invoice's balance.
 */
export function allocateOldestFirst(paymentAmount: number, open: OpenInvoice[]): { allocations: Allocation[]; unallocated: number } {
  let left = toCents(paymentAmount);
  const allocations: Allocation[] = [];
  for (const inv of [...open].sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.id.localeCompare(b.id))) {
    if (left <= 0) break;
    const balance = toCents(inv.balance);
    if (balance <= 0) continue;
    const take = Math.min(left, balance);
    allocations.push({ invoiceId: inv.id, amount: fromCents(take) });
    left -= take;
  }
  return { allocations, unallocated: fromCents(left) };
}

/** Checks a person's own choice of allocations: each within its invoice's balance, and together within the payment. */
export function allocationProblem(paymentAmount: number, chosen: Allocation[], balances: Map<string, number>): string | null {
  let sum = 0;
  const seen = new Set<string>();
  for (const a of chosen) {
    if (seen.has(a.invoiceId)) return 'An invoice is listed twice';
    seen.add(a.invoiceId);
    if (!(a.amount > 0)) return 'Each amount must be more than zero';
    const balance = balances.get(a.invoiceId);
    if (balance === undefined) return 'That invoice does not belong to this school, or is not open';
    if (toCents(a.amount) > toCents(balance)) return 'An amount is more than that invoice still owes';
    sum += toCents(a.amount);
  }
  if (sum > toCents(paymentAmount)) return 'The amounts add up to more than the payment';
  return null;
}

export type InvoiceStatusValue = 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'VOID';

/** An invoice's status from what has been paid against it. */
export function statusAfterPayment(total: number, paid: number): InvoiceStatusValue {
  const t = toCents(total);
  const p = toCents(paid);
  if (p <= 0) return 'ISSUED';
  return p >= t ? 'PAID' : 'PARTIALLY_PAID';
}

// ── Dates and ageing ────────────────────────────────────────────────────

const DAY_MS = 86_400_000;
const NAIROBI_OFFSET_MS = 3 * 3_600_000;

/** Today in Nairobi, "2026-10-22". */
export const todayKey = (now: Date = new Date()): string => new Date(now.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);

export function addDays(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY_MS);
}

export type AgeBucket = 'CURRENT' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_90' | 'OVER_90';

/** How late an unpaid invoice is: not yet due, or 1-30, 31-60, 61-90 or over 90 days past its due date. */
export function ageBucket(dueDate: string, today: string): AgeBucket {
  const late = daysBetween(dueDate, today);
  if (late <= 0) return 'CURRENT';
  if (late <= 30) return 'DAYS_1_30';
  if (late <= 60) return 'DAYS_31_60';
  if (late <= 90) return 'DAYS_61_90';
  return 'OVER_90';
}

// ── Credit limit ────────────────────────────────────────────────────────

/** Would this new order take the school past its credit limit (counting everything it already owes)? No limit = never. */
export function exceedsCreditLimit(creditLimit: number | null, owed: number, newOrderTotal: number): boolean {
  if (creditLimit === null) return false;
  return toCents(owed) + toCents(newOrderTotal) > toCents(creditLimit);
}

/** "SO-2026-0007" */
export function documentNumber(prefix: string, year: number, sequence: number): string {
  return `${prefix}-${year}-${String(sequence).padStart(4, '0')}`;
}
