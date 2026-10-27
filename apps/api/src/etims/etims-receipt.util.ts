// What goes on a KRA receipt (TIS specification v2.0, April 2023, articles 6.23, 13 and 14), worked out from what was sent to KRA and
// what KRA answered. Plain functions, tested without a database. Amounts stay as sent: KRA's sample receipts show every figure
// with the tax in it, and the tax table shows the amount WITHOUT tax per rate, so that is worked out here.

import { TAX_LETTERS, TaxLetter } from './etims-sales.util';

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

/** Groups of four characters separated by dashes: "TE68-SLA2-34J5" (the internal data and signature on a receipt). */
export function dashed(value: string | null | undefined): string {
  return (value ?? '').replace(/[\s-]/g, '').replace(/(.{4})(?=.)/g, '$1-');
}

export interface KraDateTime {
  /** dd/mm/yyyy */
  date: string;
  /** hh:mm:ss */
  time: string;
  /** ddmmyyyy */
  dateCompact: string;
  /** hhmmss */
  timeCompact: string;
}

/** KRA answers with YYYYMMDDHHmmss; a receipt shows dd/mm/yyyy and hh:mm:ss. Null when it is not that shape. */
export function parseKraDateTime(raw: string | null | undefined): KraDateTime | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec((raw ?? '').trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return {
    date: `${d}/${mo}/${y}`,
    time: `${h}:${mi}:${s}`,
    dateCompact: `${d}${mo}${y}`,
    timeCompact: `${h}${mi}${s}`,
  };
}

/** The QR code's text, as the specification gives it (6.23.8): date#time#CU number#CU receipt number#internal data#signature. */
export function qrText(m: {
  when: KraDateTime;
  scuId: string;
  receiptNo: number;
  internalData: string;
  signature: string;
}): string {
  return [
    m.when.dateCompact,
    m.when.timeCompact,
    m.scuId,
    String(m.receiptNo),
    m.internalData,
    m.signature,
  ].join('#');
}

/** What each tax letter stands for on a receipt (the specification's sample: EX, 16%, 0%, Non-VAT, 8%). */
export function taxLabel(letter: TaxLetter, rate: number): string {
  if (letter === 'A') return 'EX';
  if (letter === 'D') return 'Non-VAT';
  return `${Number(rate)}%`;
}

export interface ReceiptLineIn {
  itemNm: string;
  qty: number;
  /** Price per unit, tax included (as sent to KRA). */
  prc: number;
  /** Before discount. */
  splyAmt: number;
  dcAmt: number;
  dcRt: number;
  taxTyCd: string;
  taxAmt: number;
  /** After discount, tax included. */
  totAmt: number;
}

export interface ReceiptIn {
  /** SALE or CREDIT. */
  kind: 'SALE' | 'CREDIT';
  /** A reprint: marked as a copy, never as the original. */
  copy: boolean;
  business: { name: string; address: string | null; pin: string | null };
  buyerPin: string | null;
  lines: ReceiptLineIn[];
  rates: Partial<Record<TaxLetter, number>>;
  payment: { label: string };
  scu: {
    scuId: string;
    receiptNo: number;
    totalReceiptNo: number | null;
    internalData: string;
    signature: string;
    at: string;
  };
  tis: { receiptNumber: string; at: Date };
  /** For a credit note: the CU invoice number of the sale it reverses. */
  originalCuInvoiceNo: string | null;
}

export interface TaxRow {
  letter: TaxLetter;
  label: string;
  rate: number;
  /** Amount without tax. */
  taxable: number;
  tax: number;
}

/**
 * The receipt, ready to print. A credit note has every amount negative (14). The tax table has a row for every rate above 0 on every
 * receipt, and a row for a rate of 0 only when an item used it (6.21, 6.22).
 */
export function buildReceipt(i: ReceiptIn) {
  const sign = i.kind === 'CREDIT' ? -1 : 1;
  const s = (n: number) => money(sign * cents(n));
  const when = parseKraDateTime(i.scu.at);
  const lines = i.lines.map((l) => ({
    name: l.itemNm,
    unitPrice: money(cents(l.prc)),
    quantity: l.qty,
    amount: s(l.splyAmt),
    taxLetter: TAX_LETTERS.includes(l.taxTyCd as TaxLetter) ? l.taxTyCd : 'D',
    discount: l.dcAmt > 0 ? { rate: l.dcRt, amount: -money(sign * cents(l.dcAmt)) } : null,
    total: s(l.totAmt),
  }));
  const beforeDiscount = i.lines.reduce((t, l) => t + cents(l.splyAmt), 0);
  const discount = i.lines.reduce((t, l) => t + cents(l.dcAmt), 0);
  const total = i.lines.reduce((t, l) => t + cents(l.totAmt), 0);
  const vat = i.lines.reduce((t, l) => t + cents(l.taxAmt), 0);
  const rows: TaxRow[] = TAX_LETTERS.map((letter) => {
    const mine = i.lines.filter((l) => l.taxTyCd === letter);
    const gross = mine.reduce((t, l) => t + cents(l.totAmt), 0);
    const tax = mine.reduce((t, l) => t + cents(l.taxAmt), 0);
    return {
      letter,
      label: taxLabel(letter, i.rates[letter] ?? 0),
      rate: i.rates[letter] ?? 0,
      taxable: money(sign * (gross - tax)),
      tax: money(sign * tax),
      used: mine.length > 0,
    };
  })
    .filter((r) => r.used || r.rate > 0)
    .map(({ used: _used, ...r }) => r);
  const cuInvoiceNo = `${i.scu.scuId}/${i.scu.receiptNo}`;
  return {
    title: i.kind === 'CREDIT' ? 'CREDIT NOTE' : 'TAX INVOICE',
    kind: i.kind,
    copy: i.copy,
    /** What must be printed large under the header and as a watermark on a reprint (11). */
    copyNotice: i.copy ? { label: 'COPY', note: 'THIS IS NOT AN OFFICIAL RECEIPT' } : null,
    business: i.business,
    buyerPin: i.buyerPin,
    originalCuInvoiceNo: i.originalCuInvoiceNo,
    creditNote:
      i.kind === 'CREDIT' ? 'CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT' : null,
    lines,
    itemsNumber: lines.length,
    totals: {
      beforeDiscount: money(sign * beforeDiscount),
      discount: discount > 0 ? -money(sign * discount) : 0,
      subTotal: money(sign * (total - vat)),
      vat: money(sign * vat),
      total: money(sign * total),
    },
    payment: { label: i.payment.label, amount: money(sign * total) },
    taxTable: rows,
    scu: {
      date: when?.date ?? null,
      time: when?.time ?? null,
      scuId: i.scu.scuId,
      cuInvoiceNo: i.kind === 'CREDIT' ? `${cuInvoiceNo} NC` : cuInvoiceNo,
      receiptCounter: i.scu.totalReceiptNo
        ? `${i.scu.receiptNo}/${i.scu.totalReceiptNo} ${i.kind === 'CREDIT' ? 'NC' : 'NS'}`
        : null,
      internalData: dashed(i.scu.internalData),
      signature: dashed(i.scu.signature),
      qr: when
        ? qrText({
            when,
            scuId: i.scu.scuId,
            receiptNo: i.scu.receiptNo,
            internalData: i.scu.internalData,
            signature: i.scu.signature,
          })
        : null,
    },
    tis: {
      receiptNumber: i.tis.receiptNumber,
      date: ddmmyyyy(i.tis.at),
      time: hhmmss(i.tis.at),
    },
  };
}

const nairobi = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString();
export const ddmmyyyy = (d: Date) => {
  const iso = nairobi(d);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};
export const hhmmss = (d: Date) => nairobi(d).slice(11, 19);
