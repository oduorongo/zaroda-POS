import { AccountInfo, balanceSheet, profitAndLoss, Sums, trialBalance, withRunningBalance } from './ledger-reports.util';

const acc = (id: string, code: string, type: AccountInfo['type']): AccountInfo => ({ id, code, name: id, type, systemKey: null });
const accounts = [
  acc('cash', '1000', 'ASSET'),
  acc('stock', '1200', 'ASSET'),
  acc('ap', '2000', 'LIABILITY'),
  acc('vat', '2100', 'LIABILITY'),
  acc('capital', '3000', 'EQUITY'),
  acc('sales', '4000', 'INCOME'),
  acc('returns', '4900', 'INCOME'),
  acc('cogs', '5000', 'EXPENSE'),
  acc('rent', '6010', 'EXPENSE'),
];

// owner puts in 1000; buys stock 600 on credit; sells for 1160 cash (160 VAT), cost 400; refunds 116 (16 VAT); pays rent 100
const sums: Sums = new Map([
  ['cash', { debit: 1000 + 1160, credit: 116 + 100 }],
  ['stock', { debit: 600, credit: 400 }],
  ['ap', { debit: 0, credit: 600 }],
  ['vat', { debit: 16, credit: 160 }],
  ['capital', { debit: 0, credit: 1000 }],
  ['sales', { debit: 0, credit: 1000 }],
  ['returns', { debit: 100, credit: 0 }],
  ['cogs', { debit: 400, credit: 0 }],
  ['rent', { debit: 100, credit: 0 }],
]);

describe('ledger statements', () => {
  it('trial balance: debits equal credits', () => {
    const tb = trialBalance(accounts, sums);
    expect(tb.balanced).toBe(true);
    expect(tb.debit).toBe(1944 + 200 + 100 + 400 + 100);
    expect(tb.rows.map((r) => r.code)).toEqual(['1000', '1200', '2000', '2100', '3000', '4000', '4900', '5000', '6010']);
  });
  it('profit and loss: refunds come off income, cost of sales gives gross profit', () => {
    const pl = profitAndLoss(accounts, sums);
    expect(pl.totalIncome).toBe(900);
    expect(pl.totalCostOfSales).toBe(400);
    expect(pl.grossProfit).toBe(500);
    expect(pl.totalExpenses).toBe(100);
    expect(pl.netProfit).toBe(400);
  });
  it('balance sheet balances with the profit to date under equity', () => {
    const bs = balanceSheet(accounts, sums);
    expect(bs.totalAssets).toBe(1944 + 200);
    expect(bs.totalLiabilities).toBe(600 + 144);
    expect(bs.profitToDate).toBe(400);
    expect(bs.totalEquity).toBe(1400);
    expect(bs.balanced).toBe(true);
  });
  it('running balance follows the account side', () => {
    expect(withRunningBalance('ASSET', 100, [{ debit: 50, credit: 0 }, { debit: 0, credit: 30 }]).map((l) => l.balance)).toEqual([150, 120]);
    expect(withRunningBalance('LIABILITY', 0, [{ debit: 0, credit: 50 }]).map((l) => l.balance)).toEqual([50]);
  });
});
