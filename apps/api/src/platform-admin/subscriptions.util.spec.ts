import { effectiveStatus, FREE_PLAN_UNTIL, isFreePlan, monthlyPrice, needsDeviceSubscription, priceProblem } from './subscriptions.util';

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

describe('agreed monthly price', () => {
  const basic = { name: 'Basic', priceKes: '2500.00', minPriceKes: '1000.00' };
  it('uses the agreed price, else the plan price', () => {
    expect(monthlyPrice({ agreedPriceKes: '1500.00', plan: basic })).toBe(1500);
    expect(monthlyPrice({ agreedPriceKes: null, plan: basic })).toBe(2500);
  });
  it('accepts any whole price in the range', () => {
    expect(priceProblem(basic, 1000)).toBeNull();
    expect(priceProblem(basic, 1750)).toBeNull();
    expect(priceProblem(basic, 2500)).toBeNull();
  });
  it('refuses prices outside the range or with cents', () => {
    expect(priceProblem(basic, 999)).toMatch(/1,000 - 2,500/);
    expect(priceProblem(basic, 2600)).toMatch(/1,000 - 2,500/);
    expect(priceProblem(basic, 1500.5)).toMatch(/whole shillings/);
  });
  it('a plan without a range has one price', () => {
    expect(priceProblem({ name: 'Standard', priceKes: 6000, minPriceKes: null }, 5000)).toMatch(/one price/);
    expect(priceProblem({ name: 'Standard', priceKes: 6000, minPriceKes: null }, 6000)).toBeNull();
  });
});
