import { approvalProblem, plantCost, reconcile } from './materials.util';

describe('LPO approval', () => {
  const base = { total: 400000, createdBy: 'a', approverId: 'b', limit: 500000, limitsOn: true };

  it('lets someone else approve within their limit', () => {
    expect(approvalProblem(base)).toBeNull();
  });

  it('never lets the creator approve', () => {
    expect(approvalProblem({ ...base, approverId: 'a' })).toContain('someone else');
    expect(approvalProblem({ ...base, approverId: 'a', limit: null })).toContain('someone else');
  });

  it('stops approvals above the limit, unless limits are off for the plan or unlimited', () => {
    expect(approvalProblem({ ...base, total: 600000 })).toContain('above your approval limit of KES 500,000');
    expect(approvalProblem({ ...base, total: 600000, limitsOn: false })).toBeNull();
    expect(approvalProblem({ ...base, total: 60_000_000, limit: null })).toBeNull();
  });
});

describe('material reconciliation', () => {
  it('works out issued, outstanding, budget left and wastage', () => {
    const r = reconcile({ budget: 1200, ordered: 800, delivered: 600, used: 450, wasted: 50, onHand: 100 });
    expect(r).toMatchObject({ issued: 500, toDeliver: 200, budgetLeft: 700, wastagePercent: 10, overBudget: false, unaccounted: 0 });
  });

  it('flags going over the BQ allowance and stock that cannot be accounted for', () => {
    const r = reconcile({ budget: 100, ordered: 150, delivered: 150, used: 90, wasted: 0, onHand: 50 });
    expect(r.overBudget).toBe(true);
    expect(r.unaccounted).toBe(10);
    expect(reconcile({ budget: null, ordered: 0, delivered: 0, used: 0, wasted: 0, onHand: 0 })).toMatchObject({ budgetLeft: null, wastagePercent: 0, overBudget: false });
  });
});

describe('plant cost', () => {
  const logs = [
    { hours: 8, fuelLitres: 40, fuelCost: 7200 },
    { hours: 6.5, fuelLitres: 30, fuelCost: 5400 },
    { hours: 0, fuelLitres: null, fuelCost: null },
  ];

  it('charges hired plant per day worked plus fuel', () => {
    expect(plantCost({ ownership: 'HIRED', hireRate: 25000, rateUnit: 'DAY' }, logs)).toEqual({ hours: 14.5, days: 2, fuelLitres: 70, fuelCost: 12600, hireCost: 50000, total: 62600 });
  });

  it('or per hour', () => {
    expect(plantCost({ ownership: 'HIRED', hireRate: 3500, rateUnit: 'HOUR' }, logs).hireCost).toBe(50750);
  });

  it('owned plant costs only its fuel', () => {
    expect(plantCost({ ownership: 'OWNED', hireRate: 9999, rateUnit: 'DAY' }, logs)).toMatchObject({ hireCost: 0, total: 12600 });
  });
});
