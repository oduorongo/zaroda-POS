import { billFor, choiceProblem, effectiveStatus, extraTillPrice, FREE_PLAN_UNTIL, isFreePlan, monthlyEquivalent, monthlyPrice, needsDeviceSubscription, periodAfterBill, priceProblem, tillLimit, tillPrice } from './subscriptions.util';

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

describe('extra till', () => {
  const plan = { name: 'Basic', priceKes: '2500.00', minPriceKes: '1000.00', maxDevices: 1 };
  it('costs the agreed till price for a business on an old agreed price, else the plan extra till price', () => {
    expect(monthlyPrice({ agreedPriceKes: '1500.00', extraTills: 1, plan })).toBe(3000);
    expect(monthlyPrice({ agreedPriceKes: null, extraTills: 1, plan })).toBe(3000);
    expect(monthlyPrice({ agreedPriceKes: '1500.00', extraTills: 0, plan })).toBe(1500);
  });
  it('raises the till limit', () => {
    expect(tillLimit({ extraTills: 1, plan })).toBe(2);
    expect(tillLimit({ extraTills: 0, plan })).toBe(1);
  });
  it('one till still costs the till price', () => {
    expect(tillPrice({ agreedPriceKes: '1200.00', plan })).toBe(1200);
  });
});

describe('billing choice (new pricing)', () => {
  const basic = { name: 'Basic', priceKes: '1000', billingPeriodDays: 30, annualPriceKes: '10000', instalmentCount: 3, instalmentKes: '3500', extraTillKes: '500', extraTillAnnualKes: '5000' };
  const business = { ...basic, name: 'Business', priceKes: '7500', annualPriceKes: '75000', instalmentCount: 4, instalmentKes: '19500' };

  it('bills a month, a year, or one instalment, with extra tills at the plan price', () => {
    expect(billFor({ plan: basic, extraTills: 1 })).toMatchObject({ choice: 'MONTHLY', amount: 1500, days: 30 });
    expect(billFor({ plan: basic, extraTills: 1, billingChoice: 'ANNUAL' })).toMatchObject({ amount: 15000, months: 12 });
    expect(billFor({ plan: basic, billingChoice: 'INSTALMENTS' })).toMatchObject({ amount: 3500, months: 4 });
    expect(billFor({ plan: business, extraTills: 2, billingChoice: 'INSTALMENTS' })).toMatchObject({ amount: 22000, months: 3 });
  });

  it('keeps a business on its old agreed price, extra tills included, while it pays monthly', () => {
    const standard = { ...basic, name: 'Standard', priceKes: '3500' };
    expect(monthlyPrice({ plan: standard, agreedPriceKes: '6000.00' })).toBe(6000);
    expect(monthlyPrice({ plan: basic, agreedPriceKes: '2000', extraTills: 1 })).toBe(4000);
    expect(extraTillPrice({ plan: basic })).toBe(500);
  });

  it('moves the paid-up date by the bill', () => {
    const now = new Date('2026-11-25T10:00:00Z');
    expect(periodAfterBill(new Date('2026-12-01T00:00:00Z'), { months: 4 }, now).toISOString().slice(0, 10)).toBe('2027-04-01');
    expect(periodAfterBill(new Date('2026-10-01T00:00:00Z'), { days: 30 }, now).toISOString().slice(0, 10)).toBe('2026-12-25');
  });

  it('spreads yearly and instalment plans over months for MRR', () => {
    expect(monthlyEquivalent({ plan: basic, billingChoice: 'ANNUAL' })).toBeCloseTo(833.33, 2);
    expect(monthlyEquivalent({ plan: basic, billingChoice: 'INSTALMENTS' })).toBe(875);
  });

  it('only offers instalments where the plan has them, and nothing but monthly on a free plan', () => {
    expect(choiceProblem({ ...basic, instalmentCount: null }, 'INSTALMENTS')).toMatch(/no instalment/);
    expect(choiceProblem({ name: 'Online', priceKes: '0' }, 'ANNUAL')).toMatch(/free/);
    expect(choiceProblem({ ...basic, billingCycle: 'SEASONAL' }, 'MONTHLY')).toMatch(/seasonal/);
    expect(choiceProblem(basic, 'ANNUAL')).toBeNull();
  });
});
