import { HttpException } from '@nestjs/common';
import { assertCaretakerAllowed, trimCaretakersToPlan } from './rental-plans.service';

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
    await expect(assertCaretakerAllowed(fakeTx({ otherCaretakers: 1 }), 'org-1')).rejects.toThrow(/includes 1 caretaker account/);
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

describe('caretaker limits per plan', () => {
  it('allows up to 5 caretakers on Pay-as-you-collect and refuses a 6th', async () => {
    await expect(assertCaretakerAllowed(fakeTx({ plan: 'collect', otherCaretakers: 4 }), 'org-1')).resolves.toBeUndefined();
    await expect(assertCaretakerAllowed(fakeTx({ plan: 'collect', otherCaretakers: 5 }), 'org-1')).rejects.toThrow(/includes 5 caretaker accounts/);
  });

  it('points a Starter landlord with one caretaker at Pay-as-you-collect', async () => {
    await expect(assertCaretakerAllowed(fakeTx({ plan: 'starter', otherCaretakers: 1 }), 'org-1')).rejects.toThrow(/Pay-as-you-collect for up to 5/);
  });
});

describe('trimCaretakersToPlan', () => {
  const txFor = (plan: string, caretakerIds: string[]) => {
    const updateMany = jest.fn(async () => ({ count: 0 }));
    const tx = {
      rentalSettings: { findUnique: jest.fn(async () => ({ plan, pendingPlan: null, pendingPlanFrom: null })) },
      orgUser: { findMany: jest.fn(async () => caretakerIds.map((id) => ({ id }))), updateMany },
    } as never;
    return { tx, updateMany };
  };

  it('deactivates every caretaker on Bure', async () => {
    const { tx, updateMany } = txFor('bure', ['a', 'b']);
    await trimCaretakersToPlan(tx, 'org-1');
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['a', 'b'] } }, data: { isActive: false } });
  });

  it('keeps the longest-serving caretaker on Starter and deactivates the rest', async () => {
    const { tx, updateMany } = txFor('starter', ['oldest', 'newer', 'newest']);
    await trimCaretakersToPlan(tx, 'org-1');
    expect(updateMany).toHaveBeenCalledWith({ where: { id: { in: ['newer', 'newest'] } }, data: { isActive: false } });
  });

  it('touches nobody when the plan covers them all', async () => {
    const { tx, updateMany } = txFor('collect', ['a', 'b', 'c']);
    expect(await trimCaretakersToPlan(tx, 'org-1')).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
