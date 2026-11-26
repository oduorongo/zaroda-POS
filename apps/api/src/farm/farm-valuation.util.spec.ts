import { DEFAULT_RATES, monthsBetween, round50, valuationWarnings, valueOf, type ValuationInput } from './farm-valuation.util';

const base: ValuationInput = {
  entry: 60000,
  feed: 20000,
  vet: 2000,
  weightKg: null,
  dailyProduce: 0,
  producePrice: 0,
  ageMonths: 36,
  rate: DEFAULT_RATES.CATTLE,
  margin: 0.2,
  productionDays: 90,
};

describe('farm valuation', () => {
  it('prices on cost plus margin when it is more than the weight value', () => {
    const v = valueOf({ ...base, weightKg: 300 });
    expect(v.cost).toBe(82000);
    expect(v.costPrice).toBe(98400);
    expect(v.weightValue).toBe(75000);
    expect(v.basis).toBe('COST');
    expect(v.suggested).toBe(98400);
  });

  it('prices on weight when the animal is worth more than it cost', () => {
    const v = valueOf({ ...base, entry: 5000, feed: 10000, vet: 0, weightKg: 400 });
    expect(v.basis).toBe('WEIGHT');
    expect(v.suggested).toBe(100000);
  });

  it('adds recent production: 15 litres a day at KES 50 for 90 days', () => {
    const v = valueOf({ ...base, dailyProduce: 15, producePrice: 50 });
    expect(v.productionValue).toBe(67500);
    expect(v.suggested).toBe(round50(98400 + 67500));
  });

  it('drops 15% a year past prime age, never below the weight value', () => {
    const old = valueOf({ ...base, ageMonths: 120 });
    expect(old.ageAdjustment).toBeCloseTo(-98400 * 0.3, 2);
    expect(old.suggested).toBe(round50(98400 * 0.7));
    const veryOld = valueOf({ ...base, ageMonths: 300, weightKg: 350 });
    expect(veryOld.suggested).toBe(87500);
  });

  it('leaves price alone before prime age or with no age', () => {
    expect(valueOf({ ...base, ageMonths: 95 }).ageAdjustment).toBe(0);
    expect(valueOf({ ...base, ageMonths: null }).ageAdjustment).toBe(0);
  });

  it('counts whole months', () => {
    expect(monthsBetween(new Date('2024-01-15'), new Date('2026-01-14'))).toBe(23);
    expect(monthsBetween(new Date('2024-01-15'), new Date('2026-01-15'))).toBe(24);
  });
});

describe('valuation warnings', () => {
  it('asks for a weight and flags no feed past weaning', () => {
    expect(valuationWarnings({ weightKg: null, feed: 0, ageMonths: 72, pricePerKg: 250 })).toEqual(['Not weighed: weigh it for a fairer price', 'No feed recorded against it']);
    expect(valuationWarnings({ weightKg: 400, feed: 100, ageMonths: 72, pricePerKg: 250 })).toEqual([]);
    expect(valuationWarnings({ weightKg: null, feed: 0, ageMonths: 2, pricePerKg: 0 })).toEqual([]);
  });
});
