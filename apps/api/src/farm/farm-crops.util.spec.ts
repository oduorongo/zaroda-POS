import { blockedUntil, kgPerUnitFor, safeHarvestFrom, seasonFigures } from './farm-crops.util';

describe('farm crops', () => {
  it('knows the kg of common harvest units, and takes a typed one first', () => {
    expect(kgPerUnitFor('bag (90 kg)')).toBe(90);
    expect(kgPerUnitFor('Tonne')).toBe(1000);
    expect(kgPerUnitFor('crate')).toBeNull();
    expect(kgPerUnitFor('crate', 25)).toBe(25);
  });

  it('works out the first safe harvest day from the pre-harvest interval', () => {
    expect(safeHarvestFrom('2027-01-10', 14)).toBe('2027-01-24');
    expect(safeHarvestFrom('2027-01-10', 0)).toBeNull();
  });

  it('blocks harvest until the latest spray interval, ignoring voided sprays', () => {
    expect(blockedUntil([{ safeHarvestFrom: '2027-01-24' }, { safeHarvestFrom: '2027-02-03' }, { safeHarvestFrom: '2027-03-01', voided: true }])).toBe('2027-02-03');
    expect(blockedUntil([{ safeHarvestFrom: null }])).toBeNull();
  });

  it('gives yield and cost per acre and per kg', () => {
    const f = seasonFigures(
      6,
      [
        { inputCost: 18000, labourCost: 6000 },
        { inputCost: 4500, labourCost: 1500 },
        { inputCost: 99999, labourCost: 0, voided: true },
      ],
      [{ kg: 9000 }, { kg: 1800 }, { kg: 5000, voided: true }],
    );
    expect(f).toEqual({ harvestedKg: 10800, inputCost: 22500, labourCost: 7500, totalCost: 30000, kgPerAcre: 1800, costPerAcre: 5000, costPerKg: 2.78 });
  });

  it('has no per-kg cost before anything is harvested', () => {
    expect(seasonFigures(2, [{ inputCost: 1000, labourCost: 0 }], []).costPerKg).toBeNull();
  });
});
