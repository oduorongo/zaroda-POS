import {
  dueDateAfterRelease,
  invoicePosition,
  releaseIsDue,
  releaseProblem,
  retentionFor,
} from './school-retention.util';

describe('retentionFor', () => {
  it('is the share of the invoice, to the cent', () => {
    expect(retentionFor(10000, 10)).toBe(1000);
    expect(retentionFor(1160, 5)).toBe(58);
    expect(retentionFor(33.33, 10)).toBe(3.33);
  });
  it('is nothing with no percentage, and never more than the invoice', () => {
    expect(retentionFor(10000, 0)).toBe(0);
    expect(retentionFor(10000, -5)).toBe(0);
    expect(retentionFor(100, 150)).toBe(100);
  });
});

describe('invoicePosition', () => {
  it('with no retention, what is owed is the total less payments and credits', () => {
    expect(invoicePosition({ total: 1000, paid: 300, credited: 100 })).toEqual({ outstanding: 600, retention: 0, dueNow: 600, surplus: 0 });
  });
  it('retention is outstanding but not due: the school owes the rest now', () => {
    expect(invoicePosition({ total: 1000, paid: 0, credited: 0, retentionHeld: 100 })).toEqual({ outstanding: 1000, retention: 100, dueNow: 900, surplus: 0 });
  });
  it('paying what is due leaves only the retention outstanding', () => {
    expect(invoicePosition({ total: 1000, paid: 900, credited: 0, retentionHeld: 100 })).toEqual({ outstanding: 100, retention: 100, dueNow: 0, surplus: 0 });
  });
  it('a credit note or write-off beyond what is due eats into the retention', () => {
    expect(invoicePosition({ total: 1000, paid: 900, credited: 60, retentionHeld: 100 })).toMatchObject({ outstanding: 40, retention: 40, dueNow: 0 });
    expect(invoicePosition({ total: 1000, paid: 0, credited: 0, writtenOff: 950, retentionHeld: 100 })).toMatchObject({ outstanding: 50, retention: 50, dueNow: 0 });
  });
  it('payments and credits beyond the total are a surplus', () => {
    expect(invoicePosition({ total: 1000, paid: 1000, credited: 200 })).toMatchObject({ outstanding: 0, surplus: 200 });
  });
  it('never goes below zero', () => {
    expect(invoicePosition({ total: 100, paid: 100, credited: 0, retentionHeld: 50 })).toMatchObject({ outstanding: 0, retention: 0, dueNow: 0 });
  });
});

describe('releaseProblem', () => {
  it('must be something, and no more than is held', () => {
    expect(releaseProblem(0, 100)).toContain('how much');
    expect(releaseProblem(150, 100)).toContain('Only 100.00');
    expect(releaseProblem(100, 100)).toBeNull();
    expect(releaseProblem(40.5, 100)).toBeNull();
  });
});

describe('dueDateAfterRelease', () => {
  it('gives released money the school\'s credit days from the release, unless the invoice is already due later', () => {
    expect(dueDateAfterRelease('2026-01-31', '2026-10-01', 30)).toBe('2026-10-31');
    expect(dueDateAfterRelease('2027-01-31', '2026-10-01', 30)).toBe('2027-01-31');
  });
});

describe('releaseIsDue', () => {
  it('is due once the date has come and something is still held', () => {
    expect(releaseIsDue('2026-10-01', 100, '2026-10-01')).toBe(true);
    expect(releaseIsDue('2026-10-02', 100, '2026-10-01')).toBe(false);
    expect(releaseIsDue('2026-09-01', 0, '2026-10-01')).toBe(false);
    expect(releaseIsDue(null, 100, '2026-10-01')).toBe(false);
  });
});
