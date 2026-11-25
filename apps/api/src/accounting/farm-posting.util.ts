import { AccountKey } from './ledger-chart';
import { Draft, DraftLine, moneyAccount, tidy } from './ledger-posting.util';

const dr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: cents, credit: 0 });
const cr = (account: AccountKey, cents: number): DraftLine => ({ account, debit: 0, credit: cents });

/** A farm pay run once every worker is paid: casual wages against the statutory deductions owed and what went out by each method. */
export function farmWagesDraft(p: {
  date: string;
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
    const a: AccountKey = l.method === 'CASH' ? 'CASH' : 'MPESA';
    out.set(a, (out.get(a) ?? 0) + l.netCents);
  }
  const net = p.paid.reduce((a, l) => a + l.netCents, 0);
  const other = p.grossCents - p.payeCents - p.nssfCents - p.shifCents - p.housingCents - net;
  return {
    date: p.date,
    memo: `Farm wages ${p.reference}`,
    lines: tidy([
      dr('FARM_LABOUR', p.grossCents),
      cr('PAYE', p.payeCents),
      cr('NSSF', p.nssfCents),
      cr('SHIF', p.shifCents),
      cr('HOUSING_LEVY', p.housingCents),
      ...[...out].map(([a, c]) => cr(a, c)),
      ...(other ? [cr('CASH', other)] : []),
    ]),
  };
}

/** Produce delivered on credit: the buyer owes it as a sale; the stock that left is its cost. Farm produce carries no VAT here. */
export function farmDeliveryDraft(d: { date: string; branchId: string | null; reference: string; amountCents: number; costCents: number }): Draft {
  return {
    date: d.date,
    branchId: d.branchId,
    memo: `Delivered on credit: ${d.reference}`,
    lines: tidy([dr('AR', d.amountCents), cr('SALES', d.amountCents), ...(d.costCents > 0 ? [dr('COGS', d.costCents), cr('INVENTORY', d.costCents)] : [])]),
  };
}

/** Money a buyer paid against what it owes. */
export function farmBuyerPaymentDraft(p: { date: string; reference: string; amountCents: number; method: string }): Draft {
  return { date: p.date, memo: `Payment from ${p.reference}`, lines: tidy([dr(moneyAccount(p.method), p.amountCents), cr('AR', p.amountCents)]) };
}

/** Feed fed, or seed, fertiliser and chemicals used on a field: out of stock at cost, into what the farm spends on them. */
export function farmStockUseDraft(u: { date: string; branchId: string | null; kind: 'FEED' | 'INPUTS'; reference: string; costCents: number }): Draft {
  const into: AccountKey = u.kind === 'FEED' ? 'FEED_USED' : 'FARM_INPUTS';
  return { date: u.date, branchId: u.branchId, memo: `${u.kind === 'FEED' ? 'Feed fed' : 'Used on the field'}: ${u.reference}`, lines: tidy([dr(into, u.costCents), cr('INVENTORY', u.costCents)]) };
}
