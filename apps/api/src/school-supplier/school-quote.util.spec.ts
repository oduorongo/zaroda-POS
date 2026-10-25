import {
  defaultValidUntil,
  mergeQuoteLines,
  quoteExpired,
} from './school-quote.util';

describe('quoteExpired', () => {
  it('runs out the day after the valid-until date, never before', () => {
    expect(quoteExpired('2026-11-30', '2026-11-30')).toBe(false);
    expect(quoteExpired('2026-11-30', '2026-12-01')).toBe(true);
    expect(quoteExpired('2026-11-30', '2026-11-01')).toBe(false);
  });
  it('one with no date never runs out', () => {
    expect(quoteExpired(null, '2030-01-01')).toBe(false);
  });
});

describe('defaultValidUntil', () => {
  it('is 30 days on, across a month end', () => {
    expect(defaultValidUntil('2026-11-10')).toBe('2026-12-10');
    expect(defaultValidUntil('2026-12-20')).toBe('2027-01-19');
  });
});

describe('mergeQuoteLines', () => {
  it('adds the quantities of a product listed twice', () => {
    const m = mergeQuoteLines([
      { variantId: 'a', quantity: 10, unitPrice: 50 },
      { variantId: 'b', quantity: 1 },
      { variantId: 'a', quantity: 5, unitPrice: 50 },
    ]);
    expect(m.problem).toBeNull();
    expect(m.lines).toEqual([
      { variantId: 'a', quantity: 15, unitPrice: 50 },
      { variantId: 'b', quantity: 1 },
    ]);
  });
  it('takes a price from whichever entry has one', () => {
    const m = mergeQuoteLines([
      { variantId: 'a', quantity: 1 },
      { variantId: 'a', quantity: 2, unitPrice: 40 },
    ]);
    expect(m.lines[0]).toEqual({ variantId: 'a', quantity: 3, unitPrice: 40 });
  });
  it('refuses one product at two prices', () => {
    const m = mergeQuoteLines([
      { variantId: 'a', quantity: 1, unitPrice: 40 },
      { variantId: 'a', quantity: 1, unitPrice: 45 },
    ]);
    expect(m.problem).toContain('different prices');
  });
  it('does not drift on fractions', () => {
    const m = mergeQuoteLines([
      { variantId: 'a', quantity: 0.1 },
      { variantId: 'a', quantity: 0.2 },
    ]);
    expect(m.lines[0].quantity).toBe(0.3);
  });
});
