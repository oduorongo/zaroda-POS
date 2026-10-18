import { LISTING_DAYS, LISTING_FEE_KES, extendPaidUntil, listingState } from './rental-listing-fee.util';

const DAY = 86_400_000;
const now = new Date('2026-10-20T10:00:00Z');
const inDays = (n: number) => new Date(now.getTime() + n * DAY);

describe('listing fee rules', () => {
  it('charges KES 100 for 30 days', () => {
    expect(LISTING_FEE_KES).toBe(100);
    expect(LISTING_DAYS).toBe(30);
  });

  describe('listingState', () => {
    it('is UNPAID until the first payment', () => {
      expect(listingState({ isActive: true, paidUntil: null }, now)).toBe('UNPAID');
    });
    it('is LIVE while paid time remains, EXPIRED after', () => {
      expect(listingState({ isActive: true, paidUntil: inDays(3) }, now)).toBe('LIVE');
      expect(listingState({ isActive: true, paidUntil: inDays(-1) }, now)).toBe('EXPIRED');
    });
    it('is PAUSED whenever switched off, even if paid', () => {
      expect(listingState({ isActive: false, paidUntil: inDays(10) }, now)).toBe('PAUSED');
      expect(listingState({ isActive: false, paidUntil: null }, now)).toBe('PAUSED');
    });
  });

  describe('extendPaidUntil', () => {
    it('starts from now for a never-paid or lapsed advert', () => {
      expect(extendPaidUntil(null, now)).toEqual(inDays(30));
      expect(extendPaidUntil(inDays(-5), now)).toEqual(inDays(30));
    });
    it('adds on top of the time left when renewed early, so nothing is lost', () => {
      expect(extendPaidUntil(inDays(7), now)).toEqual(inDays(37));
    });
  });
});
