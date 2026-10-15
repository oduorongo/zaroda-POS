import { HttpException } from '@nestjs/common';
import { assertCaretakerAllowed } from './rental-plans.service';

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
