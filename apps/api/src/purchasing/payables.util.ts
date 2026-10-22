// The rules of receiving stock and paying suppliers, as plain functions (money in whole cents).

const DAY_MS = 86_400_000;
const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

export type BillStatus = 'OPEN' | 'PARTLY_PAID' | 'PAID' | 'VOID';

/** "GRN-2026-0007": numbered per business per year. */
export const receiptNumber = (year: number, seq: number) =>
  `GRN-${year}-${String(seq).padStart(4, '0')}`;

/** The sequence number in a receipt number of that year, or 0. */
export function receiptSequence(number: string, year: number): number {
  const m = new RegExp(`^GRN-${year}-(\\d+)$`).exec(number);
  return m ? Number.parseInt(m[1], 10) : 0;
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The day a bill falls due: its date plus the supplier's payment terms. */
export function dueDateFor(billDate: string, termsDays: number): string {
  return isoDay(
    new Date(
      Date.parse(`${billDate}T00:00:00Z`) + Math.max(0, termsDays) * DAY_MS,
    ),
  );
}

/** What a bill is, from what it is for and what has been paid. A voided bill stays void. */
export function billStatus(
  total: number,
  paid: number,
  voided = false,
): BillStatus {
  if (voided) return 'VOID';
  if (cents(paid) <= 0) return 'OPEN';
  return cents(paid) >= cents(total) ? 'PAID' : 'PARTLY_PAID';
}

export const outstanding = (total: number, paid: number): number =>
  Math.max(0, money(cents(total) - cents(paid)));

/** Why a payment cannot be taken against a bill, or null. */
export function paymentProblem(
  bill: { total: number; amountPaid: number; status: string },
  amount: number,
): string | null {
  if (bill.status === 'VOID')
    return 'This bill was cancelled, so it cannot be paid';
  if (bill.status === 'PAID') return 'This bill is already fully paid';
  if (!(amount > 0)) return 'Enter an amount above zero';
  const left = outstanding(bill.total, bill.amountPaid);
  if (cents(amount) > cents(left))
    return `Only KES ${left.toFixed(2)} is still owed on this bill`;
  return null;
}

export type AgeBucket = 'NOT_DUE' | 'DAYS_1_30' | 'DAYS_31_60' | 'DAYS_61_PLUS';

/** How far past due a bill is on a given day. */
export function ageBucket(dueDate: string, today: string): AgeBucket {
  const late = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) /
      DAY_MS,
  );
  if (late <= 0) return 'NOT_DUE';
  if (late <= 30) return 'DAYS_1_30';
  if (late <= 60) return 'DAYS_31_60';
  return 'DAYS_61_PLUS';
}

export interface AgingRow {
  supplierId: string;
  supplierName: string;
  notDue: number;
  days1to30: number;
  days31to60: number;
  days61plus: number;
  total: number;
  bills: number;
}

/** Owed to each supplier, by how late it is. Voided and fully paid bills are left out. */
export function agePayables(
  bills: {
    supplierId: string;
    supplierName: string;
    dueDate: string;
    total: number;
    amountPaid: number;
    status: string;
  }[],
  today: string,
): { rows: AgingRow[]; totals: Omit<AgingRow, 'supplierId' | 'supplierName'> } {
  const by = new Map<
    string,
    { row: AgingRow; c: [number, number, number, number] }
  >();
  for (const b of bills) {
    if (b.status === 'VOID' || b.status === 'PAID') continue;
    const left = cents(b.total) - cents(b.amountPaid);
    if (left <= 0) continue;
    const entry = by.get(b.supplierId) ?? {
      row: {
        supplierId: b.supplierId,
        supplierName: b.supplierName,
        notDue: 0,
        days1to30: 0,
        days31to60: 0,
        days61plus: 0,
        total: 0,
        bills: 0,
      },
      c: [0, 0, 0, 0],
    };
    const bucket = ageBucket(b.dueDate, today);
    entry.c[
      bucket === 'NOT_DUE'
        ? 0
        : bucket === 'DAYS_1_30'
          ? 1
          : bucket === 'DAYS_31_60'
            ? 2
            : 3
    ] += left;
    entry.row.bills += 1;
    by.set(b.supplierId, entry);
  }
  const rows = [...by.values()]
    .map(({ row, c }) => ({
      ...row,
      notDue: money(c[0]),
      days1to30: money(c[1]),
      days31to60: money(c[2]),
      days61plus: money(c[3]),
      total: money(c[0] + c[1] + c[2] + c[3]),
    }))
    .sort(
      (a, b) =>
        b.total - a.total || a.supplierName.localeCompare(b.supplierName),
    );
  const sum = (pick: (r: AgingRow) => number) =>
    money(rows.reduce((s, r) => s + cents(pick(r)), 0));
  return {
    rows,
    totals: {
      notDue: sum((r) => r.notDue),
      days1to30: sum((r) => r.days1to30),
      days31to60: sum((r) => r.days31to60),
      days61plus: sum((r) => r.days61plus),
      total: sum((r) => r.total),
      bills: rows.reduce((s, r) => s + r.bills, 0),
    },
  };
}

export interface MarginWarning {
  variantId: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  marginPercent: number;
  /** The old cost, when this delivery moved it by 5% or more. */
  previousCost: number | null;
  reason: 'BELOW_MINIMUM' | 'LOSS' | 'COST_UP';
}

/**
 * Whether a delivery's cost leaves the selling price too thin: a loss, a margin under the minimum, or a cost that jumped. The
 * margin is (price - cost) / price. Nothing is blocked - the person receiving is told, so the price can be fixed.
 */
export function marginWarning(input: {
  variantId: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  previousCost: number | null;
  minMarginPercent: number;
}): MarginWarning | null {
  if (!(input.price > 0) || !(input.cost >= 0)) return null;
  const marginPercent =
    Math.round(((input.price - input.cost) / input.price) * 10000) / 100;
  const jumped =
    input.previousCost !== null &&
    input.previousCost > 0 &&
    input.cost >= input.previousCost * 1.05;
  const base = {
    variantId: input.variantId,
    sku: input.sku,
    name: input.name,
    price: input.price,
    cost: input.cost,
    marginPercent,
    previousCost: jumped ? input.previousCost : null,
  };
  if (input.cost > input.price) return { ...base, reason: 'LOSS' };
  if (marginPercent < input.minMarginPercent)
    return { ...base, reason: 'BELOW_MINIMUM' };
  if (jumped) return { ...base, reason: 'COST_UP' };
  return null;
}

/** What a receipt is worth: accepted quantity x the price paid, line by line, rounded once per line. Null when a line has no price. */
export function receiptValue(
  lines: { quantityAccepted: number; unitCost: number | null | undefined }[],
): number | null {
  let total = 0;
  for (const l of lines) {
    if (l.quantityAccepted <= 0) continue;
    if (l.unitCost === null || l.unitCost === undefined) return null;
    total += Math.round(l.quantityAccepted * cents(l.unitCost));
  }
  return money(total);
}
