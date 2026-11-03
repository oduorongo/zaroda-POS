import { effectiveStatus, FREE_PLAN_UNTIL, isFreePlan, needsDeviceSubscription } from './subscriptions.util';

describe('needsDeviceSubscription', () => {
  it('gives shops, restaurants, pharmacies and salons the device subscription', () => {
    for (const type of ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON']) expect(needsDeviceSubscription(type)).toBe(true);
  });

  it('does not give a rental landlord one, because their plan is the rental plan', () => {
    expect(needsDeviceSubscription('RENTAL')).toBe(false);
  });
});

describe('free Online Shop only plan', () => {
  it('is free only at KES 0', () => {
    expect(isFreePlan({ priceKes: 0 })).toBe(true);
    expect(isFreePlan({ priceKes: '0.00' })).toBe(true);
    expect(isFreePlan({ priceKes: 2500 })).toBe(false);
  });

  it('stays ACTIVE, never trial or overdue, with its far-off paid-up date', () => {
    expect(effectiveStatus({ currentPeriodEnd: FREE_PLAN_UNTIL, graceDays: 7, isTrial: false, manuallySuspended: false }, new Date('2040-01-01T00:00:00Z'))).toBe('ACTIVE');
  });
});
