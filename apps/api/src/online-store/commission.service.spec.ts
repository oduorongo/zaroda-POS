import { ConflictException } from '@nestjs/common';
import { CommissionService, hasOverdueCommission } from './commission.service';
import { PAUSE_GRACE_DAYS } from './commission.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const day = 24 * 60 * 60 * 1000;

// Two orders in October (Nairobi), one in September.
const orders = [
  { id: 'o1', subtotal: 1000, commissionAmount: 30, completedAt: new Date('2026-10-05T10:00:00Z') },
  { id: 'o2', subtotal: 2000.5, commissionAmount: 60.02, completedAt: new Date('2026-10-20T10:00:00Z') },
  { id: 'o3', subtotal: 500, commissionAmount: 15, completedAt: new Date('2026-09-15T10:00:00Z') },
];

function setup(existing: Record<string, unknown> | null = null) {
  const tx = {
    $executeRaw: jest.fn(),
    onlineOrder: {
      findMany: jest.fn().mockResolvedValue(orders),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    commissionInvoice: {
      findUnique: jest.fn().mockResolvedValue(existing),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({ id: `inv-${data.periodMonth}`, issuedAt: new Date(), ...data }),
      ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn(),
    },
    onlineStore: { findUnique: jest.fn().mockResolvedValue({ contactPhone: '0712345678', displayName: 'Shop' }) },
  };
  const prisma = {
    organization: { findMany: jest.fn().mockResolvedValue([{ id: ORG, name: 'Mama Mboga' }]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new CommissionService(prisma as any, {} as any, sms as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, sms };
}

describe('CommissionService.generateInvoices', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T08:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  it('creates one invoice per closed month with correct totals and links the orders', async () => {
    const { service, tx } = setup();
    const result = await service.generateInvoices();

    expect(result.created).toBe(2);
    const created = tx.commissionInvoice.create.mock.calls.map((c) => c[0].data);
    const october = created.find((d) => d.periodMonth === '2026-10');
    expect(october).toMatchObject({ orderCount: 2, salesTotal: 3000.5, commissionTotal: 90.02, organizationId: ORG });
    expect(created.find((d) => d.periodMonth === '2026-09')).toMatchObject({ orderCount: 1, salesTotal: 500, commissionTotal: 15 });
    // Each order is tied to its invoice, so it can never be billed twice.
    expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { commissionInvoiceId: 'inv-2026-10' } });
  });

  it("only looks at completed, unbilled orders from before this month", async () => {
    const { service, tx } = setup();
    await service.generateInvoices();
    const where = tx.onlineOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.commissionInvoiceId).toBeNull();
    // November 2026 starts at 2026-10-31T21:00Z in Nairobi.
    expect(where.completedAt.lt.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  it('can be limited to one month', async () => {
    const { service, tx } = setup();
    await service.generateInvoices({ month: '2026-09' });
    expect(tx.commissionInvoice.create).toHaveBeenCalledTimes(1);
    expect(tx.commissionInvoice.create.mock.calls[0][0].data.periodMonth).toBe('2026-09');
  });

  it('refuses a month that has not ended', async () => {
    const { service } = setup();
    await expect(service.generateInvoices({ month: '2026-11' })).rejects.toThrow(/has not ended/);
  });

  it('tops up a month that already has an unpaid invoice instead of creating a duplicate', async () => {
    const { service, tx } = setup({ id: 'inv-existing', status: 'ISSUED' });
    await service.generateInvoices({ month: '2026-10' });
    expect(tx.commissionInvoice.create).not.toHaveBeenCalled();
    expect(tx.commissionInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderCount: { increment: 2 } }) }),
    );
  });

  it('leaves orders unbilled when their month was already settled', async () => {
    const { service, tx } = setup({ id: 'inv-paid', status: 'PAID' });
    const result = await service.generateInvoices({ month: '2026-10' });
    expect(result.created).toBe(0);
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('texts the shop about each new invoice', async () => {
    const { service, sms } = setup();
    await service.generateInvoices({ month: '2026-10' });
    expect(sms.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+254712345678' }));
  });
});

describe('recording payments', () => {
  it('refuses to pay an invoice that is already settled', async () => {
    const { service, tx } = setup();
    tx.commissionInvoice.findUnique.mockResolvedValue({ id: 'i', status: 'PAID' });
    await expect(service.recordPayment(ORG, 'i', { method: 'MPESA' }, 'admin-1')).rejects.toThrow(ConflictException);
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('marks an issued invoice paid, recording who and how', async () => {
    const { service, tx } = setup();
    tx.commissionInvoice.findUnique.mockResolvedValue({ id: 'i', status: 'ISSUED' });
    tx.commissionInvoice.findUniqueOrThrow.mockResolvedValue({
      id: 'i', status: 'PAID', dueDate: new Date(), salesTotal: 1, commissionTotal: 1, issuedAt: new Date(),
    });
    await service.recordPayment(ORG, 'i', { method: 'BANK', reference: ' TX123 ' }, 'admin-1');
    expect(tx.commissionInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: 'i', status: 'ISSUED' },
      data: expect.objectContaining({ status: 'PAID', paymentMethod: 'BANK', paymentReference: 'TX123', recordedByPlatformAdminId: 'admin-1' }),
    });
  });
});

describe('hasOverdueCommission', () => {
  it('looks for unpaid invoices past due date plus the grace period', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const now = new Date('2026-12-01T00:00:00Z');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await hasOverdueCommission({ commissionInvoice: { count } } as any, now)).toBe(true);
    const cutoff = count.mock.calls[0][0].where.dueDate.lt as Date;
    expect(now.getTime() - cutoff.getTime()).toBe(PAUSE_GRACE_DAYS * day);
    expect(count.mock.calls[0][0].where.status).toBe('ISSUED');
  });

  it('is false when nothing is overdue', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await hasOverdueCommission({ commissionInvoice: { count: jest.fn().mockResolvedValue(0) } } as any)).toBe(false);
  });
});
