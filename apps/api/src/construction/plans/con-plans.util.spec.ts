import { constructionUrl } from '../common/con-domain';
import { PlanLike, cheapestWith, limitMessage, downgradeProblems, extendPeriod, nextPlanUp, parseLimits, quote, subscriptionStatus, withinLimit } from './con-plans.util';

const plan = (code: string, sortOrder: number, monthlyPrice: number, features: string[], over: Partial<PlanLike> = {}): PlanLike => ({
  code,
  name: code,
  monthlyPrice,
  annualPrice: monthlyPrice * 10,
  quoteOnly: false,
  setupFee: null,
  setupFeeOptional: false,
  limits: { activeProjects: 2, workers: 30, users: 5 },
  features,
  sortOrder,
  ...over,
});
const mjengo = plan('CON_MJENGO', 0, 1500, ['compliance'], { limits: { activeProjects: 1, workers: 10, users: 2 }, setupFee: 3000, setupFeeOptional: true });
const fundi = plan('CON_FUNDI', 1, 3500, ['compliance', 'tenders', 'extra_projects']);
const contractor = plan('CON_CONTRACTOR', 2, 9500, ['compliance', 'payroll', 'extra_projects']);
const pro = plan('CON_PRO', 3, 25000, ['compliance', 'payroll', 'subcontracts']);

describe('construction plan rules', () => {
  const end = new Date('2026-11-01T00:00:00Z');
  const sub = (status: 'TRIAL' | 'ACTIVE' | 'CANCELLED') => ({ status, currentPeriodEnd: end, graceDays: 7 });

  it('moves from trial/active to grace for 7 days, then suspended', () => {
    expect(subscriptionStatus(sub('TRIAL'), new Date('2026-10-31T00:00:00Z'))).toBe('TRIAL');
    expect(subscriptionStatus(sub('ACTIVE'), new Date('2026-10-31T00:00:00Z'))).toBe('ACTIVE');
    expect(subscriptionStatus(sub('ACTIVE'), new Date('2026-11-05T00:00:00Z'))).toBe('GRACE');
    expect(subscriptionStatus(sub('TRIAL'), new Date('2026-11-09T00:00:00Z'))).toBe('SUSPENDED');
    expect(subscriptionStatus(sub('CANCELLED'), new Date('2026-10-01T00:00:00Z'))).toBe('CANCELLED');
  });

  it('prices monthly and annual (pay 10, get 12) with a coupon on the first months', () => {
    expect(quote(contractor, 'MONTHLY')).toMatchObject({ months: 1, gross: 9500, discount: 0, amount: 9500 });
    expect(quote(contractor, 'ANNUAL')).toMatchObject({ months: 12, gross: 95000, amount: 95000 });
    expect(quote(contractor, 'MONTHLY', { percentOff: 50, monthsLeft: 2 })).toMatchObject({ discount: 4750, amount: 4750, couponMonthsUsed: 1 });
    const annual = quote(contractor, 'ANNUAL', { percentOff: 50, monthsLeft: 2 });
    expect(annual.couponMonthsUsed).toBe(2);
    expect(annual.discount).toBe(Math.round((95000 / 12) * 2 * 0.5));
    expect(() => quote(plan('CON_ENTERPRISE', 4, 60000, [], { quoteOnly: true }), 'MONTHLY')).toThrow();
  });

  it('extends from the current end while it is ahead, otherwise from now', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    expect(extendPeriod(end, 1, now).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(extendPeriod(new Date('2026-10-01T00:00:00Z'), 1, now).toISOString()).toBe('2026-11-15T00:00:00.000Z');
  });

  it('checks limits and downgrades', () => {
    expect(withinLimit(5, 4)).toBe(true);
    expect(withinLimit(5, 5)).toBe(false);
    expect(withinLimit(null, 10_000)).toBe(true);
    expect(downgradeProblems({ users: 6, activeProjects: 1, workers: 0 }, fundi.limits)).toEqual(['You have 6 staff users; this plan allows 5']);
    expect(downgradeProblems({ users: 5, activeProjects: 2, workers: 30 }, fundi.limits)).toEqual([]);
    expect(parseLimits({ activeProjects: 6, workers: null })).toEqual({ activeProjects: 6, workers: null, users: null });
  });

  it('finds the plan to upgrade to', () => {
    expect(cheapestWith([pro, fundi, contractor], 'payroll')?.code).toBe('CON_CONTRACTOR');
    expect(cheapestWith([pro, fundi, contractor], 'subcontracts')?.code).toBe('CON_PRO');
    expect(nextPlanUp([pro, fundi, contractor], 'CON_FUNDI')?.code).toBe('CON_CONTRACTOR');
    expect(nextPlanUp([pro, fundi, contractor], 'CON_PRO')).toBeUndefined();
  });

  it('builds construction links on CONSTRUCTION_DOMAIN, https only', () => {
    expect(constructionUrl('/construction', 'build.example.app')).toBe('https://build.example.app/construction');
    expect(constructionUrl('x', 'http://build.example.app/')).toBe('https://build.example.app/x');
    expect(constructionUrl('/x', '')).toBeNull();
  });
});

describe('Mjengo', () => {
  const all = [mjengo, fundi, contractor, pro];

  it('costs 1,500 a month or 15,000 a year', () => {
    expect(quote(mjengo, 'MONTHLY').amount).toBe(1500);
    expect(quote(mjengo, 'ANNUAL').amount).toBe(15000);
  });

  it('is the entry plan and leads to Fundi', () => {
    expect(nextPlanUp(all, 'CON_MJENGO')?.code).toBe('CON_FUNDI');
    expect(cheapestWith(all, 'tenders')?.code).toBe('CON_FUNDI');
  });

  it('asks a second project to upgrade to Fundi, with no extra-project offer', () => {
    const msg = limitMessage(mjengo, all, 'activeProjects', 1, 1500);
    expect(msg).toBe('Your CON_MJENGO plan allows 1 active project. Upgrade to CON_FUNDI to add more.');
    expect(msg).not.toContain('extra project');
  });

  it('offers an extra project on plans that sell them', () => {
    expect(limitMessage(fundi, all, 'activeProjects', 2, 1500)).toContain('Add an extra project for KES 1,500/month, or upgrade to CON_CONTRACTOR');
    expect(limitMessage(fundi, all, 'users', 5, 1500)).toBe('Your CON_FUNDI plan allows 5 staff users. Upgrade to CON_CONTRACTOR to add more.');
  });
});
