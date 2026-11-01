import { addDays, ageOwed, bucketOf } from './ledger-aging.util';
import { billCreditDraft, billDraft, expenseDraft, isBalanced, payOffDraft } from './ledger-posting.util';
import { AccountInfo, cashActivity, cashFlow, isMoneyAccount } from './ledger-reports.util';

const side = (d: { lines: { account: string; debit: number; credit: number }[] }) => Object.fromEntries(d.lines.map((l) => [l.account, l.debit - l.credit]));

describe('aged debtors and creditors', () => {
  it('buckets by days past the due date; retention (no due date) has its own column', () => {
    const today = '2026-11-01';
    expect(bucketOf('2026-11-01', today)).toBe('notDue');
    expect(bucketOf('2026-10-31', today)).toBe('days1to30');
    expect(bucketOf('2026-10-02', today)).toBe('days1to30');
    expect(bucketOf('2026-10-01', today)).toBe('days31to60');
    expect(bucketOf('2026-08-03', today)).toBe('days61to90');
    expect(bucketOf('2026-08-02', today)).toBe('days90plus');
    expect(bucketOf(null, today)).toBe('retention');
    expect(addDays('2026-10-15', 30)).toBe('2026-11-14');
  });

  it('totals per party, largest first, leaving out what is fully paid', () => {
    const aged = ageOwed(
      [
        { party: 'A School', kind: 'Invoice', reference: 'INV-1', date: '2026-09-01', dueDate: '2026-09-30', owedCents: 10_000 },
        { party: 'A School', kind: 'Retention', reference: 'INV-1', date: '2026-09-01', dueDate: null, owedCents: 500 },
        { party: 'B Client', kind: 'IPC', reference: 'PRJ-001 IPC 2', date: '2026-10-20', dueDate: '2026-11-19', owedCents: 50_000 },
        { party: 'C Paid', kind: 'Invoice', reference: 'INV-2', date: '2026-01-01', dueDate: '2026-01-30', owedCents: 0 },
      ],
      '2026-11-01',
    );
    expect(aged.rows.map((r) => r.party)).toEqual(['B Client', 'A School']);
    expect(aged.rows[1]).toMatchObject({ days31to60: 10_000, retention: 500, total: 10_500, documents: 2 });
    expect(aged.totals).toMatchObject({ notDue: 50_000, days31to60: 10_000, retention: 500, total: 60_500 });
    expect(aged.documents[0]).toMatchObject({ reference: 'INV-1', daysLate: 32 });
    expect(aged.documents.find((d) => d.kind === 'Retention')?.daysLate).toBeNull();
  });
});

describe('cash flow statement', () => {
  const a = (id: string, code: string, type: AccountInfo['type'], name = id): AccountInfo => ({ id, code, name, type, systemKey: null });
  const accounts = [a('cash', '1000', 'ASSET'), a('bank', '1020', 'ASSET'), a('ar', '1100', 'ASSET'), a('van', '1500', 'ASSET'), a('ap', '2000', 'LIABILITY'), a('loan', '2500', 'LIABILITY'), a('capital', '3000', 'EQUITY'), a('sales', '4000', 'INCOME'), a('rent', '6010', 'EXPENSE')];

  it('knows money accounts and which activity each other account belongs to', () => {
    expect(accounts.filter(isMoneyAccount).map((x) => x.id)).toEqual(['cash', 'bank']);
    expect(['ar', 'van', 'ap', 'loan', 'capital', 'sales', 'rent'].map((id) => cashActivity(accounts.find((x) => x.id === id)!))).toEqual(['OPERATING', 'INVESTING', 'OPERATING', 'FINANCING', 'FINANCING', 'OPERATING', 'OPERATING']);
  });

  it('groups money in and out by activity and reconciles opening + movement = closing', () => {
    const effects = new Map([['sales', 120_000], ['ar', 30_000], ['rent', -40_000], ['ap', -25_000], ['van', -60_000], ['loan', 50_000], ['capital', 0]]);
    const cf = cashFlow(accounts, effects, 10_000, 85_000);
    expect(cf.operating.total).toBe(85_000);
    expect(cf.investing.total).toBe(-60_000);
    expect(cf.financing).toEqual({ rows: [{ accountId: 'loan', code: '2500', name: 'loan', amount: 50_000 }], total: 50_000 });
    expect(cf.net).toBe(75_000);
    expect(cf.reconciles).toBe(true);
    expect(cashFlow(accounts, effects, 10_000, 85_001).reconciles).toBe(false);
  });
});

describe('VAT on purchases', () => {
  it('a bill with VAT: the VAT is claimable, only the rest goes to stock; none leaves the old posting unchanged', () => {
    expect(side(billDraft({ date: '2026-10-01', reference: 'B1', supplier: 'S', totalCents: 116_000, taxCents: 16_000 }))).toEqual({ INVENTORY: 100_000, VAT_INPUT: 16_000, AP: -116_000 });
    expect(billDraft({ date: '2026-10-01', reference: 'B1', supplier: 'S', totalCents: 116_000 }).lines).toEqual(billDraft({ date: '2026-10-01', reference: 'B1', supplier: 'S', totalCents: 116_000, taxCents: 0 }).lines);
    expect(side(billDraft({ date: '2026-10-01', reference: 'B1', supplier: 'S', totalCents: 116_000 }))).toEqual({ INVENTORY: 116_000, AP: -116_000 });
  });

  it('a credit note takes back its share of the VAT', () => {
    const d = billCreditDraft({ date: '2026-10-02', reference: 'B1', supplier: 'S', amountCents: 58_000, taxCents: 16_000, totalCents: 116_000 });
    expect(side(d)).toEqual({ AP: 58_000, INVENTORY: -50_000, VAT_INPUT: -8_000 });
    expect(isBalanced(d.lines)).toBe(true);
  });

  it('an expense with VAT: the cost is the amount less the VAT', () => {
    expect(side(expenseDraft({ date: '2026-10-03', category: 'UTILITIES', label: 'KPLC', amountCents: 11_600, taxCents: 1_600, paidWith: 'MPESA' }))).toMatchObject({ VAT_INPUT: 1_600, MPESA: -11_600 });
  });
});

describe('paying VAT', () => {
  it('uses up the claimable input VAT along with the payment', () => {
    const d = payOffDraft({ date: '2026-10-20', account: 'VAT_OUTPUT', amountCents: 30_000, paidFrom: 'BANK', offsetCents: 16_000 });
    expect(side(d)).toEqual({ VAT_OUTPUT: 46_000, VAT_INPUT: -16_000, BANK: -30_000 });
    expect(side(payOffDraft({ date: '2026-10-20', account: 'PAYE', amountCents: 5_000, paidFrom: 'BANK' }))).toEqual({ PAYE: 5_000, BANK: -5_000 });
  });
});
