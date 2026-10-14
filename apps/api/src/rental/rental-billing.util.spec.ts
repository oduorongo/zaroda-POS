import {
  billingMonths,
  invoiceStatus,
  nairobiToday,
  newReceiptNumber,
  planAllocations,
  rentDueDate,
  toCents,
} from './rental-billing.util';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('rental billing helpers', () => {
  describe('toCents', () => {
    it('rounds to whole cents so part-payments add up exactly', () => {
      expect(toCents('12000.10') + toCents('0.20')).toBe(1200030);
      expect(toCents(0.1 + 0.2)).toBe(30);
    });
  });

  describe('nairobiToday', () => {
    it('is already tomorrow in Nairobi after 21:00 UTC', () => {
      expect(nairobiToday(new Date('2026-10-14T21:30:00Z')).toISOString()).toBe('2026-10-15T00:00:00.000Z');
      expect(nairobiToday(new Date('2026-10-14T20:30:00Z')).toISOString()).toBe('2026-10-14T00:00:00.000Z');
    });
  });

  describe('billingMonths', () => {
    it('lists every month from the start month to the current one', () => {
      const months = billingMonths(d('2026-08-20'), null, d('2026-10-14'));
      expect(months.map((m) => m.toISOString().slice(0, 7))).toEqual(['2026-08', '2026-09', '2026-10']);
    });

    it('stops at the month a lease ended', () => {
      const months = billingMonths(d('2026-08-01'), d('2026-09-15'), d('2026-10-14'));
      expect(months.map((m) => m.toISOString().slice(0, 7))).toEqual(['2026-08', '2026-09']);
    });

    it('gives nothing for a lease that starts in the future', () => {
      expect(billingMonths(d('2026-12-01'), null, d('2026-10-14'))).toEqual([]);
    });
  });

  describe('rentDueDate', () => {
    it('uses the due day of the month', () => {
      expect(rentDueDate(d('2026-09-01'), 5, d('2026-08-01')).toISOString().slice(0, 10)).toBe('2026-09-05');
    });
    it('is never before the tenant moved in', () => {
      expect(rentDueDate(d('2026-08-01'), 5, d('2026-08-20')).toISOString().slice(0, 10)).toBe('2026-08-20');
    });
    it('caps the due day at 28 so it exists in every month', () => {
      expect(rentDueDate(d('2026-02-01'), 31, d('2026-01-01')).toISOString().slice(0, 10)).toBe('2026-02-28');
    });
  });

  describe('planAllocations', () => {
    it('pays the oldest invoice first and leaves the rest as credit', () => {
      const plan = planAllocations(
        [{ id: 'p1', remainingCents: 150000 }],
        [
          { id: 'i1', outstandingCents: 100000 },
          { id: 'i2', outstandingCents: 100000 },
        ],
      );
      expect(plan).toEqual([
        { paymentId: 'p1', invoiceId: 'i1', cents: 100000 },
        { paymentId: 'p1', invoiceId: 'i2', cents: 50000 },
      ]);
    });

    it('spreads several payments across an invoice', () => {
      const plan = planAllocations(
        [
          { id: 'p1', remainingCents: 30000 },
          { id: 'p2', remainingCents: 80000 },
        ],
        [{ id: 'i1', outstandingCents: 100000 }],
      );
      expect(plan).toEqual([
        { paymentId: 'p1', invoiceId: 'i1', cents: 30000 },
        { paymentId: 'p2', invoiceId: 'i1', cents: 70000 },
      ]);
    });

    it('applies nothing when there is no money or nothing owed', () => {
      expect(planAllocations([], [{ id: 'i1', outstandingCents: 5000 }])).toEqual([]);
      expect(planAllocations([{ id: 'p1', remainingCents: 5000 }], [])).toEqual([]);
    });

    it('never applies more than a payment holds', () => {
      const plan = planAllocations([{ id: 'p1', remainingCents: 4000 }], [{ id: 'i1', outstandingCents: 10000 }]);
      expect(plan.reduce((s, a) => s + a.cents, 0)).toBe(4000);
    });
  });

  describe('invoiceStatus', () => {
    const today = d('2026-10-14');
    it('reports paid, partial, overdue and unpaid', () => {
      expect(invoiceStatus(1000, 1000, d('2026-10-01'), today)).toBe('PAID');
      expect(invoiceStatus(1000, 400, d('2026-10-20'), today)).toBe('PARTIAL');
      expect(invoiceStatus(1000, 400, d('2026-10-05'), today)).toBe('OVERDUE');
      expect(invoiceStatus(1000, 0, d('2026-10-20'), today)).toBe('UNPAID');
    });
  });

  it('makes readable receipt numbers', () => {
    expect(newReceiptNumber(d('2026-10-16'))).toMatch(/^RR-20261016-[A-Z2-9]{6}$/);
  });
});
