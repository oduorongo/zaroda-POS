// Credit notes to schools: what may be credited on an invoice, what a credit note adds up to, and where the invoice stands after it.
// Plain functions, tested without a database. Worked in whole cents like the rest of the school money rules.

import {
  fromCents,
  InvoiceStatusValue,
  lineAmounts,
  toCents,
} from './school-money.util';

export interface InvoiceLineForCredit {
  id: string;
  description: string;
  /** What the invoice charged for. */
  quantity: number;
  unitPrice: number;
  taxRate: number;
  /** What earlier credit notes have already taken back on this line. */
  creditedQuantity: number;
}

export interface CreditRequestLine {
  invoiceLineId: string;
  quantity: number;
  /** How much of that quantity physically came back into stock (0 when nothing did: a price correction, goods thrown away). */
  restock?: number;
}

export interface PlannedCreditLine {
  invoiceLineId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  lineTotal: number;
  taxAmount: number;
  restock: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What is left to credit on a line. */
export const creditableQuantity = (
  l: Pick<InvoiceLineForCredit, 'quantity' | 'creditedQuantity'>,
): number => r3(Math.max(0, l.quantity - l.creditedQuantity));

/**
 * Works out a credit note from the lines asked for: each line may not be credited for more than is left of it, the goods put back
 * in stock may not be more than the quantity credited, and the credit as a whole may not be more than the invoice still stands at.
 */
export function planCreditNote(
  lines: InvoiceLineForCredit[],
  requested: CreditRequestLine[],
  invoiceRemaining: number,
): {
  problem: string | null;
  lines: PlannedCreditLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
} {
  const none = { lines: [], subtotal: 0, taxAmount: 0, total: 0 };
  if (requested.length === 0)
    return { problem: 'Choose at least one line to credit', ...none };
  const byId = new Map(lines.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const planned: PlannedCreditLine[] = [];
  for (const r of requested) {
    const l = byId.get(r.invoiceLineId);
    if (!l) return { problem: 'A line is not part of this invoice', ...none };
    if (seen.has(r.invoiceLineId))
      return { problem: `${l.description} is listed twice`, ...none };
    seen.add(r.invoiceLineId);
    if (!(r.quantity > 0))
      return {
        problem: `${l.description}: enter how many to credit`,
        ...none,
      };
    const left = creditableQuantity(l);
    if (r3(r.quantity) > left)
      return {
        problem: `${l.description}: only ${left} left to credit (you entered ${r.quantity})`,
        ...none,
      };
    const restock = r.restock ?? 0;
    if (restock < 0 || r3(restock) > r3(r.quantity))
      return {
        problem: `${l.description}: the goods put back in stock cannot be more than the quantity credited`,
        ...none,
      };
    const a = lineAmounts({
      quantity: r3(r.quantity),
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
    });
    planned.push({
      invoiceLineId: l.id,
      description: l.description,
      quantity: r3(r.quantity),
      unitPrice: l.unitPrice,
      taxRate: l.taxRate,
      lineTotal: a.lineTotal,
      taxAmount: a.taxAmount,
      restock: r3(restock),
    });
  }
  let subtotal = planned.reduce((s, p) => s + toCents(p.lineTotal), 0);
  let tax = planned.reduce((s, p) => s + toCents(p.taxAmount), 0);
  // line-by-line rounding can differ from the invoice's by a cent or two: never credit more than the invoice stands at
  const remaining = toCents(invoiceRemaining);
  let over = subtotal + tax - remaining;
  if (over > 0 && over <= 2 * planned.length) {
    const last = planned[planned.length - 1];
    const cut = Math.min(over, toCents(last.taxAmount));
    last.taxAmount = fromCents(toCents(last.taxAmount) - cut);
    tax -= cut;
    over -= cut;
  }
  if (over > 0)
    return {
      problem: `That is more than the invoice still stands at (${fromCents(remaining).toFixed(2)})`,
      ...none,
    };
  return {
    problem: null,
    lines: planned,
    subtotal: fromCents(subtotal),
    taxAmount: fromCents(tax),
    total: fromCents(subtotal + tax),
  };
}

/**
 * An invoice's status from what has been paid and credited against it. A credit note settles part of an invoice just as a payment
 * does: when payments and credits together reach the total it is settled.
 */
export function statusAfterSettlement(
  total: number,
  paid: number,
  credited: number,
): InvoiceStatusValue {
  const settled = toCents(paid) + toCents(credited);
  if (settled <= 0) return 'ISSUED';
  return settled >= toCents(total) ? 'PAID' : 'PARTIALLY_PAID';
}

/** What an invoice still owes after payments and credit notes (never below zero). */
export function invoiceBalance(
  total: number | string,
  paid: number | string,
  credited: number | string,
): number {
  return fromCents(
    Math.max(0, toCents(total) - toCents(paid) - toCents(credited)),
  );
}

/** Paid and credited together can exceed the total (a credit note on an invoice that was already paid): the excess is credit on the account. */
export function invoiceSurplus(
  total: number | string,
  paid: number | string,
  credited: number | string,
): number {
  return fromCents(
    Math.max(0, toCents(paid) + toCents(credited) - toCents(total)),
  );
}
