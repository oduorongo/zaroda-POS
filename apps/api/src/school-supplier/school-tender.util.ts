// Tenders and contracts: what a bid comes to, whether a tender may be submitted, and where a contract stands.
// Plain functions, tested without a database. Money is worked in whole cents.

import {
  fromCents,
  lineAmounts,
  toCents,
  daysBetween,
} from './school-money.util';

/** What a new tender's checklist starts with; the business can add to it or take items off. */
export const DEFAULT_CHECKLIST = [
  'Tender document obtained',
  'Tax compliance certificate valid',
  'Business permit / registration documents',
  'Bid security (bond) arranged',
  'Price schedule completed and checked',
  'Bid signed, stamped and sealed',
  'Delivered to the institution before closing',
];

export interface BidLine {
  quantity: number;
  unitCost: number;
  unitPrice: number;
  taxRate: number;
}

/** A bid added up: what it costs the business, what it is priced at (before and after VAT), and the margin. */
export function bidTotals(lines: BidLine[]) {
  let cost = 0;
  let subtotal = 0;
  let tax = 0;
  for (const l of lines) {
    cost += toCents(l.quantity * l.unitCost);
    const a = lineAmounts({
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
    });
    subtotal += toCents(a.lineTotal);
    tax += toCents(a.taxAmount);
  }
  const margin = subtotal - cost;
  return {
    cost: fromCents(cost),
    subtotal: fromCents(subtotal),
    taxAmount: fromCents(tax),
    total: fromCents(subtotal + tax),
    margin: fromCents(margin),
    /** Margin as a share of the price before VAT (0 when nothing is priced). */
    marginPercent:
      subtotal > 0 ? Math.round((margin / subtotal) * 10000) / 100 : 0,
  };
}

export type ComplianceState = 'OK' | 'EXPIRING' | 'EXPIRED' | 'NO_EXPIRY';

/** How a compliance document stands: valid, due to expire within 30 days, expired, or one that does not expire. */
export function complianceState(
  expiryDate: string | null,
  today: string,
): ComplianceState {
  if (!expiryDate) return 'NO_EXPIRY';
  if (expiryDate < today) return 'EXPIRED';
  return daysBetween(today, expiryDate) <= 30 ? 'EXPIRING' : 'OK';
}

export interface SubmissionCheck {
  closingDate: string | null;
  today: string;
  checklist: { title: string; done: boolean }[];
  docs: { name: string; expiryDate: string | null }[];
  hasBid: boolean;
}

/**
 * What stops a tender being submitted, and what is only worth a look. A blocker can be overridden by the owner with a reason; a
 * tender that has already closed cannot be submitted at all.
 */
export function submissionCheck(c: SubmissionCheck): {
  closed: boolean;
  blockers: string[];
  warnings: string[];
} {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const closed = c.closingDate !== null && c.closingDate < c.today;
  const open = c.checklist.filter((i) => !i.done);
  if (open.length > 0)
    blockers.push(
      `Not ready on the checklist: ${open.map((i) => i.title).join('; ')}`,
    );
  for (const d of c.docs) {
    if (!d.expiryDate) continue;
    if (d.expiryDate < c.today)
      blockers.push(`${d.name} expired on ${d.expiryDate}`);
    else if (c.closingDate && d.expiryDate < c.closingDate)
      blockers.push(
        `${d.name} runs out on ${d.expiryDate}, before the tender closes on ${c.closingDate}`,
      );
    else if (daysBetween(c.today, d.expiryDate) <= 30)
      warnings.push(`${d.name} runs out on ${d.expiryDate}`);
  }
  if (!c.hasBid) warnings.push('No bid prices have been entered');
  return { closed, blockers, warnings };
}

export interface ContractFigures {
  /** What the contract was agreed at, VAT included. */
  originalValue: number;
  variations: number;
  /** Invoices charged to it (not cancelled), and the credit notes against them. */
  invoiced: number;
  credited: number;
  paid: number;
  /** Before VAT, for the margin: sales less credits, and what the goods cost. */
  netSales: number;
  costOfGoods: number;
}

/** Where a contract stands: its value now, what has been invoiced against it, what is left, what is owed, and the profit. */
export function contractFigures(f: ContractFigures) {
  const value = toCents(f.originalValue) + toCents(f.variations);
  const net = toCents(f.invoiced) - toCents(f.credited);
  const remaining = value - net;
  const profit = toCents(f.netSales) - toCents(f.costOfGoods);
  return {
    value: fromCents(value),
    netInvoiced: fromCents(net),
    remaining: fromCents(Math.max(0, remaining)),
    /** Invoiced beyond what the contract allows. */
    overrun: fromCents(Math.max(0, -remaining)),
    usedPercent: value > 0 ? Math.round((net / value) * 10000) / 100 : 0,
    owed: fromCents(Math.max(0, net - toCents(f.paid))),
    profit: fromCents(profit),
    profitPercent:
      toCents(f.netSales) > 0
        ? Math.round((profit / toCents(f.netSales)) * 10000) / 100
        : 0,
  };
}
