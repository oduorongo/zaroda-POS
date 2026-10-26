import {
  bidTotals,
  complianceState,
  contractFigures,
  DEFAULT_CHECKLIST,
  submissionCheck,
} from './school-tender.util';

describe('bidTotals', () => {
  it('adds up cost, price, VAT and margin', () => {
    const t = bidTotals([
      { quantity: 100, unitCost: 30, unitPrice: 45, taxRate: 0 },
      { quantity: 50, unitCost: 10, unitPrice: 20, taxRate: 0.16 },
    ]);
    expect(t.cost).toBe(3500);
    expect(t.subtotal).toBe(5500);
    expect(t.taxAmount).toBe(160);
    expect(t.total).toBe(5660);
    expect(t.margin).toBe(2000);
    expect(t.marginPercent).toBe(36.36);
  });
  it('is zero with nothing priced, without dividing by zero', () => {
    expect(bidTotals([])).toMatchObject({
      total: 0,
      margin: 0,
      marginPercent: 0,
    });
  });
  it('shows a loss as a negative margin', () => {
    expect(
      bidTotals([{ quantity: 1, unitCost: 100, unitPrice: 80, taxRate: 0 }])
        .margin,
    ).toBe(-20);
  });
});

describe('complianceState', () => {
  it('is expired the day after, expiring in the last 30 days, otherwise fine', () => {
    expect(complianceState('2026-10-01', '2026-10-02')).toBe('EXPIRED');
    expect(complianceState('2026-10-02', '2026-10-02')).toBe('EXPIRING');
    expect(complianceState('2026-11-01', '2026-10-02')).toBe('EXPIRING');
    expect(complianceState('2026-12-01', '2026-10-02')).toBe('OK');
    expect(complianceState(null, '2026-10-02')).toBe('NO_EXPIRY');
  });
});

describe('submissionCheck', () => {
  const base = {
    closingDate: '2026-11-30',
    today: '2026-11-10',
    checklist: [{ title: 'A', done: true }],
    docs: [],
    hasBid: true,
  };
  it('a ready tender has nothing in the way', () => {
    expect(submissionCheck(base)).toEqual({
      closed: false,
      blockers: [],
      warnings: [],
    });
  });
  it('an unticked checklist item blocks, and is named', () => {
    const r = submissionCheck({
      ...base,
      checklist: [
        { title: 'Bid security', done: false },
        { title: 'A', done: true },
      ],
    });
    expect(r.blockers[0]).toContain('Bid security');
  });
  it('an expired document blocks, and so does one that runs out before the tender closes', () => {
    expect(
      submissionCheck({
        ...base,
        docs: [{ name: 'Tax certificate', expiryDate: '2026-11-01' }],
      }).blockers[0],
    ).toContain('expired on 2026-11-01');
    expect(
      submissionCheck({
        ...base,
        docs: [{ name: 'Permit', expiryDate: '2026-11-20' }],
      }).blockers[0],
    ).toContain('before the tender closes');
  });
  it('a document due to run out soon after closing is only a warning', () => {
    const r = submissionCheck({
      ...base,
      closingDate: '2026-11-15',
      docs: [{ name: 'Permit', expiryDate: '2026-11-25' }],
    });
    expect(r.blockers).toEqual([]);
    expect(r.warnings[0]).toContain('Permit');
  });
  it('a tender past its closing date is closed', () => {
    expect(submissionCheck({ ...base, today: '2026-12-01' }).closed).toBe(true);
    expect(submissionCheck({ ...base, closingDate: null }).closed).toBe(false);
  });
  it('no bid prices is a warning, not a block', () => {
    const r = submissionCheck({ ...base, hasBid: false });
    expect(r.blockers).toEqual([]);
    expect(r.warnings).toContain('No bid prices have been entered');
  });
});

describe('contractFigures', () => {
  it('works out the value now, what is left, what is owed and the profit', () => {
    const f = contractFigures({
      originalValue: 100000,
      variations: 20000,
      invoiced: 70000,
      credited: 5000,
      paid: 40000,
      netSales: 56000,
      costOfGoods: 40000,
    });
    expect(f.value).toBe(120000);
    expect(f.netInvoiced).toBe(65000);
    expect(f.remaining).toBe(55000);
    expect(f.overrun).toBe(0);
    expect(f.owed).toBe(25000);
    expect(f.profit).toBe(16000);
    expect(f.profitPercent).toBe(28.57);
    expect(f.usedPercent).toBe(54.17);
  });
  it('says how far invoicing has gone past the contract', () => {
    const f = contractFigures({
      originalValue: 1000,
      variations: -100,
      invoiced: 1200,
      credited: 0,
      paid: 0,
      netSales: 0,
      costOfGoods: 0,
    });
    expect(f.remaining).toBe(0);
    expect(f.overrun).toBe(300);
  });
});

describe('the default checklist', () => {
  it('has items', () => {
    expect(DEFAULT_CHECKLIST.length).toBeGreaterThan(3);
  });
});
