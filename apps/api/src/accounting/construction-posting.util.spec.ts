import { conPayrollDraft, conZarodaDraft, ipcReceiptDraft, retentionDraft, subPaymentDraft, subValuationDraft } from './construction-posting.util';
import { isBalanced } from './ledger-posting.util';
import { platformConPaymentDraft } from './platform-posting.util';

const side = (d: { lines: { account: string; debit: number; credit: number }[] }) => Object.fromEntries(d.lines.map((l) => [l.account, l.debit - l.credit]));

describe('construction in the books', () => {
  it('retention held is income kept as an asset; a release comes back out of sales (the next IPC sale counts it again)', () => {
    const held = retentionDraft({ date: '2026-10-01', type: 'DEDUCT', project: 'PRJ-001', reason: 'IPC 2', amountCents: 5_000_000 });
    expect(side(held)).toEqual({ RETENTION_RECEIVABLE: 5_000_000, SALES: -5_000_000 });
    const released = retentionDraft({ date: '2026-10-02', type: 'RELEASE', project: 'PRJ-001', reason: '50% at practical completion', amountCents: 2_500_000 });
    expect(side(released)).toEqual({ SALES: 2_500_000, RETENTION_RECEIVABLE: -2_500_000 });
    const reversal = retentionDraft({ date: '2026-10-03', type: 'DEDUCT', project: 'PRJ-001', reason: 'Reversal IPC 3', amountCents: -1_000_000 });
    expect(side(reversal)).toEqual({ SALES: 1_000_000, RETENTION_RECEIVABLE: -1_000_000 });
    for (const d of [held, released, reversal]) expect(isBalanced(d.lines)).toBe(true);
  });

  it('money and withholding certificates against an IPC clear what the client owes', () => {
    expect(side(ipcReceiptDraft({ date: '2026-10-05', kind: 'PAYMENT', reference: 'PRJ-001 IPC 1', amountCents: 900_000, method: 'BANK' }))).toEqual({ BANK: 900_000, AR: -900_000 });
    expect(side(ipcReceiptDraft({ date: '2026-10-05', kind: 'WHT', reference: 'PRJ-001 IPC 1', amountCents: 30_000, method: null }))).toEqual({ WHT_RECEIVABLE: 30_000, AR: -30_000 });
    expect(side(ipcReceiptDraft({ date: '2026-10-05', kind: 'PAYMENT', reference: 'x', amountCents: 100, method: null }))).toEqual({ BANK: 100, AR: -100 });
  });

  it('site payroll: wages against deductions owed and what went out by M-Pesa and cash', () => {
    const d = conPayrollDraft({ date: '2026-10-10', reference: 'PRJ-001 PAY-001', grossCents: 100_000, payeCents: 0, nssfCents: 6_000, shifCents: 2_750, housingCents: 1_500, paid: [{ method: 'MPESA', netCents: 50_000 }, { method: 'CASH', netCents: 29_750 }, { method: 'MPESA_MANUAL', netCents: 10_000 }] });
    expect(side(d)).toEqual({ SALARIES: 100_000, NSSF: -6_000, SHIF: -2_750, HOUSING_LEVY: -1_500, MPESA: -60_000, CASH: -29_750 });
    expect(isBalanced(d.lines)).toBe(true);
  });

  it('a subcontract valuation: the new work is a cost, retention is owed later, the rest is owed now; a payment clears it', () => {
    const v = subValuationDraft({ date: '2026-10-11', reference: 'SC-001 no. 2', workCents: 18_000_000, retentionCents: 1_800_000 });
    expect(side(v)).toEqual({ SUBCONTRACTORS: 18_000_000, RETENTION_PAYABLE: -1_800_000, AP: -16_200_000 });
    expect(isBalanced(v.lines)).toBe(true);
    expect(side(subPaymentDraft({ date: '2026-10-12', reference: 'SC-001 no. 2', amountCents: 16_200_000 }))).toEqual({ AP: 16_200_000, BANK: -16_200_000 });
  });

  it('paying ZARODA is a cost to the business and income in ZARODA\'s books', () => {
    expect(side(conZarodaDraft({ date: '2026-10-01', label: 'SMS bundle', amountCents: 50_000, method: 'MPESA' }))).toEqual({ ZARODA_FEES: 50_000, MPESA: -50_000 });
    expect(side(platformConPaymentDraft({ date: '2026-10-01', business: 'Uriri', label: 'SMS bundle', income: 'SMS_INCOME', amountCents: 50_000, method: 'MPESA' }))).toEqual({ MPESA: 50_000, SMS_INCOME: -50_000 });
  });
});
