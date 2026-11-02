// Aged debtors and creditors: who owes (or is owed) what, by how late it is. Plain functions on cents.

const DAY = 86_400_000;

/** One document still owed: an invoice, a bill, a certificate, or retention held (not yet due). */
export interface OwedDoc {
  party: string;
  kind: string;
  reference: string;
  date: string;
  /** null for retention: held until release, never overdue. */
  dueDate: string | null;
  owedCents: number;
}

export const BUCKETS = ['notDue', 'days1to30', 'days31to60', 'days61to90', 'days90plus', 'retention'] as const;
export type Bucket = (typeof BUCKETS)[number];

export const daysLate = (dueDate: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / DAY);

export function bucketOf(dueDate: string | null, today: string): Bucket {
  if (dueDate === null) return 'retention';
  const late = daysLate(dueDate, today);
  if (late <= 0) return 'notDue';
  if (late <= 30) return 'days1to30';
  if (late <= 60) return 'days31to60';
  if (late <= 90) return 'days61to90';
  return 'days90plus';
}

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

type Amounts = Record<Bucket, number> & { total: number };
const zero = (): Amounts => ({ notDue: 0, days1to30: 0, days31to60: 0, days61to90: 0, days90plus: 0, retention: 0, total: 0 });

/** Totals per party (largest first) and overall, plus every document with how late it is. Nothing owed is left out. */
export function ageOwed(docs: OwedDoc[], today: string) {
  const parties = new Map<string, Amounts & { party: string; documents: number }>();
  const totals = zero();
  const documents = docs
    .filter((d) => d.owedCents > 0)
    .map((d) => {
      const bucket = bucketOf(d.dueDate, today);
      const p = parties.get(d.party) ?? { ...zero(), party: d.party, documents: 0 };
      p[bucket] += d.owedCents;
      p.total += d.owedCents;
      p.documents += 1;
      parties.set(d.party, p);
      totals[bucket] += d.owedCents;
      totals.total += d.owedCents;
      return { ...d, bucket, daysLate: d.dueDate === null ? null : Math.max(0, daysLate(d.dueDate, today)) };
    })
    .sort((a, b) => (b.daysLate ?? -1) - (a.daysLate ?? -1) || a.party.localeCompare(b.party));
  const rows = [...parties.values()].sort((a, b) => b.total - a.total || a.party.localeCompare(b.party));
  return { rows, totals, documents };
}
