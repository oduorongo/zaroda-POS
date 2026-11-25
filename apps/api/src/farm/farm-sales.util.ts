const r2 = (n: number) => Math.round(n * 100) / 100;

export interface LedgerEntry {
  date: string;
  kind: 'DELIVERY' | 'PAYMENT';
  amount: number;
}

/** A buyer's statement: opening balance, each delivery and payment in date order with the running balance, and closing. */
export function statement(entries: LedgerEntry[], from: string) {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'DELIVERY' ? -1 : 1));
  const before = sorted.filter((e) => e.date < from);
  const opening = r2(before.reduce((s, e) => s + (e.kind === 'DELIVERY' ? e.amount : -e.amount), 0));
  let balance = opening;
  const lines = sorted
    .filter((e) => e.date >= from)
    .map((e) => {
      balance = r2(balance + (e.kind === 'DELIVERY' ? e.amount : -e.amount));
      return { ...e, balance };
    });
  return { opening, lines, closing: balance };
}

/**
 * What a buyer owes by age. Payments clear the oldest deliveries first, so what is left is the newest; each unpaid
 * delivery falls into 0-30, 31-60, 61-90 or over 90 days by its date.
 */
export function aging(entries: LedgerEntry[], today: string) {
  const deliveries = entries.filter((e) => e.kind === 'DELIVERY').sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, left: d.amount }));
  let paid = entries.filter((e) => e.kind === 'PAYMENT').reduce((s, e) => s + e.amount, 0);
  for (const d of deliveries) {
    const take = Math.min(d.left, paid);
    d.left -= take;
    paid -= take;
  }
  const out = { current: 0, d31: 0, d61: 0, d90: 0, owed: 0, credit: r2(paid) };
  const t = Date.parse(`${today}T00:00:00Z`);
  for (const d of deliveries) {
    if (d.left <= 0) continue;
    const age = Math.round((t - Date.parse(`${d.date}T00:00:00Z`)) / 86_400_000);
    if (age <= 30) out.current += d.left;
    else if (age <= 60) out.d31 += d.left;
    else if (age <= 90) out.d61 += d.left;
    else out.d90 += d.left;
    out.owed += d.left;
  }
  return { current: r2(out.current), d31: r2(out.d31), d61: r2(out.d61), d90: r2(out.d90), owed: r2(out.owed), credit: out.credit };
}

/** Owed after this delivery, and whether it goes past the buyer's limit (null limit = none). */
export function overLimit(owed: number, amount: number, limit: number | null): boolean {
  return limit !== null && r2(owed + amount) > limit;
}

/** The till may not sell more fit-for-sale milk or eggs than are in stock: withheld produce never enters stock. */
export function tillShortfall(onHand: number, selling: number): number {
  const short = Math.round((selling - onHand) * 1000) / 1000;
  return short > 0 ? short : 0;
}
