import { BadRequestException } from '@nestjs/common';
import { SalesEarningsService } from './sales-earnings.service';
import { addMonths, adjustmentAmount, applyCap, isMonth, nairobiMonth, payableFrom, round2, withholdTax, withinEarningWindow } from './sales-earnings.util';

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

describe('earning window and hold', () => {
  it('adds calendar months, clamping to the end of a short month', () => {
    expect(addMonths(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(addMonths(new Date('2026-03-10T00:00:00Z'), 12).toISOString()).toBe('2027-03-10T00:00:00.000Z');
  });

  it('stops earning once the shop is older than earningMonths', () => {
    const signedUp = new Date('2026-03-10T00:00:00Z');
    expect(withinEarningWindow(signedUp, new Date('2027-03-09T00:00:00Z'), 12)).toBe(true);
    expect(withinEarningWindow(signedUp, new Date('2027-03-11T00:00:00Z'), 12)).toBe(false);
  });

  it('holds a month for 30 days after it ends (Nairobi), then it is payable', () => {
    // October ends at 00:00 on 1 Nov Nairobi = 21:00 UTC on 31 Oct; +30 days.
    expect(payableFrom('2026-10', 30).toISOString()).toBe('2026-11-30T21:00:00.000Z');
  });
});

describe('applyCap', () => {
  it("is not triggered by the spec's worked example (1,650 of 6,000 = 27.5% under the 35% cap)", () => {
    expect(applyCap(1350, 300, 0.35 * 6000)).toEqual({ member: 1350, leader: 300, capped: false });
  });

  it('shrinks member and leader in proportion when they would exceed the cap', () => {
    // 1,650 asked, only 1,200 allowed
    const fit = applyCap(1350, 300, 1200);
    expect(fit.capped).toBe(true);
    expect(fit.member + fit.leader).toBeLessThanOrEqual(1200.01);
    expect(fit.member / fit.leader).toBeCloseTo(1350 / 300, 1);
  });

  it('pays nothing once the month has no headroom left', () => {
    expect(applyCap(100, 20, 0)).toEqual({ member: 0, leader: 0, capped: true });
    expect(applyCap(100, 20, -50)).toEqual({ member: 0, leader: 0, capped: true });
  });
});

describe('withholdTax / adjustmentAmount', () => {
  it('takes no tax at 0%, and the configured share otherwise', () => {
    expect(withholdTax(1000, 0)).toEqual({ tax: 0, net: 1000 });
    expect(withholdTax(1000, 0.05)).toEqual({ tax: 50, net: 950 });
  });

  it('reverses the refunded fraction of an earning as a negative amount, never more than the earning', () => {
    expect(adjustmentAmount(250, 1000, 400)).toBe(-100);
    expect(adjustmentAmount(250, 1000, 5000)).toBe(-250);
    expect(adjustmentAmount(250, 0, 100)).toBe(0);
  });
});

const NOW_ORG_CREATED = new Date('2026-09-01T00:00:00Z');

function setup(
  opts: {
    team?: Record<string, unknown>;
    leader?: { id: string; createdAt: Date } | null;
    memberStatus?: string;
    org?: Record<string, unknown>;
    payments?: any[];
    invoices?: any[];
    existing?: any[];
  } = {},
) {
  const org = {
    id: 'org-1',
    name: 'Mama Mboga',
    isActive: true,
    createdAt: NOW_ORG_CREATED,
    salesTeamId: TEAM,
    salesAgentId: 'member-1',
    salesAssignedAt: NOW_ORG_CREATED,
    subscription: { currentPeriodEnd: new Date('2099-01-01T00:00:00Z'), graceDays: 7, isTrial: false, manuallySuspended: false },
    ...opts.org,
  };
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
  const leader = opts.leader === undefined ? { id: 'leader-1', teamId: TEAM, createdAt: new Date('2026-01-01T00:00:00Z') } : opts.leader && { ...opts.leader, teamId: TEAM };
  const prisma: any = {
    organization: { findMany: jest.fn().mockResolvedValue([org]) },
    salesTeam: {
      findMany: jest.fn().mockResolvedValue([
        { id: TEAM, memberShareRate: 0.25, subscriptionShareRate: 0.1, leaderOverrideRate: 0.05, onboardingBonusKes: 500, payoutCapRate: 0.35, earningMonths: 12, ...opts.team },
      ]),
    },
    salesAgent: {
      findMany: jest.fn().mockImplementation(({ where }) => {
        if (where.role) return Promise.resolve(leader ? [leader] : []);
        return Promise.resolve([{ id: 'member-1', status: opts.memberStatus ?? 'ACTIVE' }]);
      }),
    },
    subscriptionPayment: { findMany: jest.fn().mockResolvedValue(opts.payments ?? []) },
    salesPayoutSettings: { upsert: jest.fn().mockResolvedValue({ holdDays: 30 }) },
    salesEarning: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn(), createMany: tx.salesEarning.createMany },
    $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
  };
  const payouts: any = { getSettings: jest.fn().mockResolvedValue({ holdDays: 30 }) };
  return { service: new SalesEarningsService(prisma, payouts), prisma, tx, created, payouts };
}

const payment = (id: string, paidAt: string, amount = 1000) => ({ id, amount, paidAt: new Date(paidAt), subscription: { organizationId: 'org-1' } });
const invoice = (id: string, commissionTotal: number, paidAt = '2026-10-10T08:00:00Z') => ({ id, commissionTotal, paidAt: new Date(paidAt) });

describe('SalesEarningsService.accrue - spec worked example', () => {
  it('member 25% x 5,000 + 10% x 1,000 = 1,350 and leader 5% x 6,000 = 300, each with its rate and base', async () => {
    const { service, created } = setup({ invoices: [invoice('inv-1', 5000)], payments: [payment('p1', '2026-10-05T08:00:00Z')] });
    await service.accrue(true);
    const amount = (kind: string) => created.filter((c) => c.kind === kind).reduce((t, c) => t + c.amountKes, 0);
    expect(amount('COMMISSION_SHARE') + amount('SUBSCRIPTION_SHARE')).toBe(1350);
    expect(amount('LEADER_OVERRIDE')).toBe(300);
    expect(created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'COMMISSION_SHARE', agentId: 'member-1', rate: 0.25, baseKes: 5000, amountKes: 1250, sourceId: 'inv-1', status: 'PENDING', capped: false }),
        expect.objectContaining({ kind: 'SUBSCRIPTION_SHARE', agentId: 'member-1', rate: 0.1, baseKes: 1000, amountKes: 100, sourceId: 'p1' }),
        expect.objectContaining({ kind: 'LEADER_OVERRIDE', agentId: 'leader-1', rate: 0.05, amountKes: 250, sourceId: 'inv-1' }),
        expect.objectContaining({ kind: 'LEADER_OVERRIDE', agentId: 'leader-1', rate: 0.05, amountKes: 50, sourceId: 'p1' }),
      ]),
    );
  });

  it('reads the invoices inside that shop only, and only paid ones', async () => {
    const { service, tx } = setup({ invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.commissionInvoice.findMany.mock.calls[0][0].where).toMatchObject({ status: 'PAID' });
  });
});

describe('SalesEarningsService.accrue - rules', () => {
  it('skips what is already in the ledger', async () => {
    const { service, created } = setup({
      invoices: [invoice('inv-1', 1000)],
      existing: [
        { kind: 'COMMISSION_SHARE', sourceId: 'inv-1', periodMonth: '2026-10', amountKes: 250, status: 'PENDING' },
        { kind: 'LEADER_OVERRIDE', sourceId: 'inv-1', periodMonth: '2026-10', amountKes: 50, status: 'PENDING' },
      ],
    });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('pays no leader slice when the team has no active leader, or the leader joined after the money came in', async () => {
    const none = setup({ invoices: [invoice('inv-1', 1000)], leader: null });
    await none.service.accrue(true);
    expect(none.created.map((c) => c.kind)).toEqual(['COMMISSION_SHARE']);
    const late = setup({ invoices: [invoice('inv-1', 1000)], leader: { id: 'leader-2', createdAt: new Date('2026-11-01T00:00:00Z') } });
    await late.service.accrue(true);
    expect(late.created.map((c) => c.kind)).toEqual(['COMMISSION_SHARE']);
  });

  it('stops once the shop is older than earningMonths', async () => {
    const { service, created } = setup({ team: { earningMonths: 1 }, invoices: [invoice('inv-1', 1000, '2026-11-10T08:00:00Z')] });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('does not back-pay money received before the current member was assigned the shop', async () => {
    const { service, created } = setup({ org: { salesAssignedAt: new Date('2026-10-20T00:00:00Z') }, invoices: [invoice('inv-1', 1000, '2026-10-10T08:00:00Z')] });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('writes a VOID row (no payout) while the shop is suspended, so reinstating later cannot back-pay it', async () => {
    const { service, created } = setup({ org: { isActive: false }, invoices: [invoice('inv-1', 1000)] });
    const result = await service.accrue(true);
    expect(result.commission).toBe(0);
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.status === 'VOID' && /suspended/.test(c.note))).toBe(true);
  });

  it('writes VOID rows while the subscription is unpaid', async () => {
    const { service, created } = setup({
      org: { subscription: { currentPeriodEnd: new Date('2026-01-01T00:00:00Z'), graceDays: 7, isTrial: false, manuallySuspended: false } },
      invoices: [invoice('inv-1', 1000)],
    });
    await service.accrue(true);
    expect(created.every((c) => c.status === 'VOID' && /unpaid/.test(c.note))).toBe(true);
  });

  it("voids the member's share but still pays the leader when the member is no longer active", async () => {
    const { service, created } = setup({ memberStatus: 'SUSPENDED', invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    expect(created.find((c) => c.kind === 'COMMISSION_SHARE')).toMatchObject({ status: 'VOID' });
    expect(created.find((c) => c.kind === 'LEADER_OVERRIDE')).toMatchObject({ status: 'PENDING', amountKes: 50 });
  });

  it('applies the payout cap to member + leader together, in proportion, and marks the rows capped', async () => {
    // 60% member + 5% leader of 1,000 = 650, but the cap is 35% = 350
    const { service, created } = setup({ team: { memberShareRate: 0.6 }, invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    const member = created.find((c) => c.kind === 'COMMISSION_SHARE');
    const leader = created.find((c) => c.kind === 'LEADER_OVERRIDE');
    expect(member.amountKes + leader.amountKes).toBeLessThanOrEqual(350.01);
    expect(member).toMatchObject({ capped: true, rate: 0.6 });
    expect(member.amountKes).toBeGreaterThan(leader.amountKes);
  });

  it("counts what was already earned that month against the cap, across runs", async () => {
    const { service, created } = setup({
      team: { memberShareRate: 0.6 },
      invoices: [invoice('inv-1', 1000)],
      existing: [{ kind: 'SUBSCRIPTION_SHARE', sourceId: 'old-pay', periodMonth: '2026-10', amountKes: 340, status: 'PENDING' }],
    });
    await service.accrue(true);
    expect(created.reduce((t, c) => t + c.amountKes, 0)).toBeLessThanOrEqual(10.01);
  });

  it("does nothing while a team's rates are zero", async () => {
    const { service, created } = setup({ team: { memberShareRate: 0, subscriptionShareRate: 0, leaderOverrideRate: 0, onboardingBonusKes: 0 }, invoices: [invoice('inv-1', 1000)], payments: [payment('p1', '2026-10-05T08:00:00Z')] });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('is rate-limited when not forced, so looking at a statement does not rescan every shop each time', async () => {
    const { service, prisma } = setup({ invoices: [invoice('inv-1', 1000)] });
    await service.accrue(true);
    const again = await service.accrue();
    expect(again.skipped).toBe(true);
    expect(prisma.organization.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('SalesEarningsService.accrue - bonus', () => {
  it('pays the bonus once, on the SECOND subscription payment, to the member who signed the shop', async () => {
    const { service, created } = setup({ payments: [payment('p1', '2026-10-05T08:00:00Z'), payment('p2', '2026-11-05T08:00:00Z')], team: { subscriptionShareRate: 0, leaderOverrideRate: 0 } });
    const result = await service.accrue(true);
    expect(result.bonuses).toBe(1);
    expect(created).toEqual([expect.objectContaining({ kind: 'ONBOARDING_BONUS', agentId: 'member-1', sourceId: 'p2', amountKes: 500, periodMonth: '2026-11' })]);
  });

  it('pays no bonus after only one payment', async () => {
    const { service, created } = setup({ payments: [payment('p1', '2026-10-05T08:00:00Z')], team: { subscriptionShareRate: 0, leaderOverrideRate: 0 } });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('does not pay it twice for the same shop (a VOID bonus counts too)', async () => {
    const { service, created } = setup({
      payments: [payment('p1', '2026-10-05T08:00:00Z'), payment('p2', '2026-11-05T08:00:00Z')],
      team: { subscriptionShareRate: 0, leaderOverrideRate: 0 },
      existing: [{ kind: 'ONBOARDING_BONUS', sourceId: 'p2', periodMonth: '2026-11', amountKes: 500, status: 'VOID' }],
    });
    await service.accrue(true);
    expect(created).toHaveLength(0);
  });

  it('sits outside the payout cap', async () => {
    const { service, created } = setup({ payments: [payment('p1', '2026-10-05T08:00:00Z', 1000), payment('p2', '2026-11-05T08:00:00Z', 1000)], team: { subscriptionShareRate: 0, leaderOverrideRate: 0 } });
    await service.accrue(true);
    expect(created.find((c) => c.kind === 'ONBOARDING_BONUS')).toMatchObject({ amountKes: 500, status: 'PENDING' });
  });
});

describe('SalesEarningsService.release', () => {
  it('makes PENDING earnings PAYABLE once their month ended more than holdDays ago', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-12-05T09:00:00Z'));
    try {
      const { service, prisma } = setup();
      await service.release();
      // 30 days before 5 Dec is 5 Nov, so October (ended 31 Oct) is releasable but November is not.
      expect(prisma.salesEarning.updateMany).toHaveBeenCalledWith({ where: { status: 'PENDING', periodMonth: { lt: '2026-11' } }, data: { status: 'PAYABLE' } });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('SalesEarningsService.recordAdjustment', () => {
  function adjustSetup(earnings: any[], prior: any[] = []) {
    const prisma: any = {
      salesEarning: {
        findMany: jest.fn().mockImplementation(({ where }) => Promise.resolve(where.kind?.in ? earnings : prior)),
        createMany: jest.fn().mockResolvedValue({ count: earnings.length }),
      },
      platformAuditLog: { create: jest.fn() },
    };
    return { service: new SalesEarningsService(prisma, { getSettings: jest.fn() } as any), prisma };
  }
  const earned = (id: string, agentId: string, amountKes: number) => ({ id, agentId, teamId: TEAM, organizationId: 'org-1', organizationName: 'Mama Mboga', kind: 'COMMISSION_SHARE', baseKes: 1000, rate: 0.25, amountKes, status: 'PAID' });

  it('writes a negative adjustment for each earning from that payment, in proportion to the refund', async () => {
    const { service, prisma } = adjustSetup([earned('e1', 'member-1', 250), { ...earned('e2', 'leader-1', 50), kind: 'LEADER_OVERRIDE' }]);
    const result = await service.recordAdjustment('admin-1', { sourceId: 'inv-1', refundedKes: 400, reference: 'refund-9' });
    const rows = prisma.salesEarning.createMany.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ kind: 'ADJUSTMENT', agentId: 'member-1', amountKes: -100, sourceId: 'e1:refund-9', status: 'PENDING' }),
      expect.objectContaining({ kind: 'ADJUSTMENT', agentId: 'leader-1', amountKes: -20, sourceId: 'e2:refund-9' }),
    ]);
    expect(result.totalKes).toBe(-120);
  });

  it('never reverses more than was earned across several refunds', async () => {
    const { service } = adjustSetup([earned('e1', 'member-1', 250)], [{ amountKes: -200 }]);
    await expect(service.recordAdjustment('admin-1', { sourceId: 'inv-1', refundedKes: 1000, reference: 'refund-10' })).resolves.toBeDefined();
  });

  it('refuses when nothing was earned from that payment', async () => {
    const { service } = adjustSetup([]);
    await expect(service.recordAdjustment('admin-1', { sourceId: 'nope', refundedKes: 10, reference: 'r' })).rejects.toThrow(/Nothing was earned/);
  });

  it('refuses when the earnings were already fully reversed', async () => {
    const { service } = adjustSetup([earned('e1', 'member-1', 250)], [{ amountKes: -250 }]);
    await expect(service.recordAdjustment('admin-1', { sourceId: 'inv-1', refundedKes: 1000, reference: 'r2' })).rejects.toThrow(BadRequestException);
  });
});
