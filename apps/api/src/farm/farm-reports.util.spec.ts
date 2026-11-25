import { FARM_REPORTS, costOf, emptyMoney, perUnit, profitOf, totalsOf } from './farm-reports.util';

describe('farm reports', () => {
  it('adds up the money columns only', () => {
    const t = totalsOf(
      [
        { enterprise: 'Dairy', income: 20000, cost: 12000, note: 'x' },
        { enterprise: 'Layers', income: 15000.5, cost: 9000.25, note: 'y' },
      ],
      [{ key: 'enterprise', label: 'Enterprise' }, { key: 'income', label: 'Income', type: 'money' }, { key: 'cost', label: 'Cost', type: 'money' }, { key: 'note', label: 'Note' }],
    );
    expect(t).toEqual({ enterprise: 'Total', income: 35000.5, cost: 21000.25 });
  });

  it('works out cost and profit for an enterprise', () => {
    const m = { ...emptyMoney(), income: 30000, feed: 9000, vet: 1500, labour: 6000, field: 0, stock: 0 };
    expect(costOf(m)).toBe(16500);
    expect(profitOf(m)).toBe(13500);
  });

  it('gives a per-unit figure only when something was made', () => {
    expect(perUnit(16500, 600)).toBe(27.5);
    expect(perUnit(16500, 0)).toBeNull();
  });

  it('puts the registers on the basic plan and profit and wages on full reports', () => {
    expect(FARM_REPORTS.herd.feature).toBe('reports_basic');
    expect(FARM_REPORTS.health.feature).toBe('reports_basic');
    expect(FARM_REPORTS.enterprises.feature).toBe('reports_full');
    expect(FARM_REPORTS.wages.feature).toBe('reports_full');
  });
});
