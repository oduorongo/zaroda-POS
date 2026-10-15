import { RENTAL_PLANS, effectivePlan, isUpgrade, nextCycleStart, planFor, planForUnits, planHas } from './rental-plans.util';

describe('rental plans', () => {
  const now = new Date('2026-10-20T10:00:00Z');

  it('puts a landlord with no settings on Bure, with nothing extra switched on', () => {
    const plan = effectivePlan(null, now);
    expect(plan.code).toBe('bure');
    expect(plan.unitLimit).toBe(5);
    expect(plan.features).toEqual([]);
  });

  it('gives Starter the portal, receipts, statements and reminders but not M-Pesa collection', () => {
    const starter = RENTAL_PLANS.starter;
    expect(starter.unitLimit).toBe(30);
    for (const f of ['portal', 'receipts', 'statements', 'reminders'] as const) expect(planHas(starter, f)).toBe(true);
    expect(planHas(starter, 'collect')).toBe(false);
  });

  it('gives Pay-as-you-collect everything with no unit limit and a 1% fee', () => {
    expect(RENTAL_PLANS.collect.unitLimit).toBeNull();
    expect(RENTAL_PLANS.collect.feePercent).toBe(1);
    expect(planHas(RENTAL_PLANS.collect, 'collect')).toBe(true);
  });

  it('prices annual Starter at 12 months for the price of 10', () => {
    expect(RENTAL_PLANS.starter.annualPrice).toBe(RENTAL_PLANS.starter.monthlyPrice * 10);
  });

  it('keeps the current plan until a waiting move reaches its date, then switches', () => {
    const fields = { plan: 'collect', pendingPlan: 'starter', pendingPlanFrom: new Date('2026-11-01T00:00:00Z') };
    expect(effectivePlan(fields, now).code).toBe('collect');
    expect(effectivePlan(fields, new Date('2026-11-01T00:00:00Z')).code).toBe('starter');
  });

  it('falls back to Bure for an unknown plan code', () => {
    expect(effectivePlan({ plan: 'growth', pendingPlan: null, pendingPlanFrom: null }, now).code).toBe('bure');
  });

  it('tells a step up from a step down', () => {
    expect(isUpgrade('bure', 'starter')).toBe(true);
    expect(isUpgrade('collect', 'starter')).toBe(false);
    expect(isUpgrade('starter', 'starter')).toBe(false);
  });

  it('suggests the plan that fits: 6 units needs Starter, 31 needs Pay-as-you-collect', () => {
    expect(planForUnits(5).code).toBe('bure');
    expect(planForUnits(6).code).toBe('starter');
    expect(planForUnits(30).code).toBe('starter');
    expect(planForUnits(31).code).toBe('collect');
  });

  it('names the cheapest plan that has a feature', () => {
    expect(planFor('portal').code).toBe('starter');
    expect(planFor('collect').code).toBe('collect');
  });

  it('starts the next billing cycle on the 1st of next month, including across a year end', () => {
    expect(nextCycleStart(new Date('2026-10-20T00:00:00Z')).toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(nextCycleStart(new Date('2026-12-31T00:00:00Z')).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});
