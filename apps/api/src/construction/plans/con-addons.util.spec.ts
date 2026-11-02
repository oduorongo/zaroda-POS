import { payoutFee, proratedSlots, smsParts } from './con-addons.util';

describe('construction add-ons', () => {
  const bands = [
    { upTo: null, darajaCost: 25, markup: 10 },
    { upTo: 1000, darajaCost: 5, markup: 10 },
    { upTo: 10000, darajaCost: 12, markup: 10 },
  ];

  it('payout fee: Safaricom cost of the band plus the markup', () => {
    expect(payoutFee(bands, 800)).toEqual({ darajaCost: 5, markup: 10, amount: 15 });
    expect(payoutFee(bands, 1000)).toEqual({ darajaCost: 5, markup: 10, amount: 15 });
    expect(payoutFee(bands, 1000.5)).toEqual({ darajaCost: 12, markup: 10, amount: 22 });
    expect(payoutFee(bands, 250000)).toEqual({ darajaCost: 25, markup: 10, amount: 35 });
    expect(payoutFee([], 500)).toEqual({ darajaCost: 0, markup: 0, amount: 0 });
  });

  it('extra project slots are charged for the days left', () => {
    const now = new Date('2026-11-01T09:00:00Z');
    expect(proratedSlots(1, 1500, new Date('2026-12-01T09:00:00Z'), now)).toEqual({ days: 30, amount: 1500 });
    expect(proratedSlots(2, 1500, new Date('2026-11-11T09:00:00Z'), now)).toEqual({ days: 10, amount: 1000 });
    expect(proratedSlots(1, 1500, new Date('2026-10-31T09:00:00Z'), now)).toEqual({ days: 1, amount: 50 });
  });

  it('a text uses one credit per part', () => {
    expect(smsParts('x'.repeat(160))).toBe(1);
    expect(smsParts('x'.repeat(161))).toBe(2);
    expect(smsParts('x'.repeat(306))).toBe(2);
    expect(smsParts('x'.repeat(307))).toBe(3);
  });
});
