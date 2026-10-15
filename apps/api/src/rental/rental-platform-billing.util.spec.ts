import {
  collectionFee,
  coveredByFreePeriod,
  firstOfMonthDate,
  isAccountReadOnly,
  nextPlatformReminderStage,
  platformInvoiceDueDate,
  platformInvoiceNumber,
  previousMonth,
  subscriptionAmount,
  subscriptionPeriod,
} from './rental-platform-billing.util';
import { RENTAL_PLANS } from './rental-plans.util';

// Nairobi is UTC+3: the 1st of November 00:00 there is 31 October 21:00 UTC.
const NOV_1 = new Date('2026-10-31T21:00:00Z');
const NOV_15 = new Date('2026-11-14T21:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

describe('platform invoice amounts', () => {
  it('charges Starter 1,000 a month, or 10,000 for a year (12 months for the price of 10)', () => {
    expect(subscriptionAmount(RENTAL_PLANS.starter, 'monthly')).toBe(1000);
    expect(subscriptionAmount(RENTAL_PLANS.starter, 'annual')).toBe(10000);
  });

  it('charges Bure and Pay-as-you-collect no flat fee', () => {
    expect(subscriptionAmount(RENTAL_PLANS.bure, 'monthly')).toBe(0);
    expect(subscriptionAmount(RENTAL_PLANS.collect, 'monthly')).toBe(0);
  });

  it('takes 1% of rent matched through the gateway, rounded up to a whole shilling', () => {
    expect(collectionFee(RENTAL_PLANS.collect, 250000)).toBe(2500);
    expect(collectionFee(RENTAL_PLANS.collect, 12345)).toBe(124); // 123.45 -> 124
    expect(collectionFee(RENTAL_PLANS.collect, 0.5)).toBe(1);
    expect(collectionFee(RENTAL_PLANS.collect, 0)).toBe(0);
  });

  it('takes no percentage on Starter or Bure', () => {
    expect(collectionFee(RENTAL_PLANS.starter, 250000)).toBe(0);
    expect(collectionFee(RENTAL_PLANS.bure, 250000)).toBe(0);
  });

  it('avoids floating-point drift on awkward amounts', () => {
    expect(collectionFee(RENTAL_PLANS.collect, 1000.1)).toBe(11); // 10.001 -> 11, not 10
    expect(collectionFee(RENTAL_PLANS.collect, 100)).toBe(1);
  });
});

describe('billing periods', () => {
  it('walks back a month, including across a year end', () => {
    expect(previousMonth('2026-11')).toBe('2026-10');
    expect(previousMonth('2027-01')).toBe('2026-12');
  });

  it('covers one month for monthly and twelve for annual Starter', () => {
    const monthly = subscriptionPeriod('2026-11', 'monthly', RENTAL_PLANS.starter);
    expect(monthly.start).toEqual(NOV_1);
    expect(monthly.end).toEqual(new Date('2026-11-30T21:00:00Z'));
    const annual = subscriptionPeriod('2026-11', 'annual', RENTAL_PLANS.starter);
    expect(annual.start).toEqual(NOV_1);
    expect(annual.end).toEqual(new Date('2027-10-31T21:00:00Z'));
  });

  it('gives the 1st of a month as a plain UTC date for comparing with lease dates', () => {
    expect(firstOfMonthDate('2026-11').toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('treats the end of the free period as covering October but not November', () => {
    const freeUntil = new Date('2026-10-31T20:59:59Z');
    expect(coveredByFreePeriod(freeUntil, new Date('2026-10-31T21:00:00Z'))).toBe(true); // all of October
    expect(coveredByFreePeriod(freeUntil, new Date('2026-11-30T21:00:00Z'))).toBe(false); // all of November
    expect(coveredByFreePeriod(null, new Date('2026-10-31T21:00:00Z'))).toBe(false);
  });
});

describe('due date, reminders and read-only', () => {
  it('is due on the 15th when issued on the 1st', () => {
    expect(platformInvoiceDueDate('2026-11', NOV_1)).toEqual(NOV_15);
  });

  it('gives a late-issued invoice at least 7 days to pay', () => {
    const issuedOn20th = new Date('2026-11-20T08:00:00Z');
    expect(platformInvoiceDueDate('2026-11', issuedOn20th)).toEqual(new Date(issuedOn20th.getTime() + 7 * DAY));
  });

  const invoice = { status: 'ISSUED' as const, dueDate: NOV_15, reminderStage: 0 };

  it('sends notices on day 1, 5 and 10, then locks on day 15', () => {
    expect(nextPlatformReminderStage(invoice, NOV_1)).toBe(1);
    expect(nextPlatformReminderStage({ ...invoice, reminderStage: 1 }, new Date(NOV_1.getTime() + 2 * DAY))).toBeNull();
    expect(nextPlatformReminderStage({ ...invoice, reminderStage: 1 }, new Date(NOV_1.getTime() + 4 * DAY))).toBe(2); // 5th
    expect(nextPlatformReminderStage({ ...invoice, reminderStage: 2 }, new Date(NOV_1.getTime() + 9 * DAY))).toBe(3); // 10th
    expect(nextPlatformReminderStage({ ...invoice, reminderStage: 3 }, NOV_15)).toBe(4); // 15th
  });

  it('never repeats a notice, and says nothing about a paid or waived invoice', () => {
    expect(nextPlatformReminderStage({ ...invoice, reminderStage: 4 }, new Date(NOV_15.getTime() + 30 * DAY))).toBeNull();
    expect(nextPlatformReminderStage({ ...invoice, status: 'PAID' }, NOV_15)).toBeNull();
    expect(nextPlatformReminderStage({ ...invoice, status: 'WAIVED' }, NOV_15)).toBeNull();
  });

  it('jumps straight to the stage reached after the server was down', () => {
    expect(nextPlatformReminderStage(invoice, new Date(NOV_15.getTime() + 3 * DAY))).toBe(4);
  });

  it('makes the account read-only from the 15th while an invoice is unpaid', () => {
    expect(isAccountReadOnly([invoice], new Date(NOV_15.getTime() - 1000))).toBe(false);
    expect(isAccountReadOnly([invoice], NOV_15)).toBe(true);
  });

  it('is not read-only once paid or waived, or with no invoices', () => {
    expect(isAccountReadOnly([{ status: 'PAID', dueDate: NOV_15 }], NOV_15)).toBe(false);
    expect(isAccountReadOnly([{ status: 'WAIVED', dueDate: NOV_15 }], NOV_15)).toBe(false);
    expect(isAccountReadOnly([], NOV_15)).toBe(false);
  });
});

describe('invoice numbers', () => {
  it('look like ZRB-202611-XXXX', () => {
    expect(platformInvoiceNumber('2026-11')).toMatch(/^ZRB-202611-[2-9A-HJ-NP-Z]{4}$/);
  });
});
