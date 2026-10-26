// Retention: a share of an invoice the school holds back until a date (a defects period, practical completion). Until it is released
// it is not due: the school owes the rest now, and the retained part separately. Plain functions, tested without a database.

import { addDays } from './school-money.util';
import { fromCents, toCents } from './school-money.util';

/** What a percentage of an invoice comes to, in whole cents (0 when there is no retention). */
export function retentionFor(total: number, percent: number): number {
  if (!(percent > 0)) return 0;
  return fromCents(Math.min(toCents(total), Math.round((toCents(total) * percent) / 100)));
}

export interface InvoiceMoney {
  total: number;
  paid: number;
  credited: number;
  /** Written off as a bad debt (taken off what is owed). */
  writtenOff?: number;
  /** What is still held back as retention. */
  retentionHeld?: number;
}

/**
 * Where an invoice stands: everything still outstanding, how much of that is retention (not due yet), what is due now, and any
 * excess that was paid or credited beyond the total (credit on the school's account). Payments, credit notes and write-offs
 * settle what is due now first; if they go beyond it they eat into the retention.
 */
export function invoicePosition(m: InvoiceMoney) {
  const settled = toCents(m.paid) + toCents(m.credited) + toCents(m.writtenOff ?? 0);
  const total = toCents(m.total);
  const outstanding = Math.max(0, total - settled);
  const retention = Math.min(toCents(m.retentionHeld ?? 0), outstanding);
  return {
    outstanding: fromCents(outstanding),
    retention: fromCents(retention),
    dueNow: fromCents(outstanding - retention),
    surplus: fromCents(Math.max(0, settled - total)),
  };
}

/** What stops a release: more than is held, or nothing. */
export function releaseProblem(amount: number, retention: number): string | null {
  if (!(amount > 0)) return 'Enter how much to release';
  if (toCents(amount) > toCents(retention))
    return `Only ${retention.toFixed(2)} is held back on this invoice`;
  return null;
}

/**
 * When released retention falls due. The invoice's own due date may be long past by now, which would make the released amount
 * late the moment it is released; it is given the school's credit days from the release instead.
 */
export function dueDateAfterRelease(
  currentDue: string,
  today: string,
  creditDays: number,
): string {
  const fresh = addDays(today, creditDays);
  return currentDue > fresh ? currentDue : fresh;
}

/** Retention whose release date has come but is still held. */
export const releaseIsDue = (
  releaseDate: string | null,
  retention: number,
  today: string,
): boolean => releaseDate !== null && retention > 0 && releaseDate <= today;
