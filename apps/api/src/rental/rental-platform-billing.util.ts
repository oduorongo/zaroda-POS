import { randomInt } from 'crypto';
import { monthBounds, monthOf } from '../online-store/commission.util';
import { RentalBillingCycle, RentalPlanDef } from './rental-plans.util';

/**
 * What ZARODA bills a landlord for the rental plan - pure rules, no database. Months are Nairobi calendar months
 * ("2026-11"), the same convention as the shop commission billing.
 */
export { monthBounds, monthOf };

export type PlatformInvoiceKind = 'SUBSCRIPTION' | 'COLLECTION_FEE';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Issued on the 1st, due on the 15th. */
export const DUE_DAY_OF_MONTH = 15;
/** A late-issued invoice (the server was down on the 1st) still gets this long to pay before the account locks. */
export const MIN_DAYS_TO_PAY = 7;

/** "2026-10" for "2026-11". */
export function previousMonth(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const d = new Date(Date.UTC(year, mon - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The 1st of a month as a plain date (UTC midnight), the form the lease dates are stored in. */
export function firstOfMonthDate(month: string): Date {
  const [year, mon] = month.split('-').map(Number);
  return new Date(Date.UTC(year, mon - 1, 1));
}

/** The 15th, Nairobi midnight - but never sooner than MIN_DAYS_TO_PAY after the invoice was actually issued. */
export function platformInvoiceDueDate(month: string, issuedAt: Date): Date {
  const fifteenth = new Date(monthBounds(month).start.getTime() + (DUE_DAY_OF_MONTH - 1) * DAY_MS);
  const minimum = new Date(issuedAt.getTime() + MIN_DAYS_TO_PAY * DAY_MS);
  return fifteenth > minimum ? fifteenth : minimum;
}

/** The flat plan fee: Starter only. Annual is 12 months for the price of 10. */
export function subscriptionAmount(plan: RentalPlanDef, cycle: RentalBillingCycle): number {
  if (plan.monthlyPrice === 0) return 0;
  return cycle === 'annual' && plan.annualPrice !== null ? plan.annualPrice : plan.monthlyPrice;
}

/** The share of rent matched through the gateway, rounded UP to a whole shilling (M-Pesa moves whole shillings). */
export function collectionFee(plan: RentalPlanDef, matchedRentTotal: number): number {
  if (plan.feePercent <= 0 || matchedRentTotal <= 0) return 0;
  return Math.ceil((Math.round(matchedRentTotal * 100) * plan.feePercent) / 10000);
}

/** End (exclusive) of the period a subscription invoice covers: one month, or twelve for annual. */
export function subscriptionPeriod(month: string, cycle: RentalBillingCycle, plan: RentalPlanDef): { start: Date; end: Date } {
  const { start, end } = monthBounds(month);
  if (cycle !== 'annual' || plan.annualPrice === null) return { start, end };
  const [year, mon] = month.split('-').map(Number);
  return { start, end: new Date(Date.UTC(year + 1, mon - 1, 1) - 3 * 60 * 60 * 1000) };
}

/** A landlord on a free period (landlords who were already using rentals) is not charged for anything ending within it. */
export function coveredByFreePeriod(freeUntil: Date | null, periodEnd: Date): boolean {
  return freeUntil !== null && freeUntil.getTime() >= periodEnd.getTime() - 1000;
}

export interface InvoiceForReminder {
  status: 'ISSUED' | 'PAID' | 'WAIVED';
  dueDate: Date;
  reminderStage: number;
}

/**
 * 1 issued, 2 reminder (5 days after issue on the normal schedule), 3 final reminder (10 days after), 4 account read-only
 * (the 15th). Counted back from the due date so a late-issued invoice still gets every notice that is left.
 * Each stage is emailed once; if the server was down the invoice jumps to the stage it has reached.
 */
export type PlatformReminderStage = 1 | 2 | 3 | 4;

export function nextPlatformReminderStage(invoice: InvoiceForReminder, now: Date = new Date()): PlatformReminderStage | null {
  if (invoice.status !== 'ISSUED') return null;
  const untilDue = invoice.dueDate.getTime() - now.getTime();
  let stage: PlatformReminderStage = 1;
  if (untilDue <= 10 * DAY_MS) stage = 2;
  if (untilDue <= 5 * DAY_MS) stage = 3;
  if (untilDue <= 0) stage = 4;
  return stage > invoice.reminderStage ? stage : null;
}

/** An unpaid invoice past its due date makes the landlord's account read-only. */
export function isAccountReadOnly(invoices: { status: 'ISSUED' | 'PAID' | 'WAIVED'; dueDate: Date }[], now: Date = new Date()): boolean {
  return invoices.some((i) => i.status === 'ISSUED' && i.dueDate.getTime() <= now.getTime());
}

// No 0/O/1/I - invoice numbers get read out over the phone.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** "ZRB-202611-7K3Q" */
export function platformInvoiceNumber(month: string): string {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `ZRB-${month.replace('-', '')}-${code}`;
}
