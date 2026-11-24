import { bucketOf, bucketsUpTo, eggsToStock, layPct, milkToStock, yields } from './farm-production.util';

describe('farm production', () => {
  it('puts only milk for sale, not withheld, into stock', () => {
    expect(milkToStock(12.5, 'SOLD', false)).toBe(12.5);
    expect(milkToStock(12.5, 'SOLD', true)).toBe(0);
    expect(milkToStock(4, 'CALVES', false)).toBe(0);
  });

  it('turns good eggs into trays, and keeps withheld eggs out', () => {
    expect(eggsToStock(450, 30, false)).toBe(15);
    expect(eggsToStock(100, 30, false)).toBe(3.333);
    expect(eggsToStock(100, 1, false)).toBe(100);
    expect(eggsToStock(450, 30, true)).toBe(0);
  });

  it('works out lay % from all eggs over birds', () => {
    expect(layPct(850, 1000)).toBe(85);
    expect(layPct(10, 0)).toBeNull();
  });

  it('puts a day in its week (Monday) and month', () => {
    expect(bucketOf('2027-01-14', 'week')).toBe('2027-01-11');
    expect(bucketOf('2027-01-11', 'week')).toBe('2027-01-11');
    expect(bucketOf('2027-01-17', 'week')).toBe('2027-01-11');
    expect(bucketOf('2027-01-14', 'month')).toBe('2027-01-01');
  });

  it('lists 30 days, 12 weeks or 12 months ending today', () => {
    const days = bucketsUpTo('2027-01-14', 'day');
    expect(days).toHaveLength(30);
    expect(days[29]).toBe('2027-01-14');
    const months = bucketsUpTo('2027-01-14', 'month');
    expect(months[0]).toBe('2026-02-01');
    expect(months[11]).toBe('2027-01-01');
    expect(bucketsUpTo('2027-01-14', 'week')[11]).toBe('2027-01-11');
  });

  it('adds up milk by use and eggs with lay % over bird-days', () => {
    const [b] = yields(
      [
        { date: '2027-01-12', litres: 10, use: 'SOLD', withheld: false },
        { date: '2027-01-13', litres: 6, use: 'DISCARDED', withheld: true },
        { date: '2027-01-13', litres: 2, use: 'CALVES', withheld: false },
      ],
      [
        { date: '2027-01-12', birds: 100, goodEggs: 80, cracked: 5, small: 5, feedKg: 12, deaths: 1 },
        { date: '2027-01-13', birds: 99, goodEggs: 70, cracked: 0, small: 0, feedKg: 11.5, deaths: 0 },
      ],
      ['2027-01-11'],
      'week',
    );
    expect(b.milk).toEqual({ total: 18, forSale: 10, withheld: 6, calves: 2, home: 0, discarded: 6 });
    expect(b.eggs.total).toBe(160);
    expect(b.eggs.layPct).toBe(80.4);
    expect(b.eggs.feedKg).toBe(23.5);
    expect(b.eggs.deaths).toBe(1);
  });
});
