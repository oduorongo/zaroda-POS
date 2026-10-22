import {
  agePayables,
  ageBucket,
  billStatus,
  dueDateFor,
  marginWarning,
  outstanding,
  paymentProblem,
  receiptNumber,
  receiptSequence,
  receiptValue,
  creditProblem,
  damagedValue,
} from './payables.util';

describe('receipt numbers', () => {
  it('are numbered per year with leading zeros', () => {
    expect(receiptNumber(2026, 7)).toBe('GRN-2026-0007');
    expect(receiptNumber(2026, 12345)).toBe('GRN-2026-12345');
  });
  it('the sequence is read back only for the same year', () => {
    expect(receiptSequence('GRN-2026-0007', 2026)).toBe(7);
    expect(receiptSequence('GRN-2025-0007', 2026)).toBe(0);
    expect(receiptSequence('nonsense', 2026)).toBe(0);
  });
});

describe('dueDateFor', () => {
  it("adds the supplier's terms to the bill date", () => {
    expect(dueDateFor('2026-11-01', 30)).toBe('2026-12-01');
    expect(dueDateFor('2026-12-20', 30)).toBe('2027-01-19');
    expect(dueDateFor('2026-11-01', 0)).toBe('2026-11-01');
  });
});

describe('billStatus / outstanding', () => {
  it('open until something is paid, partly paid, then paid', () => {
    expect(billStatus(1000, 0)).toBe('OPEN');
    expect(billStatus(1000, 400)).toBe('PARTLY_PAID');
    expect(billStatus(1000, 1000)).toBe('PAID');
    expect(billStatus(1000.1, 1000.1)).toBe('PAID');
  });
  it('a voided bill stays void', () => {
    expect(billStatus(1000, 0, true)).toBe('VOID');
  });
  it('what is left is never negative and cents stay exact', () => {
    expect(outstanding(1000, 400.1)).toBe(599.9);
    expect(outstanding(100, 150)).toBe(0);
    expect(outstanding(0.3, 0.1)).toBe(0.2);
  });
});

describe('paymentProblem', () => {
  const bill = { total: 1000, amountPaid: 400, status: 'PARTLY_PAID' };
  it('accepts a payment up to what is owed', () => {
    expect(paymentProblem(bill, 600)).toBeNull();
    expect(paymentProblem(bill, 0.01)).toBeNull();
  });
  it('refuses more than is owed, nothing, a paid or a cancelled bill', () => {
    expect(paymentProblem(bill, 600.01)).toMatch(/Only KES 600.00/);
    expect(paymentProblem(bill, 0)).toMatch(/above zero/);
    expect(paymentProblem(bill, -5)).toMatch(/above zero/);
    expect(
      paymentProblem({ ...bill, status: 'PAID', amountPaid: 1000 }, 1),
    ).toMatch(/already fully paid/);
    expect(paymentProblem({ ...bill, status: 'VOID' }, 1)).toMatch(/cancelled/);
  });
});

describe('ageBucket', () => {
  it('not due on or before the due date; then by how many days late', () => {
    expect(ageBucket('2026-11-30', '2026-11-30')).toBe('NOT_DUE');
    expect(ageBucket('2026-12-05', '2026-11-30')).toBe('NOT_DUE');
    expect(ageBucket('2026-11-29', '2026-11-30')).toBe('DAYS_1_30');
    expect(ageBucket('2026-10-31', '2026-11-30')).toBe('DAYS_1_30');
    expect(ageBucket('2026-10-30', '2026-11-30')).toBe('DAYS_31_60');
    expect(ageBucket('2026-10-01', '2026-11-30')).toBe('DAYS_31_60');
    expect(ageBucket('2026-09-30', '2026-11-30')).toBe('DAYS_61_PLUS');
  });
});

describe('agePayables', () => {
  const bills = [
    {
      supplierId: 's1',
      supplierName: 'Unga Ltd',
      dueDate: '2026-12-10',
      total: 10000,
      amountPaid: 0,
      status: 'OPEN',
    },
    {
      supplierId: 's1',
      supplierName: 'Unga Ltd',
      dueDate: '2026-11-20',
      total: 5000,
      amountPaid: 2000,
      status: 'PARTLY_PAID',
    },
    {
      supplierId: 's2',
      supplierName: 'Sugar Co',
      dueDate: '2026-08-01',
      total: 3000,
      amountPaid: 0,
      status: 'OPEN',
    },
    {
      supplierId: 's2',
      supplierName: 'Sugar Co',
      dueDate: '2026-08-01',
      total: 999,
      amountPaid: 999,
      status: 'PAID',
    },
    {
      supplierId: 's3',
      supplierName: 'Gone',
      dueDate: '2026-08-01',
      total: 500,
      amountPaid: 0,
      status: 'VOID',
    },
  ];
  const r = agePayables(bills, '2026-11-30');
  it('adds up what is owed to each supplier by how late it is', () => {
    const unga = r.rows.find((x) => x.supplierId === 's1')!;
    expect(unga).toMatchObject({
      notDue: 10000,
      days1to30: 3000,
      total: 13000,
      bills: 2,
    });
    expect(r.rows.find((x) => x.supplierId === 's2')).toMatchObject({
      days61plus: 3000,
      total: 3000,
      bills: 1,
    });
  });
  it('leaves out paid and cancelled bills', () => {
    expect(r.rows.some((x) => x.supplierId === 's3')).toBe(false);
    expect(r.totals.bills).toBe(3);
  });
  it('the biggest debt is listed first and the totals agree with the rows', () => {
    expect(r.rows.map((x) => x.supplierId)).toEqual(['s1', 's2']);
    expect(r.totals.total).toBe(16000);
    expect(
      r.totals.notDue +
        r.totals.days1to30 +
        r.totals.days31to60 +
        r.totals.days61plus,
    ).toBe(r.totals.total);
  });
  it('nothing owed gives an empty report', () => {
    expect(agePayables([], '2026-11-30')).toMatchObject({
      rows: [],
      totals: { total: 0, bills: 0 },
    });
  });
});

describe('marginWarning', () => {
  const base = {
    variantId: 'v',
    sku: 'UNGA-2KG',
    name: 'Unga 2kg',
    previousCost: null as number | null,
    minMarginPercent: 10,
  };
  it('no warning for a healthy margin', () => {
    expect(marginWarning({ ...base, price: 200, cost: 150 })).toBeNull();
  });
  it('a loss', () => {
    expect(marginWarning({ ...base, price: 200, cost: 210 })).toMatchObject({
      reason: 'LOSS',
      marginPercent: -5,
    });
  });
  it('a margin under the minimum', () => {
    expect(marginWarning({ ...base, price: 200, cost: 190 })).toMatchObject({
      reason: 'BELOW_MINIMUM',
      marginPercent: 5,
    });
    expect(marginWarning({ ...base, price: 200, cost: 180 })).toBeNull(); // exactly 10% is fine
  });
  it('a cost that jumped 5% or more, even if the margin is still fine', () => {
    expect(
      marginWarning({ ...base, price: 300, cost: 105, previousCost: 100 }),
    ).toMatchObject({ reason: 'COST_UP', previousCost: 100 });
    expect(
      marginWarning({ ...base, price: 300, cost: 104, previousCost: 100 }),
    ).toBeNull();
  });
  it('a product with no selling price cannot be judged', () => {
    expect(marginWarning({ ...base, price: 0, cost: 50 })).toBeNull();
  });
});

describe('receiptValue', () => {
  it('is accepted quantity x price, line by line', () => {
    expect(
      receiptValue([
        { quantityAccepted: 10, unitCost: 55.5 },
        { quantityAccepted: 2.5, unitCost: 100 },
      ]),
    ).toBe(805);
  });
  it('damaged goods are not in the quantity, so they are not paid for', () => {
    expect(receiptValue([{ quantityAccepted: 8, unitCost: 100 }])).toBe(800);
  });
  it('a line with nothing accepted adds nothing; a priced-less line makes it unknown', () => {
    expect(
      receiptValue([
        { quantityAccepted: 0, unitCost: null },
        { quantityAccepted: 1, unitCost: 10 },
      ]),
    ).toBe(10);
    expect(
      receiptValue([{ quantityAccepted: 1, unitCost: undefined }]),
    ).toBeNull();
  });
});

describe('credit notes', () => {
  it('a credit takes off what is owed, so a bill can be settled by payment plus credit', () => {
    expect(outstanding(1000, 300, 200)).toBe(500);
    expect(billStatus(1000, 300, false, 200)).toBe('PARTLY_PAID');
    expect(billStatus(1000, 800, false, 200)).toBe('PAID');
    expect(billStatus(1000, 0, false, 1000)).toBe('PAID');
    expect(billStatus(1000, 0, false, 200)).toBe('OPEN');
  });
  it('a payment can only be for what is left after the credit', () => {
    const bill = {
      total: 1000,
      amountPaid: 300,
      creditAmount: 200,
      status: 'PARTLY_PAID',
    };
    expect(paymentProblem(bill, 500)).toBeNull();
    expect(paymentProblem(bill, 500.01)).toMatch(/Only KES 500.00/);
  });
  it('a credit can only take off what is still owed', () => {
    const bill = {
      total: 1000,
      amountPaid: 300,
      creditAmount: 0,
      status: 'PARTLY_PAID',
    };
    expect(creditProblem(bill, 700)).toBeNull();
    expect(creditProblem(bill, 700.01)).toMatch(/still owed: KES 700.00/);
    expect(creditProblem(bill, 0)).toMatch(/above zero/);
    expect(creditProblem({ ...bill, status: 'VOID' }, 1)).toMatch(/cancelled/);
    expect(
      creditProblem({ ...bill, amountPaid: 1000, status: 'PAID' }, 1),
    ).toMatch(/Nothing is owed/);
  });
  it('the payables report counts only what is left after credits', () => {
    const r = agePayables(
      [
        {
          supplierId: 's',
          supplierName: 'S',
          dueDate: '2026-12-10',
          total: 1000,
          amountPaid: 100,
          creditAmount: 400,
          status: 'PARTLY_PAID',
        },
      ],
      '2026-11-30',
    );
    expect(r.totals.total).toBe(500);
    expect(
      agePayables(
        [
          {
            supplierId: 's',
            supplierName: 'S',
            dueDate: '2026-12-10',
            total: 1000,
            amountPaid: 0,
            creditAmount: 1000,
            status: 'OPEN',
          },
        ],
        '2026-11-30',
      ).rows,
    ).toEqual([]);
  });
  it('the damaged goods on a delivery are worth quantity x the price paid', () => {
    expect(
      damagedValue([
        { quantityDamaged: 5, unitCost: 100 },
        { quantityDamaged: 2.5, unitCost: 40 },
        { quantityDamaged: 0, unitCost: 9 },
        { quantityDamaged: 3, unitCost: null },
      ]),
    ).toBe(600);
  });
});
