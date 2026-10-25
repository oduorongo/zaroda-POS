import {
  addDays,
  ageBucket,
  allocateOldestFirst,
  allocationProblem,
  documentNumber,
  documentTotals,
  exceedsCreditLimit,
  lineAmounts,
  statusAfterPayment,
} from './school-money.util';

describe('invoice maths', () => {
  it('works out a line with VAT', () => {
    expect(lineAmounts({ quantity: 10, unitPrice: 45, taxRate: 0.16 })).toEqual(
      { lineTotal: 450, taxAmount: 72, gross: 522 },
    );
  });

  it('works out a line with no VAT and with fractions of a unit', () => {
    expect(lineAmounts({ quantity: 2.5, unitPrice: 120, taxRate: 0 })).toEqual({
      lineTotal: 300,
      taxAmount: 0,
      gross: 300,
    });
  });

  it('does not drift on awkward cents', () => {
    // 3 x 33.33 = 99.99; 16% = 15.9984 -> 16.00
    expect(
      lineAmounts({ quantity: 3, unitPrice: 33.33, taxRate: 0.16 }),
    ).toEqual({ lineTotal: 99.99, taxAmount: 16, gross: 115.99 });
  });

  it('adds up an invoice: before VAT, VAT, and the total the school pays', () => {
    const totals = documentTotals([
      { quantity: 10, unitPrice: 45, taxRate: 0.16 }, // exercise books: 450 + 72
      { quantity: 5, unitPrice: 200, taxRate: 0 }, // exempt item: 1000
    ]);
    expect(totals).toEqual({ subtotal: 1450, taxAmount: 72, total: 1522 });
  });
});

describe('allocating a payment', () => {
  const open = [
    { id: 'b', balance: 5000, issueDate: '2026-09-10' },
    { id: 'a', balance: 3000, issueDate: '2026-08-01' },
    { id: 'c', balance: 2000, issueDate: '2026-10-01' },
  ];

  it('pays the oldest invoice first', () => {
    expect(allocateOldestFirst(2000, open)).toEqual({
      allocations: [{ invoiceId: 'a', amount: 2000 }],
      unallocated: 0,
    });
  });

  it('carries on to the next invoice once one is cleared (a partial payment can still span invoices)', () => {
    expect(allocateOldestFirst(6000, open)).toEqual({
      allocations: [
        { invoiceId: 'a', amount: 3000 },
        { invoiceId: 'b', amount: 3000 },
      ],
      unallocated: 0,
    });
  });

  it('keeps what is left over as credit on the account', () => {
    const r = allocateOldestFirst(12000, open);
    expect(r.allocations.map((a) => a.amount)).toEqual([3000, 5000, 2000]);
    expect(r.unallocated).toBe(2000);
  });

  it('allocates nothing when nothing is owed', () => {
    expect(allocateOldestFirst(500, [])).toEqual({
      allocations: [],
      unallocated: 500,
    });
  });

  it('skips invoices with nothing left on them', () => {
    expect(
      allocateOldestFirst(100, [
        { id: 'x', balance: 0, issueDate: '2026-01-01' },
        { id: 'y', balance: 50, issueDate: '2026-02-01' },
      ]).allocations,
    ).toEqual([{ invoiceId: 'y', amount: 50 }]);
  });
});

describe('a person choosing the allocations', () => {
  const balances = new Map([
    ['a', 3000],
    ['b', 5000],
  ]);

  it('accepts amounts within each invoice and within the payment', () => {
    expect(
      allocationProblem(
        4000,
        [
          { invoiceId: 'a', amount: 3000 },
          { invoiceId: 'b', amount: 1000 },
        ],
        balances,
      ),
    ).toBeNull();
    expect(
      allocationProblem(4000, [{ invoiceId: 'a', amount: 1000 }], balances),
    ).toBeNull(); // the rest stays as credit
  });

  it('refuses more than an invoice owes, more than the payment, an unknown invoice, a repeat, or nothing', () => {
    expect(
      allocationProblem(9000, [{ invoiceId: 'a', amount: 3500 }], balances),
    ).toMatch(/more than that invoice/);
    expect(
      allocationProblem(
        3000,
        [
          { invoiceId: 'a', amount: 2000 },
          { invoiceId: 'b', amount: 2000 },
        ],
        balances,
      ),
    ).toMatch(/more than the payment/);
    expect(
      allocationProblem(1000, [{ invoiceId: 'zzz', amount: 100 }], balances),
    ).toMatch(/does not belong/);
    expect(
      allocationProblem(
        1000,
        [
          { invoiceId: 'a', amount: 100 },
          { invoiceId: 'a', amount: 100 },
        ],
        balances,
      ),
    ).toMatch(/twice/);
    expect(
      allocationProblem(1000, [{ invoiceId: 'a', amount: 0 }], balances),
    ).toMatch(/more than zero/);
  });
});

describe('invoice status', () => {
  it('follows what has been paid', () => {
    expect(statusAfterPayment(1000, 0)).toBe('ISSUED');
    expect(statusAfterPayment(1000, 400)).toBe('PARTIALLY_PAID');
    expect(statusAfterPayment(1000, 1000)).toBe('PAID');
    expect(statusAfterPayment(1000, 1000.0)).toBe('PAID');
  });
});

describe('ageing', () => {
  const today = '2026-10-22';
  it('puts an invoice in the bucket for how late it is', () => {
    expect(ageBucket('2026-11-05', today)).toBe('CURRENT'); // not due yet
    expect(ageBucket('2026-10-22', today)).toBe('CURRENT'); // due today
    expect(ageBucket('2026-10-21', today)).toBe('DAYS_1_30');
    expect(ageBucket('2026-09-22', today)).toBe('DAYS_1_30'); // 30 days late
    expect(ageBucket('2026-09-21', today)).toBe('DAYS_31_60');
    expect(ageBucket('2026-08-23', today)).toBe('DAYS_31_60'); // 60 days late
    expect(ageBucket('2026-08-22', today)).toBe('DAYS_61_90'); // 61 days late
    expect(ageBucket('2026-07-24', today)).toBe('DAYS_61_90'); // 90 days late
    expect(ageBucket('2026-07-23', today)).toBe('OVER_90'); // 91 days late
    expect(ageBucket('2026-01-01', today)).toBe('OVER_90');
  });

  it('adds days across a month end', () => {
    expect(addDays('2026-10-31', 30)).toBe('2026-11-30');
  });
});

describe('credit limit', () => {
  it('flags an order that would take the school past its limit', () => {
    expect(exceedsCreditLimit(100_000, 80_000, 25_000)).toBe(true);
    expect(exceedsCreditLimit(100_000, 80_000, 20_000)).toBe(false); // exactly at the limit is allowed
    expect(exceedsCreditLimit(null, 9_000_000, 9_000_000)).toBe(false);
  });
});

describe('document numbers', () => {
  it('are the prefix, the year and a four-digit running number', () => {
    expect(documentNumber('INV', 2026, 7)).toBe('INV-2026-0007');
    expect(documentNumber('RC', 2026, 12345)).toBe('RC-2026-12345');
  });
});

describe('allocateOldestFirst on the same day', () => {
  it('pays invoices of one day in the order they are given (oldest invoice number first), not by id', () => {
    const open = [
      { id: 'zzz', balance: 100, issueDate: '2026-10-01' },
      { id: 'aaa', balance: 100, issueDate: '2026-10-01' },
    ];
    expect(allocateOldestFirst(100, open).allocations).toEqual([
      { invoiceId: 'zzz', amount: 100 },
    ]);
  });
});
