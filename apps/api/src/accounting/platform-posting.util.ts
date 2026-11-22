// What the money ZARODA charges and pays means in ZARODA's own books. Plain functions on cents, like ledger-posting.util.ts.
import { Draft, DraftLine, moneyAccount, tidy } from './ledger-posting.util';

const dr = (account: string, cents: number): DraftLine => ({ account, debit: cents, credit: 0 });
const cr = (account: string, cents: number): DraftLine => ({ account, debit: 0, credit: cents });

/** A business paid its subscription. */
export function platformSubscriptionDraft(p: { date: string; business: string; amountCents: number; method: string | null }): Draft {
  return { date: p.date, memo: `Subscription from ${p.business}`, lines: tidy([dr(moneyAccount(p.method), p.amountCents), cr('SUBSCRIPTION_INCOME', p.amountCents)]) };
}

/** Which income an invoice to a business is. */
export function platformInvoiceIncome(table: 'COMMISSION' | 'RENTAL', kind: string): string {
  if (table === 'COMMISSION') return kind === 'DAILY_FEE' ? 'CONVENIENCE_FEE_INCOME' : 'COMMISSION_INCOME';
  return kind === 'COLLECTION_FEE' ? 'COLLECTION_FEE_INCOME' : 'RENTAL_PLAN_INCOME';
}

/** An invoice issued to a business: income now, owed by the business until paid. */
export function platformInvoiceDraft(p: { date: string; reference: string; business: string; amountCents: number; income: string }): Draft {
  return { date: p.date, memo: `Invoice ${p.reference} to ${p.business}`, lines: tidy([dr('RECEIVABLE', p.amountCents), cr(p.income, p.amountCents)]) };
}

export function platformInvoicePaidDraft(p: { date: string; reference: string; business: string; amountCents: number; method: string | null }): Draft {
  return { date: p.date, memo: `${p.business} paid invoice ${p.reference}`, lines: tidy([dr(moneyAccount(p.method ?? 'MPESA'), p.amountCents), cr('RECEIVABLE', p.amountCents)]) };
}

/** A landlord paid for house adverts by M-Pesa. */
export function platformAdvertDraft(p: { date: string; business: string; amountCents: number }): Draft {
  return { date: p.date, memo: `House advert fee from ${p.business}`, lines: tidy([dr('MPESA', p.amountCents), cr('ADVERT_INCOME', p.amountCents)]) };
}

/** A sales agent paid: the full commission is the cost; the tax held back is owed to KRA; the rest left the money account. */
export function platformPayoutDraft(p: { date: string; agent: string; amountCents: number; taxCents: number; method: string }): Draft {
  const tax = Math.min(p.taxCents, p.amountCents);
  const from = p.method === 'MPESA_B2C' || p.method === 'TUMA' ? 'MPESA' : p.method === 'MANUAL' ? 'BANK' : moneyAccount(p.method);
  return {
    date: p.date,
    memo: `Commission paid to ${p.agent}`,
    lines: tidy([dr('SALES_COMMISSIONS', p.amountCents), cr(from, p.amountCents - tax), cr('WHT_PAYABLE', tax)]),
  };
}

/** A construction business paid ZARODA: its plan or extra projects, an SMS bundle, or a month's wage payout fees. */
export function platformConPaymentDraft(p: { date: string; business: string; label: string; income: string; amountCents: number; method: string | null }): Draft {
  return { date: p.date, memo: `${p.business}: ${p.label}`, lines: tidy([dr(moneyAccount(p.method), p.amountCents), cr(p.income, p.amountCents)]) };
}

/** Which income account each of ZARODA's other apps posts to. */
export const APP_INCOME_ACCOUNT: Record<string, string> = {
  SCHOOL_RECORDS: 'SCHOOL_RECORDS_INCOME',
  BOOKS: 'BOOKS_INCOME',
  SPORTS: 'SPORTS_INCOME',
  EVENTS: 'EVENTS_INCOME',
};

/** Money ZARODA earned in another of its apps (reported by that app; it reached ZARODA's M-Pesa/Tuma). */
export function platformAppIncomeDraft(p: { date: string; app: string; payer: string; description: string; amountCents: number; reference: string | null }): Draft {
  return {
    date: p.date,
    memo: `${p.description} from ${p.payer}${p.reference ? ` (${p.reference})` : ''}`,
    lines: tidy([dr('MPESA', p.amountCents), cr(APP_INCOME_ACCOUNT[p.app] ?? 'OTHER_INCOME', p.amountCents)]),
  };
}

/** A school paid its Zaroda School subscription (reported by Zaroda School; the money reached ZARODA's M-Pesa/Tuma). */
export function platformSchoolPaymentDraft(p: { date: string; school: string; amountCents: number; reference: string | null }): Draft {
  return {
    date: p.date,
    memo: `Zaroda School subscription from ${p.school}${p.reference ? ` (${p.reference})` : ''}`,
    lines: tidy([dr('MPESA', p.amountCents), cr('SCHOOL_SUBSCRIPTION_INCOME', p.amountCents)]),
  };
}
