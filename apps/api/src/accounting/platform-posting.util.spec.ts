import { PLATFORM_ACCOUNTS } from './ledger-chart';
import { Draft, isBalanced } from './ledger-posting.util';
import {
  platformAdvertDraft,
  platformInvoiceDraft,
  platformInvoiceIncome,
  platformInvoicePaidDraft,
  platformPayoutDraft,
  platformSubscriptionDraft,
} from './platform-posting.util';

const amount = (d: Draft, account: string) => {
  const l = d.lines.find((x) => x.account === account);
  return l ? l.debit - l.credit : 0;
};

describe("ZARODA's own books", () => {
  it('has a chart with unique keys and codes, holding every key a draft uses', () => {
    expect(new Set(PLATFORM_ACCOUNTS.map((a) => a.key)).size).toBe(PLATFORM_ACCOUNTS.length);
    expect(new Set(PLATFORM_ACCOUNTS.map((a) => a.code)).size).toBe(PLATFORM_ACCOUNTS.length);
    const keys = new Set<string>(PLATFORM_ACCOUNTS.map((a) => a.key));
    for (const k of ['RECEIVABLE', 'COMMISSION_INCOME', 'CONVENIENCE_FEE_INCOME', 'RENTAL_PLAN_INCOME', 'COLLECTION_FEE_INCOME', 'ADVERT_INCOME', 'SALES_COMMISSIONS', 'WHT_PAYABLE', 'MPESA', 'BANK', 'CASH'])
      expect(keys.has(k)).toBe(true);
  });
  it('a subscription paid is income, into the money account it came by', () => {
    const d = platformSubscriptionDraft({ date: 'd', business: 'Shop', amountCents: 150000, method: 'BANK' });
    expect(amount(d, 'BANK')).toBe(150000);
    expect(amount(d, 'SUBSCRIPTION_INCOME')).toBe(-150000);
  });
  it('an invoice is income and owed; paying it clears what is owed', () => {
    expect(platformInvoiceIncome('COMMISSION', 'MONTHLY')).toBe('COMMISSION_INCOME');
    expect(platformInvoiceIncome('COMMISSION', 'DAILY_FEE')).toBe('CONVENIENCE_FEE_INCOME');
    expect(platformInvoiceIncome('RENTAL', 'SUBSCRIPTION')).toBe('RENTAL_PLAN_INCOME');
    expect(platformInvoiceIncome('RENTAL', 'COLLECTION_FEE')).toBe('COLLECTION_FEE_INCOME');
    const inv = platformInvoiceDraft({ date: 'd', reference: 'C1', business: 'Shop', amountCents: 300, income: 'CONVENIENCE_FEE_INCOME' });
    expect(amount(inv, 'RECEIVABLE')).toBe(300);
    expect(amount(inv, 'CONVENIENCE_FEE_INCOME')).toBe(-300);
    const paid = platformInvoicePaidDraft({ date: 'd', reference: 'C1', business: 'Shop', amountCents: 300, method: null });
    expect(amount(paid, 'MPESA')).toBe(300);
    expect(amount(paid, 'RECEIVABLE')).toBe(-300);
  });
  it('advert fees come in by M-Pesa', () => {
    expect(amount(platformAdvertDraft({ date: 'd', business: 'L', amountCents: 20000 }), 'ADVERT_INCOME')).toBe(-20000);
  });
  it('a sales-agent payout: the full commission is the cost, the tax held is owed to KRA', () => {
    const d = platformPayoutDraft({ date: 'd', agent: 'A', amountCents: 10000, taxCents: 500, method: 'MPESA_B2C' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'SALES_COMMISSIONS')).toBe(10000);
    expect(amount(d, 'MPESA')).toBe(-9500);
    expect(amount(d, 'WHT_PAYABLE')).toBe(-500);
    expect(amount(platformPayoutDraft({ date: 'd', agent: 'A', amountCents: 100, taxCents: 0, method: 'MANUAL' }), 'BANK')).toBe(-100);
  });
});
