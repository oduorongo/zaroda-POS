import { farmBuyerPaymentDraft, farmDeliveryDraft, farmStockUseDraft, farmWagesDraft } from './farm-posting.util';
import { isBalanced } from './ledger-posting.util';

const amount = (d: { lines: { account: string; debit: number; credit: number }[] }, account: string) => d.lines.filter((l) => l.account === account).reduce((s, l) => s + l.debit - l.credit, 0);

describe('farm postings', () => {
  it('posts paid wages as farm labour against deductions and money out, balanced', () => {
    const d = farmWagesDraft({ date: '2026-11-20', reference: 'WAGE-002', grossCents: 1_820_000, payeCents: 0, nssfCents: 109_200, shifCents: 50_050, housingCents: 27_300, paid: [{ method: 'MPESA', netCents: 1_000_000 }, { method: 'CASH', netCents: 633_450 }] });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'FARM_LABOUR')).toBe(1_820_000);
    expect(amount(d, 'MPESA')).toBe(-1_000_000);
    expect(amount(d, 'NSSF')).toBe(-109_200);
  });

  it('posts a credit delivery as money owed and a sale, with its stock cost', () => {
    const d = farmDeliveryDraft({ date: '2026-11-20', branchId: 'b1', reference: 'Uriri co-op, 20 L', amountCents: 104_000, costCents: 40_000 });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'AR')).toBe(104_000);
    expect(amount(d, 'SALES')).toBe(-104_000);
    expect(amount(d, 'COGS')).toBe(40_000);
    expect(amount(d, 'INVENTORY')).toBe(-40_000);
  });

  it('posts a buyer payment into the right money account', () => {
    const d = farmBuyerPaymentDraft({ date: '2026-11-20', reference: 'Uriri co-op', amountCents: 728_000, method: 'BANK' });
    expect(isBalanced(d.lines)).toBe(true);
    expect(amount(d, 'BANK')).toBe(728_000);
    expect(amount(d, 'AR')).toBe(-728_000);
  });

  it('posts feed fed and field inputs out of stock at cost', () => {
    const feed = farmStockUseDraft({ date: '2026-11-20', branchId: null, kind: 'FEED', reference: '112 kg mash', costCents: 649_600 });
    const inputs = farmStockUseDraft({ date: '2026-11-20', branchId: null, kind: 'INPUTS', reference: 'Maize: DAP', costCents: 350_000 });
    expect(amount(feed, 'FEED_USED')).toBe(649_600);
    expect(amount(inputs, 'FARM_INPUTS')).toBe(350_000);
    expect(amount(inputs, 'INVENTORY')).toBe(-350_000);
  });
});
