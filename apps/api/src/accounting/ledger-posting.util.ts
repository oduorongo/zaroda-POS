// What each thing that happens in the business means in the books: the journal lines for a sale, a refund, an expense, a supplier's
// bill and its payment, a payroll run, a school's receipt, rent... Plain functions on amounts in cents, tested without a database.
// Every draft balances (debits = credits); the poster refuses one that does not.
import { createHash } from 'crypto';
import { AccountKey, expenseAccount } from './ledger-chart';

export interface DraftLine {
  account: AccountKey;
  debit: number; // cents
  credit: number; // cents
}

export interface Draft {
  /** The day it belongs to (YYYY-MM-DD, Nairobi). */
  date: string;
  memo: string;
  branchId?: string | null;
  lines: DraftLine[];
}

export const toCents = (v: unknown): number => Math.round(Number(v ?? 0) * 100);

/**
 * Tidies a set of lines: same account on the same side added together, an account on both sides netted to one side, zero lines
 * dropped, and a stable order (so the same posting always has the same fingerprint).
 */
export function tidy(lines: DraftLine[]): DraftLine[] {
  const net = new Map<AccountKey, number>();
  for (const l of lines) net.set(l.account, (net.get(l.account) ?? 0) + l.debit - l.credit);
  return [...net.entries()]
    .filter(([, n]) => n !== 0)
    .map(([account, n]) => ({ account, debit: n > 0 ? n : 0, credit: n < 0 ? -n : 0 }))
    .sort((a, b) => (a.debit > 0 ? 0 : 1) - (b.debit > 0 ? 0 : 1) || a.account.localeCompare(b.account));
}

export function isBalanced(lines: DraftLine[]): boolean {
  const d = lines.reduce((s, l) => s + l.debit, 0);
  const c = lines.reduce((s, l) => s + l.credit, 0);
  return d === c && lines.every((l) => l.debit >= 0 && l.credit >= 0 && Number.isInteger(l.debit) && Number.isInteger(l.credit));
}

const dr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: cents, credit: 0 });
const cr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: 0, credit: cents });

/** Swaps every line's side: what undoes a posting. */
export const reversed = (lines: DraftLine[]): DraftLine[] => lines.map((l) => ({ account: l.account, debit: l.credit, credit: l.debit }));

/** A short, stable signature of a posting, so the poster can tell when a source has changed and must be posted again. */
export function fingerprint(d: Draft | null): string {
  if (!d) return 'none';
  const body = JSON.stringify([d.date, d.branchId ?? null, tidy(d.lines).map((l) => [l.account, l.debit, l.credit])]);
  return createHash('sha1').update(body).digest('hex');
}

/** Where money taken at a till lands. */
export function saleMethodAccount(method: string): AccountKey {
  switch (method) {
    case 'CASH':
      return 'CASH';
    case 'MPESA':
    case 'MPESA_RECEIPT':
      return 'MPESA';
    case 'CARD':
      return 'CARD_CLEARING';
    case 'ACCOUNT':
      return 'AR';
    case 'ROOM_CHARGE':
      return 'GUEST_AR';
    case 'WALLET':
      return 'CUSTOMER_DEPOSITS';
    default:
      return 'CASH';
  }
}

/** Where money paid out or received by other means lands (expenses, supplier bills, school receipts, rent). */
export function moneyAccount(method: string | null | undefined): AccountKey {
  switch (method) {
    case 'MPESA':
    case 'TUMA':
    case 'DARAJA':
      return 'MPESA';
    case 'BANK':
    case 'BANK_TRANSFER':
    case 'CHEQUE':
    case 'CARD':
      return 'BANK';
    default:
      return 'CASH';
  }
}

/** The VAT in a sale's total: the lines' tax, scaled down by any discount taken off the tax-inclusive total. */
export function saleTaxCents(totalCents: number, lines: { netCents: number; taxCents: number }[]): number {
  const gross = lines.reduce((t, l) => t + l.netCents + l.taxCents, 0);
  const lineTax = lines.reduce((t, l) => t + l.taxCents, 0);
  return gross > 0 ? Math.min(totalCents, Math.round((lineTax * totalCents) / gross)) : 0;
}

/**
 * A completed sale: the money (or debt) by how it was paid, against sales and the VAT in it, and the cost of what was sold out of stock.
 * Discounts come off the tax-inclusive total, so the VAT is scaled down with them. A hotel stay's settlement sale was already paid
 * into the guest's account as the guest paid (folio payments), so all of its payments are taken from the guest's account instead.
 */
export function saleDraft(s: {
  date: string;
  branchId?: string | null;
  reference: string;
  totalCents: number;
  /** Each line before the sale's discount: its price before tax and its tax. */
  lines: { netCents: number; taxCents: number }[];
  payments: { method: string; amountCents: number }[];
  costCents: number;
  settlement?: boolean;
}): Draft {
  const tax = saleTaxCents(s.totalCents, s.lines);
  const paid = s.payments.reduce((t, p) => t + p.amountCents, 0);
  const lines: DraftLine[] = s.payments.map((p) => dr(s.settlement ? 'GUEST_AR' : saleMethodAccount(p.method), p.amountCents));
  // payments always equal the total; if they ever do not, the difference is kept visible as money still owed
  if (paid !== s.totalCents) lines.push(paid < s.totalCents ? dr('AR', s.totalCents - paid) : cr('AR', paid - s.totalCents));
  lines.push(cr('SALES', s.totalCents - tax), cr('VAT_OUTPUT', tax));
  if (s.costCents > 0) lines.push(dr('COGS', s.costCents), cr('INVENTORY', s.costCents));
  return { date: s.date, branchId: s.branchId, memo: `Sale ${s.reference}`, lines: tidy(lines) };
}

/**
 * Money given back on a sale. The VAT share comes back off the VAT owed; the rest is a refund against sales. It is paid back the way
 * most of the sale was paid (for a school's invoice, a credit note: it comes off what the school owes).
 */
export function refundDraft(r: {
  date: string;
  branchId?: string | null;
  reference: string;
  amountCents: number;
  saleTotalCents: number;
  saleTaxCents: number;
  mainMethod: string;
  settlement?: boolean;
}): Draft {
  const tax = r.saleTotalCents > 0 ? Math.min(r.amountCents, Math.round((r.saleTaxCents * r.amountCents) / r.saleTotalCents)) : 0;
  const back = r.settlement ? 'GUEST_AR' : saleMethodAccount(r.mainMethod);
  return {
    date: r.date,
    branchId: r.branchId,
    memo: `Refund on sale ${r.reference}`,
    lines: tidy([dr('SALES_RETURNS', r.amountCents - tax), dr('VAT_OUTPUT', tax), cr(back, r.amountCents)]),
  };
}

export function expenseDraft(e: { date: string; branchId?: string | null; category: string; label: string; amountCents: number; paidWith: string | null }): Draft {
  return {
    date: e.date,
    branchId: e.branchId,
    memo: `Expense: ${e.label}`,
    lines: tidy([dr(expenseAccount(e.category), e.amountCents), cr(moneyAccount(e.paidWith), e.amountCents)]),
  };
}

/** A supplier's bill for stock: the stock comes in, and the business owes the supplier. */
export function billDraft(b: { date: string; reference: string; supplier: string; totalCents: number }): Draft {
  return { date: b.date, memo: `Bill ${b.reference} from ${b.supplier}`, lines: tidy([dr('INVENTORY', b.totalCents), cr('AP', b.totalCents)]) };
}

/** A credit from a supplier against a bill (goods sent back, a price corrected): less owed, less stock. */
export function billCreditDraft(b: { date: string; reference: string; supplier: string; amountCents: number }): Draft {
  return { date: b.date, memo: `Credit on bill ${b.reference} from ${b.supplier}`, lines: tidy([dr('AP', b.amountCents), cr('INVENTORY', b.amountCents)]) };
}

export function billPaymentDraft(b: { date: string; reference: string; supplier: string; amountCents: number; method: string }): Draft {
  return { date: b.date, memo: `Paid ${b.supplier} (bill ${b.reference})`, lines: tidy([dr('AP', b.amountCents), cr(moneyAccount(b.method), b.amountCents)]) };
}

/**
 * A payroll run paid: the full pay is the cost; what was deducted is owed to KRA, NSSF, SHIF and the housing levy until it is sent;
 * what staff took home left the account payroll is paid from.
 */
export function payrollDraft(p: {
  date: string;
  period: string;
  grossCents: number;
  payeCents: number;
  nssfCents: number;
  shifCents: number;
  housingCents: number;
  netCents: number;
  paidFrom: string;
}): Draft {
  const deductions = p.payeCents + p.nssfCents + p.shifCents + p.housingCents;
  // any deduction the payslip does not name (a loan, an advance) stays with the money paid out, so the entry always balances
  const out = p.grossCents - deductions;
  return {
    date: p.date,
    memo: `Payroll ${p.period}`,
    lines: tidy([
      dr('SALARIES', p.grossCents),
      cr('PAYE', p.payeCents),
      cr('NSSF', p.nssfCents),
      cr('SHIF', p.shifCents),
      cr('HOUSING_LEVY', p.housingCents),
      cr(moneyAccount(p.paidFrom), out),
    ]),
  };
}

/** Money from a school against what it owes; tax it withheld is not money but a credit with KRA. */
export function schoolReceiptDraft(r: { date: string; reference: string; school: string; amountCents: number; method: string }): Draft {
  const into: AccountKey = r.method === 'WITHHOLDING_TAX' ? 'WHT_RECEIVABLE' : moneyAccount(r.method);
  return { date: r.date, memo: `Receipt ${r.reference} from ${r.school}`, lines: tidy([dr(into, r.amountCents), cr('AR', r.amountCents)]) };
}

/** A debt written off: it no longer counts as owed, and is a cost. */
export function writeOffDraft(w: { date: string; reference: string; amountCents: number }): Draft {
  return { date: w.date, memo: `Bad debt written off (${w.reference})`, lines: tidy([dr('BAD_DEBTS', w.amountCents), cr('AR', w.amountCents)]) };
}

/** A change in what is set aside for debts that may not be paid: a rise is a cost, a fall gives it back. */
export function provisionDraft(p: { date: string; changeCents: number }): Draft {
  const c = p.changeCents;
  return {
    date: p.date,
    memo: 'Change in the amount set aside for bad debts',
    lines: tidy(c >= 0 ? [dr('BAD_DEBTS', c), cr('BAD_DEBT_ALLOWANCE', c)] : [dr('BAD_DEBT_ALLOWANCE', -c), cr('BAD_DEBTS', -c)]),
  };
}

/** Rent, a deposit or another charge put on a tenant's account. A deposit is held for the tenant, not income. */
export function rentInvoiceDraft(r: { date: string; kind: string; reference: string; amountCents: number }): Draft {
  const to: AccountKey = r.kind === 'RENT' ? 'RENT_INCOME' : r.kind === 'DEPOSIT' ? 'TENANT_DEPOSITS' : 'RENT_OTHER_INCOME';
  return { date: r.date, memo: `${r.kind === 'RENT' ? 'Rent' : r.kind === 'DEPOSIT' ? 'Deposit' : 'Charge'}: ${r.reference}`, lines: tidy([dr('RENT_AR', r.amountCents), cr(to, r.amountCents)]) };
}

export function rentPaymentDraft(r: { date: string; reference: string; amountCents: number; method: string }): Draft {
  return { date: r.date, memo: `Rent payment ${r.reference}`, lines: tidy([dr(moneyAccount(r.method), r.amountCents), cr('RENT_AR', r.amountCents)]) };
}

/** Stock thrown away or lost, at what it cost. */
export function wasteDraft(w: { date: string; branchId?: string | null; label: string; costCents: number }): Draft {
  return { date: w.date, branchId: w.branchId, memo: `Waste: ${w.label}`, lines: tidy([dr('WASTE', w.costCents), cr('INVENTORY', w.costCents)]) };
}

/** A layaway instalment: the money is the customer's until the goods are collected. */
export function layawayPaymentDraft(l: { date: string; branchId?: string | null; reference: string; amountCents: number; method: string }): Draft {
  return { date: l.date, branchId: l.branchId, memo: `Layaway payment (${l.reference})`, lines: tidy([dr(saleMethodAccount(l.method), l.amountCents), cr('CUSTOMER_DEPOSITS', l.amountCents)]) };
}

/** A layaway collected: the deposits become a sale, and the goods leave stock. */
export function layawayCompleteDraft(l: { date: string; branchId?: string | null; reference: string; totalCents: number; taxCents: number; costCents: number }): Draft {
  const tax = Math.min(l.taxCents, l.totalCents);
  const lines = [dr('CUSTOMER_DEPOSITS', l.totalCents), cr('SALES', l.totalCents - tax), cr('VAT_OUTPUT', tax)];
  if (l.costCents > 0) lines.push(dr('COGS', l.costCents), cr('INVENTORY', l.costCents));
  return { date: l.date, branchId: l.branchId, memo: `Layaway collected (${l.reference})`, lines: tidy(lines) };
}

/** A hotel guest paying (or being paid back) at the desk, before the stay is settled. */
export function folioMoneyDraft(f: { date: string; reference: string; amountCents: number; method: string; refund: boolean }): Draft {
  const money = saleMethodAccount(f.method);
  const lines = f.refund ? [dr('GUEST_AR', f.amountCents), cr(money, f.amountCents)] : [dr(money, f.amountCents), cr('GUEST_AR', f.amountCents)];
  return { date: f.date, memo: `${f.refund ? 'Refund to' : 'Payment from'} hotel guest (${f.reference})`, lines: tidy(lines) };
}

/** A cancelled or no-show booking where the hotel kept a fee out of what the guest paid: that part is now the hotel's income. */
export function cancelFeeDraft(c: { date: string; reference: string; feeCents: number }): Draft {
  return { date: c.date, memo: `Cancellation fee kept (${c.reference})`, lines: tidy([dr('GUEST_AR', c.feeCents), cr('OTHER_INCOME', c.feeCents)]) };
}

/** A manual journal's problem, or null: at least two lines, each one side only, and balanced. */
export function manualProblem(lines: { debit: number; credit: number }[]): string | null {
  if (lines.length < 2) return 'A journal needs at least two lines.';
  for (const l of lines) {
    if (l.debit < 0 || l.credit < 0) return 'Amounts cannot be negative.';
    if (l.debit > 0 && l.credit > 0) return 'Each line is either a debit or a credit, not both.';
    if (l.debit === 0 && l.credit === 0) return 'A line has no amount.';
  }
  const d = lines.reduce((s, l) => s + l.debit, 0);
  const c = lines.reduce((s, l) => s + l.credit, 0);
  if (d !== c) return `Debits (${(d / 100).toFixed(2)}) and credits (${(c / 100).toFixed(2)}) must be equal.`;
  return null;
}

/** The day after a date (YYYY-MM-DD). */
export function nextDay(day: string): string {
  const t = new Date(`${day}T00:00:00.000Z`).getTime() + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** The date a posting is entered on: its own day, or the first open day after the books were closed. */
export const postingDate = (day: string, lockDate: string | null): string => (lockDate && day <= lockDate ? nextDay(lockDate) : day);
