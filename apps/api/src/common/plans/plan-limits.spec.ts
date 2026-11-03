import { ForbiddenException } from '@nestjs/common';
import { assertPlanAllows } from './plan-limits';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tx = (plan: { name: string; maxDevices: number; maxBranches: number } | null, terminals: number, branches: number): any => ({
  subscription: { findUnique: jest.fn().mockResolvedValue(plan ? { plan } : null) },
  terminal: { count: jest.fn().mockResolvedValue(terminals) },
  branch: { count: jest.fn().mockResolvedValue(branches) },
});

describe('assertPlanAllows', () => {
  const basic = { name: 'Basic', maxDevices: 1, maxBranches: 1 };

  it('lets a business add up to its plan, then refuses with an upgrade message', async () => {
    await expect(assertPlanAllows(tx(basic, 0, 0), 'org', 'TERMINAL')).resolves.toBeUndefined();
    await expect(assertPlanAllows(tx(basic, 1, 1), 'org', 'TERMINAL')).rejects.toThrow(/allows 1 till.*bigger plan/);
    await expect(assertPlanAllows(tx(basic, 1, 1), 'org', 'BRANCH')).rejects.toThrow(ForbiddenException);
  });

  it('gives the free Online Shop only plan no tills', async () => {
    await expect(assertPlanAllows(tx({ name: 'Online Shop only', maxDevices: 0, maxBranches: 1 }, 0, 1), 'org', 'TERMINAL')).rejects.toThrow(/has no tills/);
  });

  it("does not count the system's own terminals (online shop, front desk...) as tills", async () => {
    const t = tx(basic, 0, 1);
    await assertPlanAllows(t, 'org', 'TERMINAL');
    expect(t.terminal.count.mock.calls[0][0].where.deviceLabel.notIn).toEqual(expect.arrayContaining(['Online shop', 'Front desk']));
  });

  it('does not limit a business with no device plan (rentals, construction)', async () => {
    await expect(assertPlanAllows(tx(null, 50, 50), 'org', 'BRANCH')).resolves.toBeUndefined();
  });
});
