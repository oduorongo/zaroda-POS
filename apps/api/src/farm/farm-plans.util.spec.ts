import { FarmPlanLike, limitProblem, parseLimits, subscriptionStatus } from './farm-plans.util';
import { needsDeviceSubscription } from '../platform-admin/subscriptions.util';
import { hasFarmRole } from './farm-access';

const plan = (code: string, name: string, sortOrder: number, limits: Partial<FarmPlanLike['limits']>, features: string[] = []): FarmPlanLike => ({
  code,
  name,
  monthlyPrice: 0,
  annualPrice: null,
  quoteOnly: false,
  limits: { head: null, birds: null, acres: null, users: null, ...limits },
  features,
  sortOrder,
});
const PLANS = [
  plan('FARM_KIENYEJI', 'Kienyeji', 1, { head: 20, birds: 200, acres: 2, users: 1 }),
  plan('FARM_MKULIMA', 'Mkulima', 2, { head: 100, birds: 2000, acres: 10, users: 3 }),
  plan('FARM_FARMER', 'Farmer', 3, { head: 500, birds: 10000, acres: 50, users: 8 }),
  plan('FARM_ESTATE', 'Estate', 5, {}),
];

describe('Shamba plans', () => {
  it('reads limits, with null for unlimited', () => {
    expect(parseLimits({ head: 20, birds: '200', acres: 2.5, users: null })).toEqual({ head: 20, birds: 200, acres: 2.5, users: null });
    expect(parseLimits(null)).toEqual({ head: null, birds: null, acres: null, users: null });
  });

  it('lets a farm use its plan up to the limit', () => {
    expect(limitProblem(PLANS[0], PLANS, 'acres', 1.5, 0.5)).toBeNull();
    expect(limitProblem(PLANS[3], PLANS, 'acres', 10_000, 500)).toBeNull();
  });

  it('refuses going over, naming the cheapest plan that fits', () => {
    expect(limitProblem(PLANS[0], PLANS, 'acres', 2, 1)).toEqual({ message: 'Your Kienyeji plan allows 2 acres. Upgrade to Mkulima to add more.', requiredPlan: 'FARM_MKULIMA' });
    expect(limitProblem(PLANS[0], PLANS, 'acres', 2, 30)?.requiredPlan).toBe('FARM_FARMER');
    expect(limitProblem(PLANS[1], PLANS, 'users', 3, 1)?.message).toBe('Your Mkulima plan allows 3 users. Upgrade to Farmer to add more.');
  });

  it('runs a trial, then grace, then read-only', () => {
    const end = new Date('2027-01-15T00:00:00Z');
    const sub = { status: 'TRIAL' as const, currentPeriodEnd: end, graceDays: 7 };
    expect(subscriptionStatus(sub, new Date('2027-01-10'))).toBe('TRIAL');
    expect(subscriptionStatus({ ...sub, status: 'ACTIVE' }, new Date('2027-01-10'))).toBe('ACTIVE');
    expect(subscriptionStatus(sub, new Date('2027-01-20'))).toBe('GRACE');
    expect(subscriptionStatus(sub, new Date('2027-01-25'))).toBe('SUSPENDED');
  });

  it('a farm has no POS till plan', () => {
    expect(needsDeviceSubscription('FARM')).toBe(false);
  });

  it('farm owners may do anything; others only what their roles allow', () => {
    const farm = (roles: any[], isOwner = false) => ({ organizationId: 'o', orgUserId: 'u', isOwner, roles, unitIds: null, plan: PLANS[2], status: 'ACTIVE' as const });
    expect(hasFarmRole(farm([], true), ['FARM_MANAGER'])).toBe(true);
    expect(hasFarmRole(farm(['FARM_OWNER']), ['FARM_MANAGER'])).toBe(true);
    expect(hasFarmRole(farm(['FARM_MANAGER']), ['FARM_MANAGER'])).toBe(true);
    expect(hasFarmRole(farm(['HERDSMAN']), ['FARM_MANAGER'])).toBe(false);
  });
});
