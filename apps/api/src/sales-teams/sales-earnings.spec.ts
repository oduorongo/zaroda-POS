import { BadRequestException } from '@nestjs/common';
import { SalesEarningsService } from './sales-earnings.service';
import { isMonth, nairobiMonth, round2, splitCommission } from './sales-earnings.util';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TEAM = 'team-1';

describe('round2 / nairobiMonth / isMonth', () => {
  it('rounds money to two places', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(10.1 + 0.2)).toBe(10.3);
  });

  it('counts a payment in the month it fell in Nairobi, not UTC', () => {
    // 22:00 UTC on 30 September is 01:00 on 1 October in Nairobi.
    expect(nairobiMonth(new Date('2026-09-30T22:00:00Z'))).toBe('2026-10');
    expect(nairobiMonth(new Date('2026-10-15T10:00:00Z'))).toBe('2026-10');
  });

  it('only accepts real months', () => {
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('2026-13')).toBe(false);
    expect(isMonth('October')).toBe(false);
  });
});

describe('splitCommission', () => {
  it('gives the member and the leader their slices of the same commission', () => {
    expect(splitCommission(1000, 0.3, 0.05, true)).toEqual({ member: 300, leader: 50 });
  });

  it('pays the leader nothing when the team has no leader', () => {
    expect(splitCommission(1000, 0.3, 0.05, false)).toEqual({ member: 300, leader: 0 });
  });

  it('never pays out more than was collected, even if the terms were somehow over 100%', () => {
    const { member, leader } = splitCommission(100, 0.9, 0.5, true);
    expect(member + leader).toBeLessThanOrEqual(100.01);
    expect(member).toBeGreaterThan(leader);
  });
});

function setup(opts: { team?: Record<string, unknown>; leaderId?: string | null; payments?: any[]; invoices?: any[]; existing?: any[]; bonused?: string[] } = {}) {
  const org = { id: 'org-1', name: 'Mama Mboga', salesTeamId: TEAM, salesAgentId: 'member-1' };
  const created: any[] = [];
  const tx: any = {
    $executeRaw: jest.fn(),
    commissionInvoice: { findMany: jest.fn().mockResolvedValue(opts.invoices ?? []) },
    salesEarning: {
      findMany: jest.fn().mockResolvedValue(opts.existing ?? []),
      createMany: jest.fn().mockImplementation(({ data }) => {
        created.push(...data);
        return Promise.resolve({ count: data.length });
      }),
    },
  };
  const prisma: any = {
    organization: { findMany: jest.fn().mockResolvedValue([org]) },
    salesTeam: { findMany: jest.fn().mockResolvedValue([{ id: TEAM, memberShareRate: 0.3, leaderOverrideRate: 0.05, onboardingBonusKes: 500, ...opts.team }]) },
    salesAgent: { findMany: jest.fn().mockResolvedValue(opts.leaderId === null ? [] : [{ id: opts.leaderId ?? 'leader-1', teamId: TEAM }]) },
    subscriptionPayment: { findMany: jest.fn().mockResolvedValue(opts.payments ?? []) },
    salesEarning: {
      findMany: jest.fn().mockResolvedValue((opts.bonused ?? []).map((organizationId) => ({ organizationId }))),
      createMany: tx.salesEarning.createMany,
    },
    $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
  };
  return { service: new SalesEarningsService(prisma), prisma, tx, created };
}

const payment = (id: string, paidAt: string) => ({ id, paidAt: new Date(paidAt), subscription: { organizationId: 'org-1' } });
const invoice = (id: string, commissionTotal: number, paidAt = '2026-10-10T08:00:00Z') => ({ id, commissionTotal, paidAt: new Date(paidAt) });

describe('SalesEarningsService.accrue - onboarding bonus', () => {
  it('pays the bonus once, on the first subscription payment, to the member who onboarded the shop', async () => {
    const { service, created } = setup({ payments: [payment('p1', '2026-10-05T08:00:00Z'), payment('p2', '2026-11-05T08:00:00Z')] });
    const result = await service.accrue(true);
    expect(result.bonuses).toBe(1);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ kind: 'ONBOARDING_BONUS', agentId: 'member-1', sourceId: 'p1', amountKes: 500, periodMonth: '2026-10' });
  });

  it('does not pay it twice for the same shop', async () => {
    const { service, created } = setup({ payments: [payment('p1', '2026-10-05T08:00:00Z')], bonused: ['org-1'] });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('pays nothing when the team has no bonus set, or the shop has not paid yet', async () => {
    const noBonus = setup({ team: { onboardingBonusKes: 0 }, payments: [payment('p1', '2026-10-05T08:00:00Z')] });
    await noBonus.service.accrue(true);
    expect(noBonus.created).toHaveLength(0);
    const notPaid = setup({ payments: [] });
    await notPaid.service.accrue(true);
    expect(notPaid.created).toHaveLength(0);
  });
});

describe('SalesEarningsService.accrue - commission', () => {
  it("credits the member's share and the leader's slice of a paid commission invoice, with the rate used", async () => {
    const { service, created, tx } = setup({ invoices: [invoice('inv-1', 1000)] });
    const result = await service.accrue(true);
    expect(tx.commissionInvoice.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PAID' });
    expect(result.commission).toBe(2);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'COMMISSION_SHARE', agentId: 'member-1', rate: 0.3, baseKes: 1000, amountKes: 300, sourceId: 'inv-1' }),
        expect.objectContaining({ kind: 'LEADER_OVERRIDE', agentId: 'leader-1', rate: 0.05, amountKes: 50, sourceId: 'inv-1' }),
      ]),
    );
  });

  it('reads the invoices inside that shop only', async () => {
    const { service, tx } = setup({ invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('skips what is already in the ledger', async () => {
    const { service, created } = setup({
      invoices: [invoice('inv-1', 1000)],
      existing: [{ kind: 'COMMISSION_SHARE', sourceId: 'inv-1' }, { kind: 'LEADER_OVERRIDE', sourceId: 'inv-1' }],
    });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('pays no leader slice when the team has no active leader', async () => {
    const { service, created } = setup({ invoices: [invoice('inv-1', 1000)], leaderId: null });
    await service.accrue(true);
    expect(created.map((c) => c.kind)).toEqual(['COMMISSION_SHARE']);
  });

  it("does nothing while a team's rates are zero", async () => {
    const { service, created, prisma } = setup({ team: { memberShareRate: 0, leaderOverrideRate: 0 }, invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    expect(created).toHaveLength(0);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('is rate-limited when not forced, so looking at a statement does not rescan every shop each time', async () => {
    const { service, prisma } = setup({ invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    const again = await service.accrue();
    expect(again.skipped).toBe(true);
    expect(prisma.organization.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('SalesEarningsService.recordPayout', () => {
  function payoutSetup(due: { id: string; amountKes: number }[], markedCount = due.length) {
    const tx: any = {
      salesEarning: { findMany: jest.fn().mockResolvedValue(due), updateMany: jest.fn().mockResolvedValue({ count: markedCount }) },
      salesPayout: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'payout-1', paidAt: new Date(), reference: null, ...data })) },
      platformAuditLog: { create: jest.fn() },
    };
    const prisma: any = { salesAgent: { findUnique: jest.fn().mockResolvedValue({ id: 'member-1' }) }, $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)) };
    return { service: new SalesEarningsService(prisma), tx };
  }
  const dto: any = { agentId: 'member-1', throughMonth: '2026-10', method: 'MPESA', reference: ' QWE123 ' };

  it('pays everything unpaid up to the month, marks exactly those earnings paid, and logs it', async () => {
    const { service, tx } = payoutSetup([{ id: 'e1', amountKes: 300 }, { id: 'e2', amountKes: 500.5 }]);
    const result = await service.recordPayout('admin-1', dto);
    expect(tx.salesEarning.findMany.mock.calls[0][0].where).toMatchObject({ agentId: 'member-1', status: 'ACCRUED', periodMonth: { lte: '2026-10' } });
    expect(result).toMatchObject({ amountKes: 800.5, earningsCount: 2, reference: 'QWE123' });
    expect(tx.salesEarning.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['e1', 'e2'] }, status: 'ACCRUED' }, data: { status: 'PAID', payoutId: 'payout-1' } });
    expect(tx.platformAuditLog.create).toHaveBeenCalled();
  });

  it('refuses when nothing is owed', async () => {
    const { service } = payoutSetup([]);
    await expect(service.recordPayout('admin-1', dto)).rejects.toThrow(BadRequestException);
  });

  it('refuses (and rolls back) if someone else paid some of those earnings in the meantime', async () => {
    const { service } = payoutSetup([{ id: 'e1', amountKes: 300 }, { id: 'e2', amountKes: 500 }], 1);
    await expect(service.recordPayout('admin-1', dto)).rejects.toThrow(/just paid/);
  });
});
