import {
  INVOICE_DUE_DAYS,
  PAUSE_GRACE_DAYS,
  invoiceDueDate,
  invoiceNumber,
  isMonthClosed,
  isPastDue,
  isPauseOverdue,
  monthBounds,
  monthOf,
  pauseDate,
} from './commission.util';

const day = 24 * 60 * 60 * 1000;

describe('monthOf / monthBounds (Nairobi time, UTC+3)', () => {
  it('puts 22:00 UTC on the last day into the NEXT Nairobi month', () => {
    // 2026-10-31 22:00 UTC is 2026-11-01 01:00 in Nairobi.
    expect(monthOf(new Date('2026-10-31T22:00:00Z'))).toBe('2026-11');
    expect(monthOf(new Date('2026-10-31T20:59:00Z'))).toBe('2026-10');
  });

  it('bounds a month at midnight Nairobi time', () => {
    const { start, end } = monthBounds('2026-10');
    expect(start.toISOString()).toBe('2026-09-30T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('handles December rolling into the next year and February in a leap year', () => {
    expect(monthBounds('2026-12').end.toISOString()).toBe('2026-12-31T21:00:00.000Z');
    expect(monthBounds('2028-02').end.toISOString()).toBe('2028-02-29T21:00:00.000Z');
  });

  it('rejects malformed months', () => {
    expect(() => monthBounds('2026-13')).toThrow();
    expect(() => monthBounds('October')).toThrow();
  });

  it('a month is closed only after it fully ends', () => {
    expect(isMonthClosed('2026-10', new Date('2026-10-31T20:59:00Z'))).toBe(false);
    expect(isMonthClosed('2026-10', new Date('2026-10-31T21:00:00Z'))).toBe(true);
  });
});

describe('due and pause dates', () => {
  const issued = new Date('2026-11-01T06:00:00Z');
  const due = invoiceDueDate(issued);

  it('is due 14 days after issue and pauses 7 days after that', () => {
    expect(due.getTime() - issued.getTime()).toBe(INVOICE_DUE_DAYS * day);
    expect(pauseDate(due).getTime() - due.getTime()).toBe(PAUSE_GRACE_DAYS * day);
  });

  it('warns past due but only pauses after the grace period', () => {
    const invoice = { status: 'ISSUED' as const, dueDate: due };
    const justPastDue = new Date(due.getTime() + day);
    expect(isPastDue(invoice, justPastDue)).toBe(true);
    expect(isPauseOverdue(invoice, justPastDue)).toBe(false);
    expect(isPauseOverdue(invoice, new Date(pauseDate(due).getTime() + 1))).toBe(true);
  });

  it('never pauses for a paid or waived invoice', () => {
    const late = new Date(due.getTime() + 60 * day);
    expect(isPauseOverdue({ status: 'PAID', dueDate: due }, late)).toBe(false);
    expect(isPauseOverdue({ status: 'WAIVED', dueDate: due }, late)).toBe(false);
    expect(isPastDue({ status: 'PAID', dueDate: due }, late)).toBe(false);
  });
});

describe('invoiceNumber', () => {
  it('reads as ZC-YYYYMM-CODE', () => {
    expect(invoiceNumber('2026-10', '7K3Q')).toBe('ZC-202610-7K3Q');
  });
});
