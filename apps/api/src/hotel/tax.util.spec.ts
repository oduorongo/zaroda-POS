import { combinedRate, nightPostings, splitTaxCents } from './tax.util';

const vat = { name: 'VAT', percent: 16 };
const levy = { name: 'Tourism levy', percent: 2 };

describe('combinedRate', () => {
  it('adds the taxes together as a fraction', () => {
    expect(combinedRate([])).toBe(0);
    expect(combinedRate([vat])).toBe(0.16);
    expect(combinedRate([vat, levy])).toBe(0.18);
    expect(
      combinedRate([
        { name: 'a', percent: 7.5 },
        { name: 'b', percent: 2.25 },
      ]),
    ).toBe(0.0975);
  });
});

describe('splitTaxCents', () => {
  it('splits in proportion and adds back up exactly', () => {
    expect(splitTaxCents(1800, [vat, levy])).toEqual([
      { name: 'VAT', cents: 1600 },
      { name: 'Tourism levy', cents: 200 },
    ]);
    const odd = splitTaxCents(1001, [vat, levy, { name: 'x', percent: 1 }]);
    expect(odd.reduce((s, p) => s + p.cents, 0)).toBe(1001);
  });
  it('with nothing to split or no taxes gives zeros', () => {
    expect(splitTaxCents(0, [vat])).toEqual([{ name: 'VAT', cents: 0 }]);
    expect(splitTaxCents(500, [])).toEqual([]);
  });
});

describe('nightPostings', () => {
  it('shows each tax separately on each night', () => {
    const p = nightPostings([5000, 5000], [vat, levy]);
    expect(p).toHaveLength(2);
    expect(p[0]).toEqual({
      amount: 5900,
      taxAmount: 900,
      breakdown: { VAT: 800, 'Tourism levy': 100 },
    });
  });
  it('adds up to exactly what the sale at check-out will total (tax worked out once, odd cents on the last night)', () => {
    const nets = [3333.33, 3333.33, 3333.33];
    const p = nightPostings(nets, [vat]);
    const totalCents = p.reduce((s, n) => s + Math.round(n.amount * 100), 0);
    expect(totalCents).toBe(Math.round(Math.round(9999.99 * 100) * 1.16));
    const taxCents = p.reduce((s, n) => s + Math.round(n.taxAmount * 100), 0);
    expect(taxCents).toBe(Math.round(999999 * 0.16));
  });
  it("the breakdown of every night adds up to that night's tax", () => {
    for (const n of nightPostings(
      [4100.5, 2999.99, 5000],
      [vat, levy, { name: 'Bed levy', percent: 1.5 }],
    )) {
      const parts = Object.values(n.breakdown).reduce(
        (s, v) => s + Math.round(v * 100),
        0,
      );
      expect(parts).toBe(Math.round(n.taxAmount * 100));
    }
  });
  it('varying nightly prices keep each night in proportion', () => {
    const p = nightPostings([5000, 8000], [vat]);
    expect(p.map((n) => n.amount)).toEqual([5800, 9280]);
  });
  it('with no taxes the nights are just their prices', () => {
    expect(nightPostings([5000], [])).toEqual([
      { amount: 5000, taxAmount: 0, breakdown: {} },
    ]);
    expect(nightPostings([], [vat])).toEqual([]);
  });
});
