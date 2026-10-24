import { kraTimestamp } from './etims.util';

// Turning a finished sale into what KRA is sent (spec 3.3.6 sales, 3.3.8 stock). All money is worked in whole cents so the amounts add
// up exactly. KRA's samples show every amount WITH the tax in it (price x quantity = supply amount = taxable amount, and the tax is the
// part of it that is tax); Zaroda stores a price before tax and the tax on top, so each line is converted.

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type TaxLetter = 'A' | 'B' | 'C' | 'D' | 'E';
export const TAX_LETTERS: TaxLetter[] = ['A', 'B', 'C', 'D', 'E'];
/** Used only if KRA's tax list has not been downloaded; the real rates come from that list. */
export const DEFAULT_RATES: Record<TaxLetter, number> = {
  A: 0,
  B: 16,
  C: 0,
  D: 0,
  E: 8,
};

export interface SaleLine {
  variantId: string;
  quantity: number;
  /** Price before tax. */
  unitPrice: number;
  taxAmount: number;
}

export interface LineInfo {
  itemCd: string;
  itemClsCd: string;
  itemTyCd: string;
  itemNm: string;
  bcd: string | null;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: string;
}

export interface KraLine {
  itemSeq: number;
  variantId: string;
  itemCd: string;
  itemClsCd: string;
  itemTyCd: string;
  itemNm: string;
  bcd: string | null;
  pkgUnitCd: string;
  pkg: number;
  qtyUnitCd: string;
  qty: number;
  prc: number;
  splyAmt: number;
  dcRt: number;
  dcAmt: number;
  taxTyCd: string;
  taxblAmt: number;
  taxAmt: number;
  totAmt: number;
}

/** Splits an amount (in cents) between weights, in proportion, adding back up exactly: the odd cents go to the largest remainders. */
export function allocate(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum <= 0 || totalCents === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / sum);
  const out = raw.map(Math.floor);
  let left = totalCents - out.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--)
    out[order[k].i] += 1;
  return out;
}

export class SaleDoesNotAddUp extends Error {}

/**
 * The sale's lines as KRA wants them. `saleTotal` is what the customer was charged. Whatever was taken off the items' own total (a
 * discount, points redeemed) is shared between the lines in proportion to their value, and the tax inside each line is reduced the
 * same way, so the lines add up to exactly what was paid.
 */
export function buildLines(
  lines: SaleLine[],
  infos: LineInfo[],
  saleTotal: number,
): KraLine[] {
  const gross = lines.map(
    (l) => cents(l.unitPrice * l.quantity) + cents(l.taxAmount),
  );
  const grossSum = gross.reduce((a, b) => a + b, 0);
  const reduction = grossSum - cents(saleTotal);
  if (reduction < 0)
    throw new SaleDoesNotAddUp(
      `The sale total (${saleTotal.toFixed(2)}) is more than its items add up to (${money(grossSum).toFixed(2)})`,
    );
  const dc = allocate(reduction, gross);
  return lines.map((l, i) => {
    const info = infos[i];
    const net = gross[i] - dc[i];
    const taxCents =
      gross[i] === 0 ? 0 : Math.round((cents(l.taxAmount) * net) / gross[i]);
    const qty = Number(l.quantity.toFixed(2));
    return {
      itemSeq: i + 1,
      variantId: l.variantId,
      itemCd: info.itemCd,
      itemClsCd: info.itemClsCd,
      itemTyCd: info.itemTyCd,
      itemNm: info.itemNm.slice(0, 200),
      bcd: info.bcd ? info.bcd.slice(0, 20) : null,
      pkgUnitCd: info.pkgUnitCd,
      pkg: qty,
      qtyUnitCd: info.qtyUnitCd,
      qty,
      prc: qty > 0 ? round2(gross[i] / 100 / qty) : 0,
      splyAmt: money(gross[i]),
      dcRt: gross[i] === 0 ? 0 : round2((dc[i] / gross[i]) * 100),
      dcAmt: money(dc[i]),
      taxTyCd: info.taxTyCd,
      taxblAmt: money(net),
      taxAmt: money(Math.min(taxCents, net)),
      totAmt: money(net),
    };
  });
}

export interface TaxTotals {
  taxblAmt: Record<TaxLetter, number>;
  taxAmt: Record<TaxLetter, number>;
  taxRt: Record<TaxLetter, number>;
  totTaxblAmt: number;
  totTaxAmt: number;
  totAmt: number;
}

/** The totals KRA wants, by tax type A to E and overall. */
export function taxTotals(
  lines: Pick<KraLine, 'taxTyCd' | 'taxblAmt' | 'taxAmt' | 'totAmt'>[],
  rates: Partial<Record<TaxLetter, number>> = DEFAULT_RATES,
): TaxTotals {
  const blank = (): Record<TaxLetter, number> => ({
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  });
  const taxbl = blank();
  const tax = blank();
  let tot = 0;
  for (const l of lines) {
    const k = (
      TAX_LETTERS.includes(l.taxTyCd as TaxLetter) ? l.taxTyCd : 'D'
    ) as TaxLetter;
    taxbl[k] += cents(l.taxblAmt);
    tax[k] += cents(l.taxAmt);
    tot += cents(l.totAmt);
  }
  const out = (r: Record<TaxLetter, number>) =>
    Object.fromEntries(TAX_LETTERS.map((k) => [k, money(r[k])])) as Record<
      TaxLetter,
      number
    >;
  return {
    taxblAmt: out(taxbl),
    taxAmt: out(tax),
    taxRt: Object.fromEntries(
      TAX_LETTERS.map((k) => [k, rates[k] ?? DEFAULT_RATES[k]]),
    ) as Record<TaxLetter, number>,
    totTaxblAmt: money(TAX_LETTERS.reduce((s, k) => s + taxbl[k], 0)),
    totTaxAmt: money(TAX_LETTERS.reduce((s, k) => s + tax[k], 0)),
    totAmt: money(tot),
  };
}

/** KRA's payment code (spec 4.11) for how the sale was paid: the way most of the money came in. */
export function paymentCode(
  payments: { method: string; amount: number }[],
): string {
  if (payments.length === 0) return '01';
  const byMethod = new Map<string, number>();
  for (const p of payments)
    byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + cents(p.amount));
  const main = [...byMethod.entries()].sort((a, b) => b[1] - a[1])[0][0];
  switch (main) {
    case 'CASH':
      return '01';
    case 'ROOM_CHARGE':
    case 'ACCOUNT':
      return '02';
    case 'CARD':
      return '05';
    case 'MPESA':
    case 'MPESA_RECEIPT':
    case 'WALLET':
      return '06';
    default:
      return '07';
  }
}

export interface Creds {
  tin: string;
  bhfId: string;
  cmcKey: string;
}
export interface Registrant {
  id: string;
  name: string;
}

const regr = (r: Registrant) => ({
  regrId: r.id.slice(0, 20),
  regrNm: r.name.slice(0, 60),
  modrId: r.id.slice(0, 20),
  modrNm: r.name.slice(0, 60),
});

function itemList(lines: KraLine[]) {
  return lines.map((l) => ({
    itemSeq: l.itemSeq,
    itemCd: l.itemCd,
    itemClsCd: l.itemClsCd,
    itemNm: l.itemNm,
    bcd: l.bcd,
    pkgUnitCd: l.pkgUnitCd,
    pkg: l.pkg,
    qtyUnitCd: l.qtyUnitCd,
    qty: l.qty,
    prc: l.prc,
    splyAmt: l.splyAmt,
    dcRt: l.dcRt,
    dcAmt: l.dcAmt,
    isrccCd: null,
    isrccNm: null,
    isrcRt: null,
    isrcAmt: null,
    taxTyCd: l.taxTyCd,
    taxblAmt: l.taxblAmt,
    taxAmt: l.taxAmt,
    totAmt: l.totAmt,
  }));
}

export interface SalesBodyInput {
  creds: Creds;
  invcNo: number;
  /** Our own reference for the sale or refund (the sale's id). */
  trdInvcNo: string;
  /** 0 for a sale; the original invoice number for a credit note. */
  orgInvcNo: number;
  credit: { at: Date; reasonCd: string } | null;
  at: Date;
  customerName: string | null;
  customerPhone: string | null;
  pmtTyCd: string;
  lines: KraLine[];
  totals: TaxTotals;
  registrant: Registrant;
  business: { name: string; address: string | null };
}

/** The /saveTrnsSalesOsdc body (spec 3.3.6.1): a sale, or - with `credit` - the credit note that reverses one. */
export function buildSalesBody(i: SalesBodyInput): Record<string, unknown> {
  const stamp = kraTimestamp(i.at);
  const t = i.totals;
  return {
    tin: i.creds.tin,
    bhfId: i.creds.bhfId,
    cmcKey: i.creds.cmcKey,
    trdInvcNo: i.trdInvcNo.slice(0, 50),
    invcNo: i.invcNo,
    orgInvcNo: i.orgInvcNo,
    custTin: null,
    custNm: i.customerName ? i.customerName.slice(0, 60) : null,
    salesTyCd: 'N',
    rcptTyCd: i.credit ? 'R' : 'S',
    pmtTyCd: i.pmtTyCd,
    salesSttsCd: i.credit ? '05' : '02',
    cfmDt: stamp,
    salesDt: stamp.slice(0, 8),
    stockRlsDt: stamp,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: i.credit ? kraTimestamp(i.credit.at) : null,
    rfdRsnCd: i.credit ? i.credit.reasonCd : null,
    totItemCnt: i.lines.length,
    taxblAmtA: t.taxblAmt.A,
    taxblAmtB: t.taxblAmt.B,
    taxblAmtC: t.taxblAmt.C,
    taxblAmtD: t.taxblAmt.D,
    taxblAmtE: t.taxblAmt.E,
    taxRtA: t.taxRt.A,
    taxRtB: t.taxRt.B,
    taxRtC: t.taxRt.C,
    taxRtD: t.taxRt.D,
    taxRtE: t.taxRt.E,
    taxAmtA: t.taxAmt.A,
    taxAmtB: t.taxAmt.B,
    taxAmtC: t.taxAmt.C,
    taxAmtD: t.taxAmt.D,
    taxAmtE: t.taxAmt.E,
    totTaxblAmt: t.totTaxblAmt,
    totTaxAmt: t.totTaxAmt,
    totAmt: t.totAmt,
    prchrAcptcYn: 'N',
    remark: null,
    ...regr(i.registrant),
    receipt: {
      custTin: null,
      custMblNo: i.customerPhone ? i.customerPhone.slice(0, 20) : null,
      rcptPbctDt: stamp,
      trdeNm: i.business.name.slice(0, 20),
      adrs: i.business.address ? i.business.address.slice(0, 200) : null,
      topMsg: null,
      btmMsg: null,
      prchrAcptcYn: 'N',
    },
    itemList: itemList(i.lines),
  };
}

/** Only things that are kept in stock are reported in the stock movement: not services. */
export const tracksStock = (l: Pick<KraLine, 'itemTyCd'>): boolean =>
  l.itemTyCd === '1' || l.itemTyCd === '2';

/** The /insertStockIO body (spec 3.3.8.2). `sarTyCd` is "11" for a sale going out and "03" for a refund coming back in (spec 4.15). */
export function buildStockIoBody(input: {
  creds: Creds;
  sarNo: number;
  sarTyCd: '11' | '03';
  at: Date;
  lines: KraLine[];
  registrant: Registrant;
}): Record<string, unknown> {
  const lines = input.lines.filter(tracksStock);
  const t = taxTotals(lines);
  return {
    tin: input.creds.tin,
    bhfId: input.creds.bhfId,
    cmcKey: input.creds.cmcKey,
    sarNo: input.sarNo,
    orgSarNo: input.sarNo,
    regTyCd: 'A',
    custTin: null,
    custNm: null,
    custBhfId: null,
    sarTyCd: input.sarTyCd,
    ocrnDt: kraTimestamp(input.at).slice(0, 8),
    totItemCnt: lines.length,
    totTaxblAmt: t.totTaxblAmt,
    totTaxAmt: t.totTaxAmt,
    totAmt: t.totAmt,
    remark: null,
    ...regr(input.registrant),
    itemList: lines.map((l, i) => ({
      itemSeq: i + 1,
      itemCd: l.itemCd,
      itemClsCd: l.itemClsCd,
      itemNm: l.itemNm,
      bcd: l.bcd,
      pkgUnitCd: l.pkgUnitCd,
      pkg: l.pkg,
      qtyUnitCd: l.qtyUnitCd,
      qty: l.qty,
      itemExprDt: null,
      prc: l.prc,
      splyAmt: l.splyAmt,
      totDcAmt: l.dcAmt,
      taxblAmt: l.taxblAmt,
      taxTyCd: l.taxTyCd,
      taxAmt: l.taxAmt,
      totAmt: l.totAmt,
    })),
  };
}

/** The /saveStockMaster body (spec 3.3.8.3): how many of an item are left in stock now. */
export function buildStockMasterBody(
  creds: Creds,
  itemCd: string,
  remaining: number,
  registrant: Registrant,
): Record<string, unknown> {
  return {
    tin: creds.tin,
    bhfId: creds.bhfId,
    cmcKey: creds.cmcKey,
    itemCd,
    rsdQty: Math.max(0, round2(remaining)),
    ...regr(registrant),
  };
}

/** Why a sale cannot go to KRA by itself, or null: every line must be a product KRA has. */
export function unsendableReason(
  lines: SaleLine[],
  infos: (LineInfo | null)[],
  names: string[],
): string | null {
  const missing = lines
    .map((_, i) => (infos[i] ? null : names[i]))
    .filter((n): n is string => n !== null);
  return missing.length === 0
    ? null
    : `Not registered with KRA yet: ${[...new Set(missing)].slice(0, 5).join(', ')}${new Set(missing).size > 5 ? '...' : ''}`;
}

/** How long to wait before the next try after `attempts` failures: 1, 2, 4... minutes, never more than an hour. */
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** Math.max(0, attempts - 1));
}
