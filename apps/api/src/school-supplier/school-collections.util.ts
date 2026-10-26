// Chasing unpaid school invoices: how late one is, whether a promise to pay has been broken, and what a follow-up note must contain.
// Plain functions, tested without a database.

import { daysBetween } from './school-money.util';

/** Days past the due date (0 when not yet due). */
export const daysLate = (dueDate: string, today: string): number =>
  Math.max(0, daysBetween(dueDate, today));

/** The school promised a date and it has gone by with the invoice still unpaid. */
export const promiseBroken = (
  expectedPaymentDate: string | null,
  today: string,
): boolean => expectedPaymentDate !== null && expectedPaymentDate < today;

export interface FollowUpInput {
  expectedPaymentDate?: string | null;
  disputed?: boolean;
  disputeNote?: string | null;
  note?: string | null;
}

/** What is wrong with a follow-up, if anything: a dispute must say what it is about, and a promise cannot be to pay before the invoice existed. */
export function followUpProblem(
  input: FollowUpInput,
  issueDate: string,
): string | null {
  if (input.disputed && (input.disputeNote ?? '').trim().length < 3)
    return 'Say what the dispute is about';
  if (input.expectedPaymentDate && input.expectedPaymentDate < issueDate)
    return 'The promised date is before the invoice was issued';
  return null;
}

/** Overdue invoices in the order to chase them: the longest overdue first, disputed ones after the others of the same age. */
export function chaseOrder<
  T extends { daysLate: number; disputed: boolean; balance: number },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      b.daysLate - a.daysLate ||
      Number(a.disputed) - Number(b.disputed) ||
      b.balance - a.balance,
  );
}
