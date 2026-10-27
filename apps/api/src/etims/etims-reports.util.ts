// The daily X and Z reports and the PLU (item) report the specification asks the trader's system for (articles 15, 16 and 18), worked
// out from what KRA signed. Plain functions, tested without a database. Amounts keep the tax in them, as KRA is sent them.

import { TAX_LETTERS, TaxLetter } from './etims-sales.util';
import { taxLabel } from './etims-receipt.util';

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

export interface ReportLine {
  variantId?: string;
  itemCd: string;
  itemNm: string;
  qty: number;
  splyAmt: number;
  dcAmt: number;
  taxTyCd: string;
  taxAmt: number;
  totAmt: number;
}

export interface ReportDoc {
  kind: 'SALE' | 'CREDIT';
  lines: ReportLine[];
  pmtTyCd: string;
  rates: Partial<Record<TaxLetter, number>>;
}

/** KRA's payment codes (4.11) as a report names them. */
export const PAYMENT_NAME: Record<string, string> = {
  '01': 'CASH',
  '02': 'CREDIT',
  '03': 'CASH/CREDIT',
  '04': 'BANK CHECK',
  '05': 'CARD',
  '06': 'MOBILE MONEY',
  '07': 'OTHER',
};

const letterOf = (c: string): TaxLetter =>
  (TAX_LETTERS.includes(c as TaxLetter) ? c : 'D') as TaxLetter;

export interface Extras {
  /** Receipts printed again as copies, with what they came to. */
  copies: { sale: { count: number; amount: number }; credit: { count: number; amount: number } };
  /** What the till drawers were opened with (the shifts' opening floats). */
  openingDeposit: number;
  /** Sales not yet accepted by KRA (waiting or refused). */
  incomplete: number;
  /** Refunds that could not be sent as credit notes and have to be done by hand on the KRA portal. */
  manualCreditNotes: number;
}

/** The figures of an X or Z report for a set of KRA-signed documents. */
export function summarise(docs: ReportDoc[], extras: Extras) {
  const sales = docs.filter((d) => d.kind === 'SALE');
  const credits = docs.filter((d) => d.kind === 'CREDIT');
  const total = (list: ReportDoc[]) =>
    list.reduce((s, d) => s + d.lines.reduce((t, l) => t + cents(l.totAmt), 0), 0);
  const rates: Partial<Record<TaxLetter, number>> = {};
  for (const d of docs) for (const k of TAX_LETTERS) if (d.rates[k] !== undefined) rates[k] = d.rates[k];
  const byLetter = (list: ReportDoc[], letter: TaxLetter) => {
    let gross = 0;
    let tax = 0;
    for (const d of list)
      for (const l of d.lines)
        if (letterOf(l.taxTyCd) === letter) {
          gross += cents(l.totAmt);
          tax += cents(l.taxAmt);
        }
    return { taxable: money(gross - tax), tax: money(tax), used: gross !== 0 || tax !== 0 };
  };
  const taxByRate = TAX_LETTERS.map((letter) => {
    const s = byLetter(sales, letter);
    const c = byLetter(credits, letter);
    const rate = rates[letter] ?? 0;
    return {
      letter,
      label: taxLabel(letter, rate),
      rate,
      sales: { taxable: s.taxable, tax: s.tax },
      credit: { taxable: c.taxable, tax: c.tax },
      used: s.used || c.used,
    };
  })
    .filter((r) => r.used || r.rate > 0)
    .map(({ used: _used, ...r }) => r);
  const pay = (list: ReportDoc[]) => {
    const m = new Map<string, number>();
    for (const d of list) {
      const t = d.lines.reduce((s, l) => s + cents(l.totAmt), 0);
      m.set(d.pmtTyCd, (m.get(d.pmtTyCd) ?? 0) + t);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, c]) => ({ code, name: PAYMENT_NAME[code] ?? 'OTHER', amount: money(c) }));
  };
  const itemsSold = sales.reduce((s, d) => s + d.lines.reduce((t, l) => t + l.qty, 0), 0);
  return {
    sales: { count: sales.length, total: money(total(sales)) },
    creditNotes: { count: credits.length, total: money(total(credits)) },
    taxByRate,
    itemsSold: Math.round(itemsSold * 1000) / 1000,
    discounts: money(sales.reduce((s, d) => s + d.lines.reduce((t, l) => t + cents(l.dcAmt), 0), 0)),
    paymentsSales: pay(sales),
    paymentsCreditNotes: pay(credits),
    copies: extras.copies,
    training: { count: 0, amount: 0 },
    proforma: { count: 0, amount: 0 },
    openingDeposit: extras.openingDeposit,
    incompleteSales: extras.incomplete,
    manualCreditNotes: extras.manualCreditNotes,
  };
}

export interface PluRow {
  itemCd: string;
  name: string;
  /** Average price per unit actually charged, tax included. */
  unitPrice: number;
  tax: string;
  quantity: number;
  amount: number;
  remaining: number | null;
}

/** The PLU report: every item sold in the period with its quantity and takings (credit notes take theirs off), and what is left in stock. */
export function pluRows(
  docs: ReportDoc[],
  stock: Map<string, number>,
): PluRow[] {
  const rows = new Map<
    string,
    { name: string; qty: number; amount: number; letter: TaxLetter; variantId?: string; rates: Partial<Record<TaxLetter, number>> }
  >();
  for (const d of docs) {
    const sign = d.kind === 'CREDIT' ? -1 : 1;
    for (const l of d.lines) {
      const key = l.itemCd || l.variantId || l.itemNm;
      const r = rows.get(key) ?? {
        name: l.itemNm,
        qty: 0,
        amount: 0,
        letter: letterOf(l.taxTyCd),
        variantId: l.variantId,
        rates: d.rates,
      };
      r.qty += sign * l.qty;
      r.amount += sign * cents(l.totAmt);
      rows.set(key, r);
    }
  }
  return [...rows.entries()]
    .map(([itemCd, r]) => ({
      itemCd,
      name: r.name,
      unitPrice: r.qty !== 0 ? Math.round((r.amount / r.qty)) / 100 : 0,
      tax: taxLabel(r.letter, r.rates[r.letter] ?? 0),
      quantity: Math.round(r.qty * 1000) / 1000,
      amount: money(r.amount),
      remaining: r.variantId && stock.has(r.variantId) ? (stock.get(r.variantId) as number) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
