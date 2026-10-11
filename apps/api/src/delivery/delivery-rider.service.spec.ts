import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { deliveryCodeFor, MAX_CODE_ATTEMPTS } from './delivery.util';
import { DeliveryRiderService, toMyJobView, toOpenJobView } from './delivery-rider.service';

const KEY_B64 = Buffer.alloc(32, 5).toString('base64');
const KEY = Buffer.from(KEY_B64, 'base64');

const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  organizationId: 'org-1',
  orderId: 'order-1',
  status: 'PICKED_UP',
  orderNumber: 'ZR-AAAAAA',
  shopName: 'Shop',
  pickupArea: 'Main, Kisumu',
  dropoffSummary: 'Milimani',
  itemCount: 2,
  quoteDeadline: new Date(Date.now() + 600_000),
  agreedFee: 200,
  assignedAt: new Date(),
  pickedUpAt: new Date(),
  deliveredAt: null,
  cashCollected: null,
  codeAttempts: 0,
  riderId: 'rider-1',
  quotes: [],
  contact: { buyerName: 'Amina', buyerPhone: '254700000000', deliveryAddress: 'Milimani, house 4' },
  ...over,
});

function setup(opts: { rider?: Record<string, unknown> | null; job?: Record<string, unknown> | null } = {}) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    rider: { findUnique: jest.fn().mockResolvedValue(opts.rider === undefined ? { id: 'rider-1', status: 'APPROVED' } : opts.rider) },
    deliveryJob: {
      findFirst: jest.fn().mockResolvedValue(opts.job === undefined ? job() : opts.job),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve(job({ codeAttempts: (data.codeAttempts?.increment ?? 0) + 0 }))),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(job({ status: 'DELIVERED' })),
    },
    deliveryQuote: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    onlineOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: 'order-1', status: 'READY', subtotal: 1000, commissionRate: 0.03 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const config = { get: jest.fn(() => KEY_B64) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new DeliveryRiderService(prisma as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx };
}

describe('what a rider is shown', () => {
  it('before being chosen: no buyer name, phone or address - only the area', () => {
    const view = toOpenJobView(job({ quotes: [] }) as never);
    const text = JSON.stringify(view);
    expect(text).not.toContain('Amina');
    expect(text).not.toContain('254700000000');
    expect(text).not.toContain('house 4');
    expect(view.dropoffSummary).toBe('Milimani');
  });

  it('once chosen: the buyer\'s contact details and full address', () => {
    const view = toMyJobView(job() as never);
    expect(view).toMatchObject({ buyerName: 'Amina', buyerPhone: '254700000000', deliveryAddress: 'Milimani, house 4' });
  });

  it('never carries the delivery code', () => {
    expect(JSON.stringify(toMyJobView(job() as never))).not.toContain(deliveryCodeFor('job-1', KEY));
  });
});

describe('DeliveryRiderService.deliver', () => {
  const code = deliveryCodeFor('job-1', KEY);
  const wrong = code === '0000' ? '1111' : '0000';

  it('with the right code: delivers, records the cash, and completes the order with commission', async () => {
    const { service, tx } = setup();
    const view = await service.deliver('rider-1', 'job-1', { code, cashCollected: 250 });
    expect(view.status).toBe('DELIVERED');
    expect(tx.deliveryJob.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'DELIVERED', cashCollected: 250 });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2); // current rider, then the job's business for the order update
    expect(tx.onlineOrder.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'COMPLETED', commissionAmount: 30 });
  });

  it('defaults the cash collected to the agreed price', async () => {
    const { service, tx } = setup();
    await service.deliver('rider-1', 'job-1', { code });
    expect(tx.deliveryJob.updateMany.mock.calls[0][0].data.cashCollected).toBe(200);
  });

  it('a wrong code is counted, the order is NOT completed, and the rider is told how many tries are left', async () => {
    const { service, tx } = setup();
    tx.deliveryJob.update.mockResolvedValue(job({ codeAttempts: 2 }));
    await expect(service.deliver('rider-1', 'job-1', { code: wrong })).rejects.toThrow(`${MAX_CODE_ATTEMPTS - 2} tries left`);
    expect(tx.deliveryJob.update).toHaveBeenCalledWith({ where: { id: 'job-1' }, data: { codeAttempts: { increment: 1 } } });
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('locks the rider out after too many wrong codes - even the right code no longer works', async () => {
    const { service, tx } = setup({ job: job({ codeAttempts: MAX_CODE_ATTEMPTS }) });
    await expect(service.deliver('rider-1', 'job-1', { code })).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.deliveryJob.updateMany).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('cannot deliver goods that were never picked up', async () => {
    const { service } = setup({ job: job({ status: 'ASSIGNED' }) });
    await expect(service.deliver('rider-1', 'job-1', { code })).rejects.toThrow('picked up first');
  });

  it('cannot deliver a job that is not theirs', async () => {
    const { service } = setup({ job: null });
    await expect(service.deliver('rider-1', 'job-1', { code })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('DeliveryRiderService - who may work', () => {
  it('a rider who is not approved can see and do nothing', async () => {
    for (const status of ['PENDING', 'SUSPENDED']) {
      const { service } = setup({ rider: { id: 'rider-1', status } });
      await expect(service.listOpen('rider-1')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.quote('rider-1', 'job-1', { fee: 200 })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.pickUp('rider-1', 'job-1')).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('picking up needs a job assigned to this rider', async () => {
    const { service, tx } = setup();
    tx.deliveryJob.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.pickUp('rider-1', 'job-1')).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.deliveryJob.updateMany.mock.calls[0][0].where).toEqual({ id: 'job-1', riderId: 'rider-1', status: 'ASSIGNED' });
  });

  it('a quote on a job that is not open (or not visible to this rider) is "not found"', async () => {
    const { service } = setup({ job: null });
    await expect(service.quote('rider-1', 'job-1', { fee: 200 })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a settled quote cannot be changed', async () => {
    const { service, tx } = setup();
    tx.deliveryQuote.findUnique.mockResolvedValue({ id: 'q1', status: 'REJECTED' });
    await expect(service.quote('rider-1', 'job-1', { fee: 100 })).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.deliveryQuote.update).not.toHaveBeenCalled();
  });
});
