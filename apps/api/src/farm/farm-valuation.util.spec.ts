import { DEFAULT_RATES, monthsBetween, profitOf, round50, valuationWarnings, valueOf, type ValuationInput } from './farm-valuation.util';

const base: ValuationInput = {
  entry: 60000,
  feed: 20000,
  vet: 2000,
  weightKg: null,
  ageMonths: 36,
  rate: DEFAULT_RATES.CATTLE,
  margin: 0.2,
  sellingCost: 0.05,
};

describe('farm valuation (IAS 41)', () => {
  it('values a weighed animal at fair value: weight x market price less costs to sell', () => {
    const v = valueOf({ ...base, weightKg: 400 });
    expect(v.basis).toBe('MARKET');
    expect(v.marketValue).toBe(100000);
    expect(v.sellingCosts).toBe(-5000);
    expect(v.value).toBe(95000);
  });

  it('with no market price uses the cost model: bought or born value plus rearing costs', () => {
    const v = valueOf(base);
    expect(v.basis).toBe('COST');
    expect(v.value).toBe(82000);
    expect(v.sellingCosts).toBe(0);
  });

  it('past prime age the value drops by the yearly rate, never by more than half', () => {
    expect(valueOf({ ...base, weightKg: 400, ageMonths: 120 }).ageAdjustment).toBe(-30000);
    expect(valueOf({ ...base, weightKg: 400, ageMonths: 120 }).value).toBe(66500);
    expect(valueOf({ ...base, weightKg: 400, ageMonths: 400 }).ageAdjustment).toBe(-50000);
    expect(valueOf({ ...base, ageMonths: 95 }).ageAdjustment).toBe(0);
  });

  it('asks at least cost plus margin, in round 50s', () => {
    expect(valueOf({ ...base, weightKg: 300 }).askingPrice).toBe(round50(82000 * 1.2));
    expect(valueOf({ ...base, entry: 5000, feed: 1000, vet: 0, weightKg: 400 }).askingPrice).toBe(100000);
  });

  it('profit so far: income + young + value today - what it cost', () => {
    expect(profitOf({ income: 80000, offspringValue: 5000, value: 95000, cost: 82000 })).toBe(98000);
  });

  it('flags a missing weight and feed', () => {
    expect(valuationWarnings({ weightKg: null, feed: 0, ageMonths: 72, pricePerKg: 250 })).toHaveLength(2);
    expect(valuationWarnings({ weightKg: 400, feed: 100, ageMonths: 72, pricePerKg: 250 })).toEqual([]);
  });

  it('counts whole months', () => {
    expect(monthsBetween(new Date('2024-01-15'), new Date('2026-01-14'))).toBe(23);
    expect(monthsBetween(new Date('2024-01-15'), new Date('2026-01-15'))).toBe(24);
  });
});
