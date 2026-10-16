import { BadRequestException } from '@nestjs/common';
import { parseB2cResult } from './mpesa-b2c.client';
import { SalesPayoutsService } from './sales-payouts.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SETTINGS = { id: 'default', payoutGateway: 'MPESA_B2C', payoutMinKes: 500, payoutDay: 5, holdDays: 30, withholdingTaxRate: 0, lastRunMonth: null };

function setup(opts: { settings?: Record<string, unknown>; due?: { id: string; amountKes: number; periodMonth?: string }[]; markedCount?: number; agent?: Record<string, unknown>; b2c?: Record<string, unknown>; tuma?: Record<string, unknown> } = {}) {
  const due = opts.due ?? [];
  const tx: any = {
    salesEarning: { findMany: jest.fn().mockResolvedValue(due.map((d) => ({ periodMonth: '2026-09', ...d }))), updateMany: jest.fn().mockResolvedValue({ count: opts.markedCount ?? due.length }) },
    salesPayout: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'payout-1', createdAt: new Date(), failureReason: null, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'payout-1', status: 'FAILED' }),
    },
    platformAuditLog: { create: jest.fn() },
  };
  const agent = { id: 'member-1', fullName: 'Wanjiru', status: 'ACTIVE', payoutGateway: 'MPESA_B2C', payoutAccount: '0712345678', ...opts.agent };
  const prisma: any = {
    salesPayoutSettings: { upsert: jest.fn().mockResolvedValue({ ...SETTINGS, ...opts.settings }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    salesAgent: { findUnique: jest.fn().mockResolvedValue(agent) },
    salesEarning: { groupBy: jest.fn().mockResolvedValue([{ agentId: 'member-1', _sum: { amountKes: due.reduce((t, d) => t + d.amountKes, 0) } }]), updateMany: tx.salesEarning.updateMany },
    salesPayout: { ...tx.salesPayout, findFirst: jest.fn(), update: jest.fn().mockResolvedValue({ id: 'payout-1' }), findMany: jest.fn() },
    platformAuditLog: tx.platformAuditLog,
    $transaction: jest.fn((fn: (t: any) => unknown) => fn(tx)),
  };
  const b2c: any = { isConfigured: jest.fn().mockReturnValue(true), send: jest.fn().mockResolvedValue({}), ...opts.b2c };
  const tuma: any = { hasPayoutSupport: jest.fn().mockReturnValue(false), sendMoney: jest.fn(), ...opts.tuma };
  return { service: new SalesPayoutsService(prisma, b2c, tuma), prisma, tx, b2c, tuma };
}

describe('SalesPayoutsService.recordManual', () => {
  it('pays everything payable, withholds tax, marks exactly those earnings paid and logs it', async () => {
    const { service, tx } = setup({ settings: { withholdingTaxRate: 0.05 }, due: [{ id: 'e1', amountKes: 300 }, { id: 'e2', amountKes: 700.5 }] });
    const result = await service.recordManual('admin-1', { agentId: 'member-1', reference: ' QWE123 ' });
    expect(tx.salesEarning.findMany.mock.calls[0][0].where).toMatchObject({ agentId: 'member-1', status: 'PAYABLE', payoutId: null });
    expect(result).toMatchObject({ amountKes: 1000.5, taxWithheldKes: 50.03, netKes: 950.47, gateway: 'MANUAL', reference: 'QWE123', status: 'PAID' });
    expect(tx.salesEarning.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['e1', 'e2'] }, status: 'PAYABLE', payoutId: null }, data: { status: 'PAID', payoutId: 'payout-1' } });
    expect(tx.platformAuditLog.create).toHaveBeenCalled();
  });

  it('carries a balance under the minimum over to the next run', async () => {
    const { service, tx } = setup({ due: [{ id: 'e1', amountKes: 499 }] });
    await expect(service.recordManual('admin-1', { agentId: 'member-1', reference: 'REF' })).rejects.toThrow(/minimum/);
    expect(tx.salesPayout.create).not.toHaveBeenCalled();
  });

  it('refuses (and rolls back) if someone else paid some of those earnings in the meantime', async () => {
    const { service } = setup({ due: [{ id: 'e1', amountKes: 600 }, { id: 'e2', amountKes: 500 }], markedCount: 1 });
    await expect(service.recordManual('admin-1', { agentId: 'member-1', reference: 'REF' })).rejects.toThrow(/just paid/);
  });
});

describe('SalesPayoutsService.sendNow', () => {
  it('queues a payout and sends the NET (after tax, whole shillings) to the persons M-Pesa number', async () => {
    const { service, b2c } = setup({ settings: { withholdingTaxRate: 0.1 }, due: [{ id: 'e1', amountKes: 1005 }] });
    const result = await service.sendNow('admin-1', 'member-1');
    expect(result).toMatchObject({ status: 'QUEUED', gateway: 'MPESA_B2C', amountKes: 1005, taxWithheldKes: 100.5 });
    expect(b2c.send).toHaveBeenCalledWith(expect.objectContaining({ phone: '254712345678', amount: 904 }));
  });

  it('fails the payout and returns its earnings to payable when the gateway refuses it', async () => {
    const { service, tx } = setup({ due: [{ id: 'e1', amountKes: 1000 }], b2c: { send: jest.fn().mockRejectedValue(new BadRequestException('Insufficient funds')) } });
    const result = await service.sendNow('admin-1', 'member-1');
    expect(result.status).toBe('FAILED');
    expect(tx.salesPayout.updateMany).toHaveBeenCalledWith({ where: { id: 'payout-1', status: 'QUEUED' }, data: { status: 'FAILED', failureReason: 'Insufficient funds' } });
    expect(tx.salesEarning.updateMany).toHaveBeenCalledWith({ where: { payoutId: 'payout-1' }, data: { status: 'PAYABLE', payoutId: null } });
  });

  it('refuses when the person has no gateway set up on the server to be paid through', async () => {
    const { service } = setup({ due: [{ id: 'e1', amountKes: 1000 }], b2c: { isConfigured: jest.fn().mockReturnValue(false) } });
    await expect(service.sendNow('admin-1', 'member-1')).rejects.toThrow(/No payout gateway/);
  });
});

describe('SalesPayoutsService.settleB2c', () => {
  const queued = { id: 'payout-1', status: 'QUEUED', amountKes: 1000, taxWithheldKes: 0, method: 'MPESA_B2C' };

  it("marks the payout paid, with M-Pesa's receipt, on a success result", async () => {
    const { service, prisma } = setup();
    prisma.salesPayout.findFirst.mockResolvedValue(queued);
    await service.settleB2c({ originatorConversationId: 'req-1', resultCode: 0, receipt: 'SBC123', amount: 1000 });
    expect(prisma.salesPayout.updateMany).toHaveBeenCalledWith({ where: { id: 'payout-1', status: 'QUEUED' }, data: expect.objectContaining({ status: 'PAID', reference: 'SBC123' }) });
  });

  it('fails the payout on an error result', async () => {
    const { service, prisma, tx } = setup();
    prisma.salesPayout.findFirst.mockResolvedValue(queued);
    await service.settleB2c({ originatorConversationId: 'req-1', resultCode: 2001, resultDesc: 'The initiator information is invalid.' });
    expect(tx.salesEarning.updateMany).toHaveBeenCalledWith({ where: { payoutId: 'payout-1' }, data: { status: 'PAYABLE', payoutId: null } });
  });

  it('leaves the payout queued when M-Pesa reports a different amount than was requested', async () => {
    const { service, prisma } = setup();
    prisma.salesPayout.findFirst.mockResolvedValue(queued);
    await service.settleB2c({ originatorConversationId: 'req-1', resultCode: 0, amount: 10 });
    expect(prisma.salesPayout.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a repeated result for a payout that is no longer queued', async () => {
    const { service, prisma } = setup();
    prisma.salesPayout.findFirst.mockResolvedValue({ ...queued, status: 'PAID' });
    await service.settleB2c({ originatorConversationId: 'req-1', resultCode: 0 });
    expect(prisma.salesPayout.updateMany).not.toHaveBeenCalled();
  });
});

describe('SalesPayoutsService.runDue', () => {
  const FIFTH = new Date('2026-11-05T07:00:00Z');

  it('does nothing before the payout day, in manual mode, or twice in a month', async () => {
    const early = setup({ due: [{ id: 'e1', amountKes: 1000 }] });
    expect((await early.service.runDue(new Date('2026-11-04T07:00:00Z'))).ran).toBe(false);
    const manual = setup({ settings: { payoutGateway: 'MANUAL' }, due: [{ id: 'e1', amountKes: 1000 }] });
    expect((await manual.service.runDue(FIFTH)).ran).toBe(false);
    const done = setup({ settings: { lastRunMonth: '2026-11' }, due: [{ id: 'e1', amountKes: 1000 }] });
    expect((await done.service.runDue(FIFTH)).ran).toBe(false);
  });

  it('on the payout day sends balances at or over the minimum, and leaves smaller ones to carry over', async () => {
    const { service, b2c, prisma } = setup({ due: [{ id: 'e1', amountKes: 1000 }] });
    expect(await service.runDue(FIFTH)).toEqual({ ran: true, sent: 1, failed: 0 });
    expect(prisma.salesPayoutSettings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { lastRunMonth: '2026-11' } }));
    expect(b2c.send).toHaveBeenCalledTimes(1);
    const small = setup({ due: [{ id: 'e1', amountKes: 100 }] });
    expect(await small.service.runDue(FIFTH)).toEqual({ ran: true, sent: 0, failed: 0 });
    expect(small.b2c.send).not.toHaveBeenCalled();
  });

  it('does not run if another server already claimed the month', async () => {
    const { service, prisma, b2c } = setup({ due: [{ id: 'e1', amountKes: 1000 }] });
    prisma.salesPayoutSettings.updateMany.mockResolvedValue({ count: 0 });
    expect((await service.runDue(FIFTH)).ran).toBe(false);
    expect(b2c.send).not.toHaveBeenCalled();
  });

  it('leaves people with no gateway for the admin to pay by hand', async () => {
    const { service, b2c } = setup({ due: [{ id: 'e1', amountKes: 1000 }], agent: { payoutGateway: null, payoutAccount: null }, settings: { payoutGateway: 'MPESA_B2C' } });
    expect(await service.runDue(FIFTH)).toEqual({ ran: true, sent: 0, failed: 0 });
    expect(b2c.send).not.toHaveBeenCalled();
  });
});

describe('SalesPayoutsService.updateSettings', () => {
  it('will not switch to a gateway the server is not set up for', async () => {
    const { service } = setup({ b2c: { isConfigured: jest.fn().mockReturnValue(false) } });
    await expect(service.updateSettings('admin-1', { payoutGateway: 'MPESA_B2C' })).rejects.toThrow(/not set up/);
    await expect(service.updateSettings('admin-1', { payoutGateway: 'TUMA' })).rejects.toThrow(/not set up/);
  });
});

describe('parseB2cResult', () => {
  it("reads Safaricom's result body", () => {
    expect(
      parseB2cResult({
        Result: {
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          OriginatorConversationID: 'req-1',
          TransactionID: 'SBC123',
          ResultParameters: { ResultParameter: [{ Key: 'TransactionAmount', Value: 904 }] },
        },
      }),
    ).toEqual({ originatorConversationId: 'req-1', resultCode: 0, resultDesc: 'The service request is processed successfully.', receipt: 'SBC123', amount: 904 });
  });

  it('returns nothing for a body that is not a result', () => {
    expect(parseB2cResult({ hello: 'world' })).toEqual({});
    expect(parseB2cResult(null)).toEqual({});
  });
});
