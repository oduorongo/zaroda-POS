import { kraTimestamp } from './etims.util';
import {
  Creds,
  KraLine,
  Registrant,
  taxTotals,
  TaxLetter,
  TaxTotals,
} from './etims-sales.util';

// Purchases and stock movements as KRA wants them (spec 3.3.7 purchases, 3.3.8 stock, code 4.15 for the movement types). Plain
// functions, tested without a network.

/** KRA's stock in/out types (spec 4.15). */
export type StockTypeCd =
  '02' | '03' | '04' | '05' | '06' | '11' | '12' | '13' | '14' | '15' | '16';

const MOVES: Record<string, { in?: StockTypeCd; out?: StockTypeCd }> = {
  // a correction either way, and a stock-take's result
  ADJUSTMENT: { in: '06', out: '16' },
  STOCKTAKE: { in: '06', out: '16' },
  // goods thrown away
  WASTE: { in: '06', out: '15' },
  // a transfer between branches: out of one branch's device, into the other's
  TRANSFER: { in: '04', out: '13' },
  // turning one product into another (repacking, production)
  REPACK: { in: '05', out: '14' },
  PRODUCTION: { in: '05', out: '14' },
  // a delivery from a supplier
  RECEIPT: { in: '02', out: '12' },
};

/** The KRA movement type for something that changed stock, or null when it is not reported by this route (sales have their own). */
export function stockTypeFor(type: string, delta: number): StockTypeCd | null {
  const m = MOVES[type];
  if (!m || delta === 0) return null;
  return (delta > 0 ? m.in : m.out) ?? null;
}

export interface MoveRow {
  id: string;
  branchId: string;
  variantId: string;
  type: string;
  quantityDelta: number;
  referenceId: string | null;
  createdAt: Date;
}
export interface MoveGroup {
  /** One group is one document: the same kind of movement, at one branch, for one operation. */
  key: string;
  branchId: string;
  sarTyCd: StockTypeCd;
  at: Date;
  rows: { variantId: string; quantity: number }[];
}

/** Gathers stock-change rows into the movements KRA is told about: one per operation, branch and direction. */
export function groupMoves(rows: MoveRow[]): MoveGroup[] {
  const groups = new Map<string, MoveGroup>();
  for (const r of rows) {
    const sarTyCd = stockTypeFor(r.type, r.quantityDelta);
    if (!sarTyCd) continue;
    // a change with no operation behind it stands alone
    const key = `STOCK:${sarTyCd}:${r.branchId}:${r.referenceId ?? `tx-${r.id}`}`;
    const g = groups.get(key) ?? {
      key,
      branchId: r.branchId,
      sarTyCd,
      at: r.createdAt,
      rows: [],
    };
    const q = Math.abs(r.quantityDelta);
    const existing = g.rows.find((x) => x.variantId === r.variantId);
    if (existing)
      existing.quantity = Math.round((existing.quantity + q) * 1000) / 1000;
    else g.rows.push({ variantId: r.variantId, quantity: q });
    if (r.createdAt < g.at) g.at = r.createdAt;
    groups.set(key, g);
  }
  return [...groups.values()];
}

/** KRA lists dates as "2020-01-27 21:03:00" but wants yyyyMMddHHmmss back. */
export function compactDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, '');
  return digits.length === 14 || digits.length === 8 ? digits : null;
}

export interface InvoiceLine {
  itemSeq: number;
  itemCd: string;
  itemClsCd: string | null;
  itemNm: string;
  bcd: string | null;
  pkgUnitCd: string | null;
  pkg: number;
  qtyUnitCd: string | null;
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
export interface Invoice {
  spplrTin: string;
  spplrNm: string | null;
  spplrBhfId: string;
  spplrInvcNo: number;
  rcptTyCd: string;
  pmtTyCd: string | null;
  cfmDt: string | null;
  salesDt: string | null;
  totAmt: number;
  rates: Record<TaxLetter, number>;
  lines: InvoiceLine[];
}

const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : Number.isFinite(Number(v)) && v !== null && v !== ''
      ? Number(v)
      : 0;
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null;

/** Reads KRA's list of supplier invoices (the saleList in the answer), leaving out anything that is not usable. */
export function parseInvoices(data: unknown): Invoice[] {
  const list = (data as { saleList?: unknown[] } | null)?.saleList;
  if (!Array.isArray(list)) return [];
  const out: Invoice[] = [];
  for (const raw of list) {
    const r = raw as Record<string, unknown>;
    const items = Array.isArray(r.itemList)
      ? (r.itemList as Record<string, unknown>[])
      : [];
    const tin = str(r.spplrTin);
    if (!tin || !(num(r.spplrInvcNo) > 0) || items.length === 0) continue;
    out.push({
      spplrTin: tin,
      spplrNm: str(r.spplrNm),
      spplrBhfId: str(r.spplrBhfId) ?? '00',
      spplrInvcNo: num(r.spplrInvcNo),
      rcptTyCd: str(r.rcptTyCd) ?? 'S',
      pmtTyCd: str(r.pmtTyCd),
      cfmDt: str(r.cfmDt),
      salesDt: str(r.salesDt),
      totAmt: num(r.totAmt),
      rates: Object.fromEntries(
        (['A', 'B', 'C', 'D', 'E'] as TaxLetter[]).map((k) => [
          k,
          num(r[`taxRt${k}`]),
        ]),
      ) as Record<TaxLetter, number>,
      lines: items.map((i, n) => ({
        itemSeq: num(i.itemSeq) || n + 1,
        itemCd: str(i.itemCd) ?? '',
        itemClsCd: str(i.itemClsCd),
        itemNm: str(i.itemNm) ?? 'Item',
        bcd: str(i.bcd),
        pkgUnitCd: str(i.pkgUnitCd),
        pkg: num(i.pkg),
        qtyUnitCd: str(i.qtyUnitCd),
        qty: num(i.qty),
        prc: num(i.prc),
        splyAmt: num(i.splyAmt),
        dcRt: num(i.dcRt),
        dcAmt: num(i.dcAmt),
        taxTyCd: str(i.taxTyCd) ?? 'D',
        taxblAmt: num(i.taxblAmt),
        taxAmt: num(i.taxAmt),
        totAmt: num(i.totAmt),
      })),
    });
  }
  return out;
}

export interface PurchaseLine extends KraLine {
  spplrItemCd: string | null;
  spplrItemClsCd: string | null;
  spplrItemNm: string | null;
}

/**
 * A supplier's invoice line as one of OUR products: the amounts are the supplier's (they are what the supplier told KRA), the item
 * codes are ours, and the supplier's own code and name ride along.
 */
export function purchaseLineFromInvoice(
  line: InvoiceLine,
  ours: {
    variantId: string;
    itemCd: string;
    itemClsCd: string;
    itemTyCd: string;
    itemNm: string;
    bcd: string | null;
    pkgUnitCd: string;
    qtyUnitCd: string;
  },
  seq: number,
): PurchaseLine {
  return {
    itemSeq: seq,
    variantId: ours.variantId,
    itemCd: ours.itemCd,
    itemClsCd: ours.itemClsCd,
    itemTyCd: ours.itemTyCd,
    itemNm: ours.itemNm.slice(0, 200),
    bcd: ours.bcd ? ours.bcd.slice(0, 20) : null,
    pkgUnitCd: ours.pkgUnitCd,
    pkg: line.pkg || line.qty,
    qtyUnitCd: ours.qtyUnitCd,
    qty: line.qty,
    prc: line.prc,
    splyAmt: line.splyAmt,
    dcRt: line.dcRt,
    dcAmt: line.dcAmt,
    taxTyCd: line.taxTyCd,
    taxblAmt: line.taxblAmt,
    taxAmt: line.taxAmt,
    totAmt: line.totAmt,
    spplrItemCd: line.itemCd.slice(0, 20),
    spplrItemClsCd: line.itemClsCd ? line.itemClsCd.slice(0, 10) : null,
    spplrItemNm: line.itemNm.slice(0, 200),
  };
}

export interface PurchaseBodyInput {
  creds: Creds;
  invcNo: number;
  supplier: {
    tin: string | null;
    bhfId: string | null;
    name: string | null;
    invcNo: number | null;
  };
  /** A = confirming a supplier's eTIMS invoice, M = entered by hand. */
  regTyCd: 'A' | 'M';
  pmtTyCd: string;
  /** When the purchase was confirmed, and the date of the purchase itself (yyyyMMdd). */
  at: Date;
  purchaseDate: string;
  lines: PurchaseLine[];
  totals: TaxTotals;
  registrant: Registrant;
}

/** The /insertTrnsPurchase body (spec 3.3.7.2): a purchase confirmed as approved. */
export function buildPurchaseBody(
  i: PurchaseBodyInput,
): Record<string, unknown> {
  const t = i.totals;
  const regr = {
    regrId: i.registrant.id.slice(0, 20),
    regrNm: i.registrant.name.slice(0, 60),
    modrId: i.registrant.id.slice(0, 20),
    modrNm: i.registrant.name.slice(0, 60),
  };
  return {
    tin: i.creds.tin,
    bhfId: i.creds.bhfId,
    cmcKey: i.creds.cmcKey,
    invcNo: i.invcNo,
    orgInvcNo: 0,
    spplrTin: i.supplier.tin,
    spplrBhfId: i.supplier.bhfId,
    spplrNm: i.supplier.name ? i.supplier.name.slice(0, 60) : null,
    spplrInvcNo: i.supplier.invcNo,
    regTyCd: i.regTyCd,
    pchsTyCd: 'N',
    rcptTyCd: 'P',
    pmtTyCd: i.pmtTyCd,
    pchsSttsCd: '02',
    cfmDt: kraTimestamp(i.at),
    pchsDt: i.purchaseDate,
    wrhsDt: null,
    cnclReqDt: null,
    cnclDt: null,
    rfdDt: null,
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
    remark: null,
    ...regr,
    itemList: i.lines.map((l) => ({
      itemSeq: l.itemSeq,
      itemCd: l.itemCd,
      itemClsCd: l.itemClsCd,
      itemNm: l.itemNm,
      bcd: l.bcd,
      spplrItemClsCd: l.spplrItemClsCd,
      spplrItemCd: l.spplrItemCd,
      spplrItemNm: l.spplrItemNm,
      pkgUnitCd: l.pkgUnitCd,
      pkg: l.pkg,
      qtyUnitCd: l.qtyUnitCd,
      qty: l.qty,
      prc: l.prc,
      splyAmt: l.splyAmt,
      dcRt: l.dcRt,
      dcAmt: l.dcAmt,
      taxblAmt: l.taxblAmt,
      taxTyCd: l.taxTyCd,
      taxAmt: l.taxAmt,
      totAmt: l.totAmt,
      itemExprDt: null,
    })),
  };
}

/** The totals of a purchase's lines, by tax type. */
export const purchaseTotals = (
  lines: PurchaseLine[],
  rates: Partial<Record<TaxLetter, number>>,
): TaxTotals => taxTotals(lines, rates);

/** The digits of a delivery note, when it is a plain number (KRA's supplier invoice number is a number). */
export function invoiceNumberFrom(
  text: string | null | undefined,
): number | null {
  const t = (text ?? '').trim();
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}
