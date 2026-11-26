import { downgradeProblems, extendPeriod, farmMrr, planPrice } from './farm-billing.util';

const plan = (monthlyPrice: number, annualPrice: number | null, limits = { head: 50, birds: 1000, acres: 10, users: 3 }) => ({
  code: 'FARM_MKULIMA', name: 'Mkulima', monthlyPrice, annualPrice, quoteOnly: false, limits, features: [], sortOrder: 1,
});

describe('farm billing', () => {
  it('prices a month or a year', () => {
    expect(planPrice(plan(1000, 10000), 'MONTHLY')).toEqual({ amount: 1000, months: 1 });
    expect(planPrice(plan(1000, 10000), 'ANNUAL')).toEqual({ amount: 10000, months: 12 });
    expect(planPrice(plan(1000, null), 'ANNUAL')).toEqual({ amount: 12000, months: 12 });
  });

  it('runs a paid period on from the current end, or from today once it has lapsed', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(extendPeriod(new Date('2026-12-10T00:00:00Z'), 1, now).toISOString().slice(0, 10)).toBe('2027-01-10');
    expect(extendPeriod(new Date('2026-11-01T00:00:00Z'), 12, now).toISOString().slice(0, 10)).toBe('2027-11-25');
  });

  it('says what does not fit a smaller plan', () => {
    expect(downgradeProblems({ head: 60, birds: 900, acres: 12, users: 2 }, plan(1000, null))).toEqual(['60 livestock head (the plan allows 50)', '12 acres (the plan allows 10)']);
    expect(downgradeProblems({ head: 10, birds: 0, acres: 1, users: 1 }, plan(1000, null))).toEqual([]);
  });

  it('spreads a yearly plan over 12 months for MRR', () => {
    expect(farmMrr(plan(2500, 25000), 'ANNUAL')).toBeCloseTo(2083.33, 2);
    expect(farmMrr(plan(2500, 25000), 'MONTHLY')).toBe(2500);
  });
});
