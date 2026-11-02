// The standard statements from the account totals: trial balance, profit and loss, balance sheet. Plain functions on cents.
import { isDebitNormal, LedgerAccountType } from './ledger-chart';

export interface AccountInfo {
  id: string;
  code: string;
  name: string;
  type: LedgerAccountType;
  systemKey: string | null;
}

/** Debits and credits on one account over a period (cents). */
export type Sums = Map<string, { debit: number; credit: number }>;

export interface Row {
  accountId: string;
  code: string;
  name: string;
  /** In the account's normal direction: positive is the usual balance (a debit for assets and costs, a credit for the rest). */
  amount: number;
}

const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code, undefined, { numeric: true });

function rows(accounts: AccountInfo[], sums: Sums, pick: (a: AccountInfo) => boolean): Row[] {
  return accounts
    .filter(pick)
    .map((a) => {
      const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
      return { accountId: a.id, code: a.code, name: a.name, amount: isDebitNormal(a.type) ? s.debit - s.credit : s.credit - s.debit };
    })
    .filter((r) => r.amount !== 0)
    .sort(byCode);
}

const total = (rs: Row[]) => rs.reduce((s, r) => s + r.amount, 0);

/** Every account with a balance, as a debit or a credit; the two columns are always equal when the books balance. */
export function trialBalance(accounts: AccountInfo[], sums: Sums) {
  const list = accounts
    .map((a) => {
      const s = sums.get(a.id) ?? { debit: 0, credit: 0 };
      const net = s.debit - s.credit;
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0)
    .sort(byCode);
  const debit = list.reduce((s, r) => s + r.debit, 0);
  const credit = list.reduce((s, r) => s + r.credit, 0);
  return { rows: list, debit, credit, balanced: debit === credit };
}

/** Costs that go into the cost of sales (codes in the 5000s: what was sold, and stock wasted). */
const isCostOfSales = (a: AccountInfo) => a.type === 'EXPENSE' && a.code.startsWith('5');

/** Profit and loss over a period: income, less the cost of what was sold (gross profit), less running costs (net profit). */
export function profitAndLoss(accounts: AccountInfo[], sums: Sums) {
  const income = rows(accounts, sums, (a) => a.type === 'INCOME');
  const costOfSales = rows(accounts, sums, isCostOfSales);
  const expenses = rows(accounts, sums, (a) => a.type === 'EXPENSE' && !isCostOfSales(a));
  const totalIncome = total(income);
  const totalCostOfSales = total(costOfSales);
  const grossProfit = totalIncome - totalCostOfSales;
  const totalExpenses = total(expenses);
  return { income, totalIncome, costOfSales, totalCostOfSales, grossProfit, expenses, totalExpenses, netProfit: grossProfit - totalExpenses };
}

/**
 * The balance sheet on a day: what the business has, what it owes, and what belongs to the owner. Profit not yet moved to an equity
 * account (all income less all costs to that day) is shown under equity, so the sheet always balances when the books do.
 */
export function balanceSheet(accounts: AccountInfo[], sums: Sums) {
  const assets = rows(accounts, sums, (a) => a.type === 'ASSET');
  const liabilities = rows(accounts, sums, (a) => a.type === 'LIABILITY');
  const equity = rows(accounts, sums, (a) => a.type === 'EQUITY');
  const pl = profitAndLoss(accounts, sums);
  const totalAssets = total(assets);
  const totalLiabilities = total(liabilities);
  const totalEquity = total(equity) + pl.netProfit;
  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equity,
    profitToDate: pl.netProfit,
    totalEquity,
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

/** One account's movements in order, with the running balance in the account's normal direction. */
export function withRunningBalance<T extends { debit: number; credit: number }>(type: LedgerAccountType, opening: number, lines: T[]) {
  let bal = opening;
  return lines.map((l) => {
    bal += isDebitNormal(type) ? l.debit - l.credit : l.credit - l.debit;
    return { ...l, balance: bal };
  });
}

/** Cash and cash equivalents: the asset accounts numbered 1000-1099 (cash, M-Pesa, bank, card payments on their way). */
export const isMoneyAccount = (a: Pick<AccountInfo, 'type' | 'code'>) => a.type === 'ASSET' && /^10\d\d$/.test(a.code);

export type CashActivity = 'OPERATING' | 'INVESTING' | 'FINANCING';

/** Long-lived assets (codes 15xx-19xx) are investing; equity and long-term loans (codes 25xx-29xx) are financing; the rest is trading. */
export function cashActivity(a: Pick<AccountInfo, 'type' | 'code'>): CashActivity {
  if (a.type === 'ASSET' && /^1[5-9]/.test(a.code)) return 'INVESTING';
  if (a.type === 'EQUITY' || (a.type === 'LIABILITY' && /^2[5-9]/.test(a.code))) return 'FINANCING';
  return 'OPERATING';
}

/**
 * The cash flow statement (direct method) from the books. Every entry that moves money is balanced by its other lines, so each of those
 * lines is where that money came from or went: effects holds, per account, the money it brought in (positive) or took out (negative).
 * Moves between money accounts (banking cash, M-Pesa to bank) have no other lines and so change nothing.
 */
export function cashFlow(accounts: AccountInfo[], effects: Map<string, number>, openingCents: number, closingCents: number) {
  const section = (activity: CashActivity) => {
    const list = accounts
      .filter((a) => !isMoneyAccount(a) && cashActivity(a) === activity && (effects.get(a.id) ?? 0) !== 0)
      .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: effects.get(a.id) ?? 0 }))
      .sort(byCode);
    return { rows: list, total: total(list) };
  };
  const operating = section('OPERATING');
  const investing = section('INVESTING');
  const financing = section('FINANCING');
  const net = operating.total + investing.total + financing.total;
  return { opening: openingCents, operating, investing, financing, net, closing: closingCents, reconciles: openingCents + net === closingCents };
}
