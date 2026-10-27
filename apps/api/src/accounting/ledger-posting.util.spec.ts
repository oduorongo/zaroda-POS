import { expenseAccount, SYSTEM_ACCOUNTS } from './ledger-chart';
import {
  billCreditDraft,
  billDraft,
  billPaymentDraft,
  cancelFeeDraft,
  Draft,
  expenseDraft,
  fingerprint,
  folioMoneyDraft,
  isBalanced,
  layawayCompleteDraft,
  layawayPaymentDraft,
  manualProblem,
  moneyAccount,
  payrollDraft,
  postingDate,
  provisionDraft,
  refundDraft,
  rentInvoiceDraft,
  rentPaymentDraft,
  reversed,
  saleDraft,
  schoolReceiptDraft,
  stockCountDraft,
  leaseEndDraft,
  payOffDraft,
  tipDraft,
  zarodaAdvertDraft,
  zarodaInvoiceDraft,
  zarodaPaymentDraft,
  zarodaSubscriptionDraft,
  tidy,
  toCents,
  wasteDraft,
  writeOffDraft,
} from './ledger-posting.util';

const amount = (d: Draft, account: string) => {
  const l = d.lines.find((x) => x.account === account);
  return l ? l.debit - l.credit : 0;
};

describe('chart of accounts', () => {
  it('has unique keys and codes', () => {
    expect(new Set(SYSTEM_ACCOUNTS.map((a) => a.key)).size).toBe(SYSTEM_ACCOUNTS.length);
    expect(new Set(SYSTEM_ACCOUNTS.map((a) => a.code)).size).toBe(SYSTEM_ACCOUNTS.length);
  });
  it('posts each expense category to its own account', () => {
    expect(expenseAccount('RENT')).toBe('EXP_RENT');
    expect(expenseAccount('SALARIES')).toBe('SALARIES');
    expect(expenseAccount('SOMETHING_NEW')).toBe('EXP_OTHER');
  });
});

describe('tidy and fingerprint', () => {
  it('nets an account on both sides and drops zeros', () => {
    const t = tidy([
      { account: 'CASH', debit: 500, credit: 0 },
      { account: 'CASH', debit: 0, credit: 200 },
      { account: 'SALES', debit: 0, credit: 300 },
      { account: 'VAT_OUTPUT', debit: 0, credit: 0 },
    ]);
    expect(t).toEqual([
      { account: 'CASH', debit: 300, credit: 0 },
      { account: 'SALES', debit: 0, credit: 300 },
    ]);
  });
  it('is the same for the same posting and changes with an amount or a date', () => {
    const a: Draft = { date: '2026-10-01', memo: 'x', lines: [{ account: 'CASH', debit: 100, credit: 0 }, { account: 'SALES', debit: 0, credit: 100 }] };
    expect(fingerprint(a)).toBe(fingerprint({ ...a, memo: 'other words', lines: [...a.lines].reverse() }));
    expect(fingerprint(a)).not.toBe(fingerprint({ ...a, date: '2026-10-02' }));
    expect(fingerprint(null)).toBe('none');
  });
  it('reversing swaps every side', () => {
    expect(reversed([{ account: 'CASH', debit: 5, credit: 0 }])).toEqual([{ account: 'CASH', debit: 0, credit: 5 }]);
  });
  it('turns money into whole cents', () => {
    expect(toCents('12.345')).toBe(1235);
    expect(toCents(null)).toBe(0);
  });
});

describe('saleDraft', () => {
  it('splits a cash and M-Pesa sale into sales and VAT, with the cost of goods', () => {
    const d = saleDraft({
      date: '2026-10-01',
      reference: 'abc',
      totalCents: 11600,
      lines: [{ netCents: 10000, taxCents: 1600 }],
      payments: [
        { method: 'CASH', amountCents: 6600 },
        { method: 'MPESA', amountCents: 5000 },
      ],
      costCents: 7000,
    });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'CASH')).toBe(6600);
    expect(amount(d, 'MPESA')).toBe(5000);
    expect(amount(d, 'SALES')).toBe(-10000);
    expect(amount(d, 'VAT_OUTPUT')).toBe(-1600);
    expect(amount(d, 'COGS')).toBe(7000);
    expect(amount(d, 'INVENTORY')).toBe(-7000);
  });
  it('scales the VAT down with a discount on the total', () => {
    const d = saleDraft({ date: '2026-10-01', reference: 'x', totalCents: 5800, lines: [{ netCents: 10000, taxCents: 1600 }], payments: [{ method: 'CARD', amountCents: 5800 }], costCents: 0 });
    expect(amount(d, 'VAT_OUTPUT')).toBe(-800);
    expect(amount(d, 'SALES')).toBe(-5000);
    expect(amount(d, 'CARD_CLEARING')).toBe(5800);
    expect(d.lines.some((l) => l.account === 'COGS')).toBe(false);
  });
  it('puts a credit sale (a school invoice) and a room charge on what is owed', () => {
    const school = saleDraft({ date: '2026-10-01', reference: 'x', totalCents: 1000, lines: [{ netCents: 1000, taxCents: 0 }], payments: [{ method: 'ACCOUNT', amountCents: 1000 }], costCents: 0 });
    expect(amount(school, 'AR')).toBe(1000);
    const room = saleDraft({ date: '2026-10-01', reference: 'x', totalCents: 1000, lines: [{ netCents: 1000, taxCents: 0 }], payments: [{ method: 'ROOM_CHARGE', amountCents: 1000 }], costCents: 0 });
    expect(amount(room, 'GUEST_AR')).toBe(1000);
  });
  it("takes a hotel stay's settlement from the guest's account, whatever the payment methods say", () => {
    const d = saleDraft({
      date: '2026-10-01',
      reference: 'x',
      totalCents: 3000,
      lines: [{ netCents: 3000, taxCents: 0 }],
      payments: [
        { method: 'CASH', amountCents: 2000 },
        { method: 'ROOM_CHARGE', amountCents: 1000 },
      ],
      costCents: 0,
      settlement: true,
    });
    expect(amount(d, 'GUEST_AR')).toBe(3000);
    expect(amount(d, 'CASH')).toBe(0);
  });
  it('keeps a payment shortfall visible as owed, and still balances', () => {
    const d = saleDraft({ date: '2026-10-01', reference: 'x', totalCents: 1000, lines: [{ netCents: 1000, taxCents: 0 }], payments: [{ method: 'CASH', amountCents: 900 }], costCents: 0 });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'AR')).toBe(100);
  });
});

describe('refundDraft', () => {
  it('gives back the VAT share and the money the way the sale was paid', () => {
    const d = refundDraft({ date: '2026-10-02', reference: 'x', amountCents: 5800, saleTotalCents: 11600, saleTaxCents: 1600, mainMethod: 'MPESA' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'VAT_OUTPUT')).toBe(800);
    expect(amount(d, 'SALES_RETURNS')).toBe(5000);
    expect(amount(d, 'MPESA')).toBe(-5800);
  });
  it("takes a school's credit note off what the school owes", () => {
    const d = refundDraft({ date: '2026-10-02', reference: 'x', amountCents: 1000, saleTotalCents: 1000, saleTaxCents: 0, mainMethod: 'ACCOUNT' });
    expect(amount(d, 'AR')).toBe(-1000);
  });
});

describe('other sources', () => {
  it('expenses go to their category, paid from the right place', () => {
    const d = expenseDraft({ date: '2026-10-01', category: 'UTILITIES', label: 'Power', amountCents: 2500, paidWith: 'MPESA' });
    expect(amount(d, 'EXP_UTILITIES')).toBe(2500);
    expect(amount(d, 'MPESA')).toBe(-2500);
    expect(amount(expenseDraft({ date: '2026-10-01', category: 'RENT', label: 'x', amountCents: 1, paidWith: null }), 'CASH')).toBe(-1);
  });
  it('a bill brings stock in and is owed; a credit and a payment reduce what is owed', () => {
    expect(amount(billDraft({ date: 'd', reference: 'B1', supplier: 'S', totalCents: 9000 }), 'AP')).toBe(-9000);
    expect(amount(billCreditDraft({ date: 'd', reference: 'B1', supplier: 'S', amountCents: 1000 }), 'INVENTORY')).toBe(-1000);
    const p = billPaymentDraft({ date: 'd', reference: 'B1', supplier: 'S', amountCents: 8000, method: 'CHEQUE' });
    expect(amount(p, 'AP')).toBe(8000);
    expect(amount(p, 'BANK')).toBe(-8000);
  });
  it('payroll: gross is the cost, deductions are owed, and the rest is paid out', () => {
    const d = payrollDraft({ date: 'd', period: 'Oct', grossCents: 100000, payeCents: 15000, nssfCents: 4000, shifCents: 2750, housingCents: 1500, netCents: 76750, paidFrom: 'BANK' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'SALARIES')).toBe(100000);
    expect(amount(d, 'PAYE')).toBe(-15000);
    expect(amount(d, 'BANK')).toBe(-76750);
  });
  it('a school receipt reduces what is owed; withholding tax becomes a credit with KRA', () => {
    expect(amount(schoolReceiptDraft({ date: 'd', reference: 'R1', school: 'S', amountCents: 500, method: 'BANK_TRANSFER' }), 'BANK')).toBe(500);
    const wht = schoolReceiptDraft({ date: 'd', reference: 'R2', school: 'S', amountCents: 200, method: 'WITHHOLDING_TAX' });
    expect(amount(wht, 'WHT_RECEIVABLE')).toBe(200);
    expect(amount(wht, 'AR')).toBe(-200);
  });
  it('bad debts: a write-off and a change in the amount set aside, up or down', () => {
    expect(amount(writeOffDraft({ date: 'd', reference: 'INV', amountCents: 300 }), 'BAD_DEBTS')).toBe(300);
    expect(amount(provisionDraft({ date: 'd', changeCents: 400 }), 'BAD_DEBT_ALLOWANCE')).toBe(-400);
    expect(amount(provisionDraft({ date: 'd', changeCents: -400 }), 'BAD_DEBTS')).toBe(-400);
  });
  it('rent is income, a deposit is held, a payment reduces what is owed', () => {
    expect(amount(rentInvoiceDraft({ date: 'd', kind: 'RENT', reference: 'x', amountCents: 2000 }), 'RENT_INCOME')).toBe(-2000);
    expect(amount(rentInvoiceDraft({ date: 'd', kind: 'DEPOSIT', reference: 'x', amountCents: 2000 }), 'TENANT_DEPOSITS')).toBe(-2000);
    expect(amount(rentInvoiceDraft({ date: 'd', kind: 'OTHER', reference: 'x', amountCents: 2000 }), 'RENT_OTHER_INCOME')).toBe(-2000);
    expect(amount(rentPaymentDraft({ date: 'd', reference: 'x', amountCents: 2000, method: 'DARAJA' }), 'MPESA')).toBe(2000);
  });
  it('waste, layaways and hotel desk payments', () => {
    expect(amount(wasteDraft({ date: 'd', label: 'x', costCents: 50 }), 'WASTE')).toBe(50);
    expect(amount(layawayPaymentDraft({ date: 'd', reference: 'x', amountCents: 100, method: 'CASH' }), 'CUSTOMER_DEPOSITS')).toBe(-100);
    const done = layawayCompleteDraft({ date: 'd', reference: 'x', totalCents: 1160, taxCents: 160, costCents: 600 });
    expect(isBalanced(done.lines)).toBe(true);
    expect(amount(done, 'CUSTOMER_DEPOSITS')).toBe(1160);
    expect(amount(done, 'SALES')).toBe(-1000);
    expect(amount(folioMoneyDraft({ date: 'd', reference: 'x', amountCents: 100, method: 'MPESA_RECEIPT', refund: false }), 'GUEST_AR')).toBe(-100);
    expect(amount(folioMoneyDraft({ date: 'd', reference: 'x', amountCents: 100, method: 'CASH', refund: true }), 'CASH')).toBe(-100);
  });
  it("a hotel's cancellation fee comes out of what the guest paid and becomes income", () => {
    const d = cancelFeeDraft({ date: 'd', reference: 'ZB-1', feeCents: 500 });
    expect(amount(d, 'GUEST_AR')).toBe(500);
    expect(amount(d, 'OTHER_INCOME')).toBe(-500);
  });
  it('a tip is held for staff, a service charge is income, both came in with the bill', () => {
    const d = tipDraft({ date: 'd', reference: 'x', tipCents: 200, serviceCents: 500, mainMethod: 'MPESA' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'MPESA')).toBe(700);
    expect(amount(d, 'TIPS_PAYABLE')).toBe(-200);
    expect(amount(d, 'SERVICE_CHARGE')).toBe(-500);
  });
  it('a stock count: missing stock is a cost, stock found over reduces it', () => {
    const d = stockCountDraft({ date: 'd', reference: 'x', shortCents: 900, overCents: 300 });
    expect(amount(d, 'STOCK_COUNT')).toBe(600);
    expect(amount(d, 'INVENTORY')).toBe(-600);
    expect(stockCountDraft({ date: 'd', reference: 'x', shortCents: 0, overCents: 0 }).lines).toEqual([]);
  });
  it('a lease ending releases the deposit: some handed back, the rest kept', () => {
    const d = leaseEndDraft({ date: 'd', reference: 'x', paidCents: 10000, refundedCents: 7000, method: 'BANK' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'TENANT_DEPOSITS')).toBe(10000);
    expect(amount(d, 'BANK')).toBe(-7000);
    expect(amount(d, 'DEPOSITS_KEPT')).toBe(-3000);
  });
  it("ZARODA's charges: a fee is a cost; convenience fees are only passed on", () => {
    expect(amount(zarodaSubscriptionDraft({ date: 'd', amountCents: 150000, method: 'MPESA' }), 'ZARODA_FEES')).toBe(150000);
    expect(amount(zarodaInvoiceDraft({ date: 'd', reference: 'C1', amountCents: 500, passOn: false, label: 'x' }), 'ZARODA_FEES')).toBe(500);
    const fee = zarodaInvoiceDraft({ date: 'd', reference: 'F1', amountCents: 300, passOn: true, label: 'x' });
    expect(amount(fee, 'ZARODA_FEES')).toBe(0);
    expect(amount(fee, 'MPESA')).toBe(300);
    expect(amount(fee, 'AP_ZARODA')).toBe(-300);
    expect(amount(zarodaPaymentDraft({ date: 'd', reference: 'C1', amountCents: 500, method: null }), 'MPESA')).toBe(-500);
    expect(amount(zarodaAdvertDraft({ date: 'd', reference: 'A', amountCents: 10000 }), 'ZARODA_FEES')).toBe(10000);
  });
  it('paying off VAT or tips takes it off what is owed', () => {
    const d = payOffDraft({ date: 'd', account: 'VAT_OUTPUT', amountCents: 5000, paidFrom: 'BANK', reference: 'KRA-1' });
    expect(amount(d, 'VAT_OUTPUT')).toBe(5000);
    expect(amount(d, 'BANK')).toBe(-5000);
    expect(d.memo).toContain('KRA-1');
  });
  it('maps every way of paying to a money account', () => {
    expect(moneyAccount('TUMA')).toBe('MPESA');
    expect(moneyAccount('BANK_TRANSFER')).toBe('BANK');
    expect(moneyAccount(undefined)).toBe('CASH');
  });
});

describe('manual journals and closed periods', () => {
  it('refuses a journal that does not balance or has a bad line', () => {
    expect(manualProblem([{ debit: 100, credit: 0 }, { debit: 0, credit: 100 }])).toBeNull();
    expect(manualProblem([{ debit: 100, credit: 0 }])).toContain('two lines');
    expect(manualProblem([{ debit: 100, credit: 0 }, { debit: 0, credit: 90 }])).toContain('must be equal');
    expect(manualProblem([{ debit: 100, credit: 100 }, { debit: 0, credit: 0 }])).toContain('not both');
  });
  it('moves a posting for a closed period to the first open day', () => {
    expect(postingDate('2026-09-15', '2026-09-30')).toBe('2026-10-01');
    expect(postingDate('2026-10-05', '2026-09-30')).toBe('2026-10-05');
    expect(postingDate('2026-12-31', '2026-12-31')).toBe('2027-01-01');
    expect(postingDate('2026-09-15', null)).toBe('2026-09-15');
  });
});
