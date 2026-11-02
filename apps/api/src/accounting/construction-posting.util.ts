// What construction's money means in a contractor's books (docs/construction). IPCs themselves are sales on account and are
// posted as sales; these are the rest: retention, money received against IPCs, site payroll, subcontractors and ZARODA.
import { AccountKey } from './ledger-chart';
import { Draft, DraftLine, moneyAccount, tidy } from './ledger-posting.util';

const dr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: cents, credit: 0 });
const cr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: 0, credit: cents });

/**
 * Retention the client keeps back on a certificate is income already earned, held as an asset until released. A release is paid
 * through the next certificate, whose sale counts it as sales again, so the release takes it back out of sales.
 */
export function retentionDraft(r: { date: string; projectId: string; type: 'DEDUCT' | 'RELEASE'; project: string; reason: string; amountCents: number }): Draft {
  // a reversal certificate deducts a negative amount: tidy() puts it on the other side
  const c = r.amountCents;
  const lines = r.type === 'DEDUCT' ? [dr('RETENTION_RECEIVABLE', c), cr('SALES', c)] : [dr('SALES', c), cr('RETENTION_RECEIVABLE', c)];
  return { date: r.date, projectId: r.projectId, memo: `Retention ${r.type === 'DEDUCT' ? 'held' : 'released'} - ${r.project} ${r.reason}`, lines: tidy(lines) };
}

/** Money from the client against an IPC; a withholding certificate is not money but a credit with KRA. */
export function ipcReceiptDraft(r: { date: string; projectId: string; kind: 'PAYMENT' | 'WHT' | 'WHT_VAT'; reference: string; amountCents: number; method: string | null }): Draft {
  const into: AccountKey = r.kind === 'PAYMENT' ? moneyAccount(r.method ?? 'BANK') : 'WHT_RECEIVABLE';
  const what = r.kind === 'PAYMENT' ? 'Payment' : r.kind === 'WHT' ? 'Withholding tax certificate' : 'Withholding VAT certificate';
  return { date: r.date, projectId: r.projectId, memo: `${what} on ${r.reference}`, lines: tidy([dr(into, r.amountCents), cr('AR', r.amountCents)]) };
}

/** A site pay run once every worker is paid: wages (a direct cost of the job) against the statutory deductions owed and what went out by each method. */
export function conPayrollDraft(p: {
  date: string;
  projectId: string;
  reference: string;
  grossCents: number;
  payeCents: number;
  nssfCents: number;
  shifCents: number;
  housingCents: number;
  paid: { method: string; netCents: number }[];
}): Draft {
  const out = new Map<AccountKey, number>();
  for (const l of p.paid) {
    const a = l.method === 'CASH' ? 'CASH' : 'MPESA';
    out.set(a, (out.get(a) ?? 0) + l.netCents);
  }
  const net = p.paid.reduce((a, l) => a + l.netCents, 0);
  // anything not named (rounding) stays with the money paid out, so the entry always balances
  const other = p.grossCents - p.payeCents - p.nssfCents - p.shifCents - p.housingCents - net;
  return {
    date: p.date,
    projectId: p.projectId,
    memo: `Site payroll ${p.reference}`,
    lines: tidy([
      dr('SITE_LABOUR', p.grossCents),
      cr('PAYE', p.payeCents),
      cr('NSSF', p.nssfCents),
      cr('SHIF', p.shifCents),
      cr('HOUSING_LEVY', p.housingCents),
      ...[...out].map(([a, c]) => cr(a, c)),
      ...(other ? [cr('CASH', other)] : []),
    ]),
  };
}

/** An approved subcontractor valuation: the work done since the last one is a cost; what we hold back is retention we owe; the rest is owed now. */
export function subValuationDraft(s: { date: string; projectId: string; reference: string; workCents: number; retentionCents: number }): Draft {
  return {
    date: s.date,
    projectId: s.projectId,
    memo: `Subcontract valuation ${s.reference}`,
    lines: tidy([dr('SUBCONTRACTORS', s.workCents), cr('RETENTION_PAYABLE', s.retentionCents), cr('AP', s.workCents - s.retentionCents)]),
  };
}

export function subPaymentDraft(s: { date: string; projectId: string; reference: string; amountCents: number }): Draft {
  return { date: s.date, projectId: s.projectId, memo: `Paid subcontractor ${s.reference}`, lines: tidy([dr('AP', s.amountCents), cr('BANK', s.amountCents)]) };
}

/** Materials taken out of a site store: used on the works is a cost of the job, wasted is a loss, both out of stock. */
export function materialIssueDraft(m: { date: string; projectId: string; branchId: string | null; kind: 'USED' | 'WASTED'; label: string; costCents: number }): Draft {
  const to: AccountKey = m.kind === 'USED' ? 'SITE_MATERIALS' : 'WASTE';
  return { date: m.date, projectId: m.projectId, branchId: m.branchId, memo: `${m.kind === 'USED' ? 'Issued to site' : 'Wasted on site'}: ${m.label}`, lines: tidy([dr(to, m.costCents), cr('INVENTORY', m.costCents)]) };
}

/** The business paid ZARODA (construction plan, extra projects, an SMS bundle or the month's payout fees) by M-Pesa or bank. */
export function conZarodaDraft(z: { date: string; label: string; amountCents: number; method: string | null }): Draft {
  return { date: z.date, memo: `ZARODA: ${z.label}`, lines: tidy([dr('ZARODA_FEES', z.amountCents), cr(moneyAccount(z.method ?? 'MPESA'), z.amountCents)]) };
}

export const CON_PAYMENT_LABEL: Record<string, string> = { PLAN: 'construction plan', EXTRA_PROJECTS: 'extra project slots', SMS: 'SMS bundle', FEES: 'wage payout fees' };
export const CON_PAYMENT_INCOME: Record<string, string> = { PLAN: 'CONSTRUCTION_PLAN_INCOME', EXTRA_PROJECTS: 'CONSTRUCTION_PLAN_INCOME', SMS: 'SMS_INCOME', FEES: 'PAYOUT_FEE_INCOME' };
