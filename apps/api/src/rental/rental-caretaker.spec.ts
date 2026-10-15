import { HttpException } from '@nestjs/common';
import { assertCaretakerAllowed, dropCaretakerIfNotCovered } from './rental-plans.service';

function fakeTx(opts: { industryType?: string; plan?: string; otherCaretakers?: number }) {
  return {
    organization: { findUnique: jest.fn(async () => ({ industryType: opts.industryType ?? 'RENTAL' })) },
    rentalSettings: { findUnique: jest.fn(async () => ({ plan: opts.plan ?? 'starter', pendingPlan: null, pendingPlanFrom: null })) },
    orgUser: { count: jest.fn(async () => opts.otherCaretakers ?? 0) },
  } as never;
}

describe('assertCaretakerAllowed', () => {
  it('allows the first caretaker on Starter', async () => {
    await expect(assertCaretakerAllowed(fakeTx({}), 'org-1')).resolves.toBeUndefined();
  });

  it('allows one on Pay-as-you-collect too', async () => {
    await expect(assertCaretakerAllowed(fakeTx({ plan: 'collect' }), 'org-1')).resolves.toBeUndefined();
  });

  it('asks a Bure landlord to upgrade', async () => {
    const err = await assertCaretakerAllowed(fakeTx({ plan: 'bure' }), 'org-1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(402);
  });

  it('refuses a second caretaker', async () => {
    await expect(assertCaretakerAllowed(fakeTx({ otherCaretakers: 1 }), 'org-1')).rejects.toThrow(/already have a caretaker/);
  });

  it('refuses a business that is not a rental business', async () => {
    await expect(assertCaretakerAllowed(fakeTx({ industryType: 'RETAIL' }), 'org-1')).rejects.toThrow(/only for rental businesses/);
  });

  it('does not count the person being changed as "another" caretaker', async () => {
    const tx = fakeTx({});
    await assertCaretakerAllowed(tx, 'org-1', 'user-9');
    expect((tx as unknown as { orgUser: { count: jest.Mock } }).orgUser.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', role: 'CARETAKER', isActive: true, id: { not: 'user-9' } },
    });
  });
});

describe('dropCaretakerIfNotCovered', () => {
  const txFor = (plan: string) => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const tx = {
      rentalSettings: { findUnique: jest.fn(async () => ({ plan, pendingPlan: null, pendingPlanFrom: null })) },
      orgUser: { updateMany },
    } as never;
    return { tx, updateMany };
  };

  it('deactivates the caretaker once the plan has no caretaker (Bure)', async () => {
    const { tx, updateMany } = txFor('bure');
    expect(await dropCaretakerIfNotCovered(tx, 'org-1')).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({ where: { organizationId: 'org-1', role: 'CARETAKER', isActive: true }, data: { isActive: false } });
  });

  it('leaves the caretaker alone on Starter', async () => {
    const { tx, updateMany } = txFor('starter');
    expect(await dropCaretakerIfNotCovered(tx, 'org-1')).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('drops the caretaker when a waiting move down to Bure has reached its date', async () => {
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const tx = {
      rentalSettings: { findUnique: jest.fn(async () => ({ plan: 'starter', pendingPlan: 'bure', pendingPlanFrom: new Date('2020-01-01') })) },
      orgUser: { updateMany },
    } as never;
    expect(await dropCaretakerIfNotCovered(tx, 'org-1')).toBe(1);
  });
});
