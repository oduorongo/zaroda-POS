// Bad debts: an estimate of what schools will not pay (the provision), and writing off what will not be recovered. Plain functions,
// tested without a database.

import { fromCents, toCents } from './school-money.util';

export type Band = 'D1_30' | 'D31_60' | 'D61_90' | 'D91_180' | 'D181_PLUS';

export const BANDS: { key: Band; label: string }[] = [
  { key: 'D1_30', label: '1-30 days overdue' },
  { key: 'D31_60', label: '31-60 days overdue' },
  { key: 'D61_90', label: '61-90 days overdue' },
  { key: 'D91_180', label: '91-180 days overdue' },
  { key: 'D181_PLUS', label: 'Over 180 days overdue' },
];

/** The percentage of each band set aside as the estimate of what will not be paid. */
export type Rates = Record<Band, number>;

export const DEFAULT_RATES: Rates = {
  D1_30: 1,
  D31_60: 5,
  D61_90: 20,
  D91_180: 50,
  D181_PLUS: 100,
};

/** Which band an invoice that many days past its due date falls in (null while it is not yet late). */
export function bandFor(daysOverdue: number): Band | null {
  if (daysOverdue < 1) return null;
  if (daysOverdue <= 30) return 'D1_30';
  if (daysOverdue <= 60) return 'D31_60';
  if (daysOverdue <= 90) return 'D61_90';
  if (daysOverdue <= 180) return 'D91_180';
  return 'D181_PLUS';
}

/** A rate must be 0-100, and an older debt cannot be set aside at a lower rate than a newer one. */
export function ratesProblem(rates: Rates): string | null {
  let previous = 0;
  for (const { key, label } of BANDS) {
    const r = rates[key];
    if (!(r >= 0 && r <= 100)) return `The rate for ${label.toLowerCase()} must be between 0 and 100`;
    if (r < previous)
      return `The rate for ${label.toLowerCase()} cannot be lower than for a newer debt`;
    previous = r;
  }
  return null;
}

export interface Owed {
  /** What is due now (retention not yet released is not counted: it is not due). */
  amount: number;
  daysOverdue: number;
}

/** The provision for a set of overdue amounts: what falls in each band and the share set aside. */
export function provisionFor(items: Owed[], rates: Rates) {
  const byBand = BANDS.map(({ key, label }) => {
    const cents = items
      .filter((i) => bandFor(i.daysOverdue) === key)
      .reduce((s, i) => s + toCents(i.amount), 0);
    const provision = Math.round((cents * rates[key]) / 100);
    return {
      band: key,
      label,
      rate: rates[key],
      amount: fromCents(cents),
      provision: fromCents(provision),
    };
  });
  return {
    overdue: fromCents(byBand.reduce((s, b) => s + toCents(b.amount), 0)),
    total: fromCents(byBand.reduce((s, b) => s + toCents(b.provision), 0)),
    byBand,
  };
}

/** What stops a write-off: nothing, or more than is outstanding. */
export function writeOffProblem(amount: number, outstanding: number): string | null {
  if (!(amount > 0)) return 'Enter how much to write off';
  if (toCents(amount) > toCents(outstanding))
    return `Only ${outstanding.toFixed(2)} is still owed on this invoice`;
  return null;
}

/** A write-off this size or more needs a second person to approve it (a threshold of 0 means every one does). */
export const needsApproval = (amount: number, threshold: number): boolean =>
  toCents(amount) >= toCents(threshold);

export type ApprovalResult =
  | { ok: true; overridden: boolean }
  | { ok: false; problem: string };

/**
 * Who may approve a write-off: anyone allowed to, other than the person who asked for it. An owner who is the only one there
 * can approve their own, but must say why; that is recorded as an override.
 */
export function approvalCheck(m: {
  requesterId: string;
  approverId: string;
  approverIsOwner: boolean;
  overrideReason?: string | null;
}): ApprovalResult {
  if (m.approverId !== m.requesterId) return { ok: true, overridden: false };
  if (!m.approverIsOwner)
    return {
      ok: false,
      problem: 'Another person must approve a write-off you asked for.',
    };
  if ((m.overrideReason ?? '').trim().length < 5)
    return {
      ok: false,
      problem:
        'To approve your own write-off, say why nobody else can (at least a few words). It will be recorded.',
    };
  return { ok: true, overridden: true };
}
