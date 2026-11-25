import { batchCost, batchNo, daysLeft, feedCostPer, scaleRation } from './farm-feed.util';

describe('farm feed', () => {
  it('costs a batch and its cost per kg of feed made', () => {
    const b = batchCost(
      [
        { variantId: 'germ', quantity: 50, unitCost: 32 },
        { variantId: 'cake', quantity: 30, unitCost: 45 },
        { variantId: 'premix', quantity: 2, unitCost: null },
      ],
      80,
    );
    expect(b.cost).toBe(2950);
    expect(b.costPerKg).toBe(36.88);
    expect(b.missingCost).toBe(true);
    expect(b.lines[1]).toEqual({ variantId: 'cake', quantity: 30, unitCost: 45, cost: 1350 });
  });

  it('scales a ration to the batches mixed', () => {
    expect(scaleRation([{ variantId: 'germ', quantity: 50 }, { variantId: 'dcp', quantity: 1.5 }], 2.5)).toEqual([
      { variantId: 'germ', quantity: 125 },
      { variantId: 'dcp', quantity: 3.75 },
    ]);
  });

  it('numbers batches by day', () => {
    expect(batchNo('2027-01-17', 3)).toBe('FB-20270117-3');
  });

  it('works out days of feed left from recent daily use', () => {
    expect(daysLeft(100, 140, 14)).toBe(10);
    expect(daysLeft(5, 140, 14)).toBe(0);
    expect(daysLeft(100, 0, 14)).toBeNull();
  });

  it('gives feed cost per litre and per egg only when both exist', () => {
    expect(feedCostPer(4200, 600)).toBe(7);
    expect(feedCostPer(0, 600)).toBeNull();
    expect(feedCostPer(100, 0)).toBeNull();
  });
});
