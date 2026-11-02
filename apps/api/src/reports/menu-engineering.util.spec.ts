import { engineerMenu } from './menu-engineering.util';

const dish = (name: string, quantity: number, price: number, unitCost: number | null) => ({
  variantId: name,
  name,
  quantity,
  revenue: quantity * price,
  cost: unitCost === null ? null : quantity * unitCost,
});

describe('engineerMenu', () => {
  it('puts each dish in its box by popularity and margin per plate', () => {
    const r = engineerMenu([
      dish('Biryani', 100, 500, 200), // margin 300, popular
      dish('Chapati', 120, 50, 30), // margin 20, popular
      dish('Lobster', 5, 3000, 1500), // margin 1500, not popular
      dish('Soup', 5, 150, 120), // margin 30, not popular
    ]);
    const cls = Object.fromEntries(r.dishes.map((d) => [d.name, d.menuClass]));
    expect(cls).toEqual({ Biryani: 'STAR', Chapati: 'PLOWHORSE', Lobster: 'PUZZLE', Soup: 'DOG' });
    expect(r.popularAtPct).toBe(17.5);
    expect(r.summary).toEqual({ STAR: 1, PLOWHORSE: 1, PUZZLE: 1, DOG: 1, NO_COST: 0 });
  });

  it('weights the average margin by plates sold', () => {
    const r = engineerMenu([dish('A', 3, 100, 0), dish('B', 1, 100, 100)]);
    expect(r.avgMargin).toBe(75);
  });

  it('gives no class to a dish without a cost and leaves it out of the average', () => {
    const r = engineerMenu([dish('A', 10, 100, 40), dish('B', 10, 100, null)]);
    expect(r.dishes.find((d) => d.name === 'B')!.menuClass).toBeNull();
    expect(r.avgMargin).toBe(60);
    expect(r.summary.NO_COST).toBe(1);
  });

  it('ignores dishes that did not sell and copes with nothing sold', () => {
    expect(engineerMenu([dish('A', 0, 100, 10)]).dishes).toHaveLength(0);
    expect(engineerMenu([]).avgMargin).toBeNull();
  });
});
