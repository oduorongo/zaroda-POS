import { dlpEnds, expectedWithholding, ipcBalance, previousCertified, retentionRelease, revisedSum, subValuation, valuation } from './valuation.util';

const base = {
  bq: [{ qtyToDate: 100, rate: 1000, qty: 200 }, { qtyToDate: 10, rate: 5000, qty: 10 }],
  variations: [],
  materialsOnSite: 0,
  retentionRate: 10,
  retentionLimitPercent: 5,
  contractSum: 10_000_000,
  retentionReleasedToDate: 0,
  advanceRecoveryToDate: 0,
  previousCertified: 0,
};

describe('valuation maths', () => {
  it('values BQ work at qty x rate and takes 10% retention', () => {
    const v = valuation(base);
    expect(v).toMatchObject({ workToDate: 150_000, grossToDate: 150_000, retentionDeducted: 15_000, retentionHeld: 15_000, netCumulative: 135_000, netDue: 135_000 });
  });

  it('caps retention at the limit (5% of the contract sum)', () => {
    const v = valuation({ ...base, bq: [{ qtyToDate: 1, rate: 8_000_000, qty: 1 }] });
    expect(v.retentionCap).toBe(500_000);
    expect(v.retentionDeducted).toBe(500_000);
    expect(v.netDue).toBe(7_500_000);
  });

  it('takes off everything certified before', () => {
    const first = valuation(base);
    const second = valuation({ ...base, bq: [{ qtyToDate: 150, rate: 1000, qty: 200 }, { qtyToDate: 10, rate: 5000, qty: 10 }], previousCertified: previousCertified([{ netDue: first.netDue }]) });
    expect(second.grossToDate).toBe(200_000);
    expect(second.previousCertified).toBe(135_000);
    expect(second.netDue).toBe(45_000);
  });

  it('adds approved variations done to date and materials on site', () => {
    const v = valuation({ ...base, variations: [{ amountToDate: 40_000, approvedAmount: 50_000 }, { amountToDate: -10_000, approvedAmount: -20_000 }], materialsOnSite: 20_000 });
    expect(v.variationsToDate).toBe(30_000);
    expect(v.grossToDate).toBe(200_000);
    expect(v.retentionDeducted).toBe(20_000);
  });

  it('refuses a variation valued above its approved amount', () => {
    expect(() => valuation({ ...base, variations: [{ amountToDate: 60_000, approvedAmount: 50_000 }] })).toThrow('more than its approved amount');
  });

  it('warns about over-measured BQ items and negative certificates, refuses negative quantities', () => {
    expect(valuation({ ...base, bq: [{ qtyToDate: 250, rate: 1000, qty: 200 }] }).warnings[0]).toContain('more than the BQ quantity');
    expect(valuation({ ...base, previousCertified: 200_000 }).warnings).toContain('This valuation is less than what was certified before (a negative certificate).');
    expect(() => valuation({ ...base, bq: [{ qtyToDate: -1, rate: 1, qty: 1 }] })).toThrow('negative');
  });

  it('recovers the advance payment', () => {
    expect(valuation({ ...base, advanceRecoveryToDate: 30_000 }).netDue).toBe(105_000);
  });

  it('pays released retention through the next certificate', () => {
    const before = valuation({ ...base, bq: [{ qtyToDate: 1, rate: 8_000_000, qty: 1 }] });
    const release = retentionRelease(before.retentionHeld, 50);
    const after = valuation({ ...base, bq: [{ qtyToDate: 1, rate: 8_000_000, qty: 1 }], retentionReleasedToDate: release, previousCertified: before.netDue });
    expect(release).toBe(250_000);
    expect(after.retentionHeld).toBe(250_000);
    expect(after.netDue).toBe(250_000);
  });

  it('a reversal brings what was certified back to before the reversed certificate', () => {
    expect(previousCertified([{ netDue: 135_000 }, { netDue: 45_000 }, { netDue: -45_000 }])).toBe(135_000);
  });

  it('keeps cents exact', () => {
    expect(valuation({ ...base, bq: [{ qtyToDate: 12.345, rate: 1234.56, qty: 20 }] }).workToDate).toBe(15240.64);
  });
});

describe('contract sum, retention release, defects period', () => {
  it('adds approved variations, omissions negative', () => {
    expect(revisedSum(10_000_000, [250_000, -40_000])).toBe(10_210_000);
  });

  it('releases a share of what is held', () => {
    expect(retentionRelease(500_000, 100)).toBe(500_000);
    expect(() => retentionRelease(1, 0)).toThrow();
  });

  it('works out the end of the defects period', () => {
    expect(dlpEnds(new Date('2026-03-31T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2026-10-01');
  });
});

describe('IPC payment', () => {
  it('counts the payment and withholding certificates against the invoice', () => {
    const invoice = 116_000;
    const wh = expectedWithholding(100_000, 3, 2);
    expect(wh).toEqual({ wht: 3000, whtVat: 2000 });
    expect(ipcBalance(invoice, { payment: 111_000, wht: 3000, whtVat: 2000 })).toEqual({ covered: 116_000, outstanding: 0, settled: true });
    expect(ipcBalance(invoice, { payment: 100_000, wht: 3000, whtVat: 0 }).outstanding).toBe(13_000);
  });
});

describe('subcontract valuation', () => {
  it('uses the subcontract retention and cap, less previous payments', () => {
    expect(subValuation({ grossToDate: 400_000, retentionRate: 10, retentionLimitPercent: 5, subcontractSum: 1_000_000, previousPaid: 200_000 })).toEqual({ retention: 40_000, netDue: 160_000 });
    expect(subValuation({ grossToDate: 900_000, retentionRate: 10, retentionLimitPercent: 5, subcontractSum: 1_000_000, previousPaid: 0 }).retention).toBe(50_000);
  });
});
