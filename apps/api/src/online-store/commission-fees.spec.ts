import { BadRequestException } from '@nestjs/common';
import { OnlineOrderStatus, Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { CommissionService, hasOverdueCommission } from './commission.service';
import { feeNoticeSms } from './commission-email';
import { dayOf, FEE_PAUSE_GRACE_DAYS, pauseDate } from './commission.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const KEY = Buffer.alloc(32, 7);
const asOwner = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);

type Issued = Record<string, unknown>;

function setup(opts: { orders?: { id: string; subtotal: number; convenienceFee: number }[]; todaysInvoices?: number; smsSent?: boolean; issued?: Issued[] } = {}) {
  const orders = opts.orders ?? [];
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    onlineOrder: {
      findMany: jest.fn().mockResolvedValue(orders),
      updateMany: jest.fn().mockResolvedValue({ count: orders.length }),
    },
    commissionInvoice: {
      count: jest.fn().mockResolvedValue(opts.todaysInvoices ?? 0),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'fee-inv-1', status: 'ISSUED', paidAt: null, reminderStage: 0, emailedAt: null, ...data })),
      findMany: jest.fn().mockResolvedValue(opts.issued ?? []),
      update: jest.fn().mockResolvedValue({}),
    },
    onlineStore: { findUnique: jest.fn().mockResolvedValue({ contactPhone: '0712345678', displayName: 'Mama Mboga' }) },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Mama Mboga Ltd' }) },
    orgUser: { findMany: jest.fn().mockResolvedValue([{ role: Role.OWNER, user: { email: 'Owner@Example.com' } }]) },
  };
  const prisma = {
    organization: { findMany: jest.fn().mockResolvedValue([{ id: ORG }]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: opts.smsSent ?? true }) };
  const email = { isConfigured: jest.fn().mockReturnValue(true), sendEmail: jest.fn().mockResolvedValue({ sent: true }) };
  const config = { get: jest.fn((k: string) => ({ SECRETS_ENCRYPTION_KEY: KEY.toString('base64'), BACKOFFICE_BASE_URL: 'https://office.example.com' })[k]) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new CommissionService(prisma as any, tenantPrisma as any, {} as any, email as any, sms as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, sms, email };
}

// The private notice sender, reached the way a scheduler tick would.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sendNotices = (service: CommissionService, at: Date): Promise<number> => (service as any).sendFeeNotices(at);

const feeInvoice = (extra: Issued = {}): Issued => ({
  id: 'f1', kind: 'DAILY_FEE', status: 'ISSUED', amountDue: 45, orderCount: 2, invoiceNumber: 'ZF-20261020-ABCD',
  issuedAt: new Date('2026-10-20T17:00:00Z'), reminderStage: 0, emailedAt: null, ...extra,
});

describe('shopper convenience fees: settling what the shop collected', () => {
  it('rolls every collected fee into ONE invoice that is due at once, and links the orders to it', async () => {
    const { service, tx } = setup({ orders: [{ id: 'o1', subtotal: 1000, convenienceFee: 30 }, { id: 'o2', subtotal: 500, convenienceFee: 15 }] });
    const view = await asOwner(() => service.settleFeesNow());
    const data = tx.commissionInvoice.create.mock.calls[0][0].data;
    expect(data.kind).toBe('DAILY_FEE');
    expect(data.amountDue).toBe(45);
    expect(data.commissionTotal).toBe(45);
    expect(data.salesTotal).toBe(1500);
    expect(data.orderCount).toBe(2);
    expect(data.dueDate).toEqual(data.issuedAt);
    expect(data.periodMonth).toBe(`${dayOf(data.issuedAt)}#1`);
    expect(data.invoiceNumber).toMatch(/^ZF-\d{8}-[A-Z0-9]{4}$/);
    expect(tx.onlineOrder.updateMany.mock.calls[0][0]).toEqual({ where: { id: { in: ['o1', 'o2'] } }, data: { commissionInvoiceId: 'fee-inv-1' } });
    expect(view.kind).toBe('DAILY_FEE');
    expect(view.amountDue).toBe(45);
  });

  it('only counts orders the shopper has paid and that are still standing', async () => {
    const { service, tx } = setup({ orders: [{ id: 'o1', subtotal: 1000, convenienceFee: 30 }] });
    await asOwner(() => service.settleFeesNow());
    const where = tx.onlineOrder.findMany.mock.calls[0][0].where;
    expect(where.convenienceFee).toEqual({ gt: 0 });
    expect(where.commissionInvoiceId).toBeNull();
    expect(where.status.in).toEqual([OnlineOrderStatus.PAID, OnlineOrderStatus.ACCEPTED, OnlineOrderStatus.READY, OnlineOrderStatus.COMPLETED]);
    expect(where.status.in).not.toContain(OnlineOrderStatus.CANCELLED);
    expect(where.status.in).not.toContain(OnlineOrderStatus.PENDING_PAYMENT);
  });

  it('takes a lock first so two taps cannot bill the same orders twice', async () => {
    const { service, tx } = setup({ orders: [{ id: 'o1', subtotal: 100, convenienceFee: 3 }] });
    await asOwner(() => service.settleFeesNow());
    expect(tx.$executeRaw).toHaveBeenCalled();
    expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(tx.onlineOrder.findMany.mock.invocationCallOrder[0]);
  });

  it('numbers a second invoice on the same day #2', async () => {
    const { service, tx } = setup({ orders: [{ id: 'o3', subtotal: 100, convenienceFee: 3 }], todaysInvoices: 1 });
    await asOwner(() => service.settleFeesNow());
    expect(tx.commissionInvoice.create.mock.calls[0][0].data.periodMonth).toMatch(/#2$/);
  });

  it('says so when there is nothing to send', async () => {
    const { service, tx } = setup({ orders: [] });
    await expect(asOwner(() => service.settleFeesNow())).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.commissionInvoice.create).not.toHaveBeenCalled();
  });
});

describe('the pause rule for unsent fees', () => {
  const now = new Date('2026-10-25T09:00:00Z');
  const DAY = 24 * 60 * 60 * 1000;

  it('hides a shop after 3 days unsent, not the 7 days of grace a monthly invoice gets', () => {
    const issued = new Date('2026-10-20T20:00:00Z');
    expect(pauseDate(issued, 'DAILY_FEE').getTime() - issued.getTime()).toBe(FEE_PAUSE_GRACE_DAYS * DAY);
    expect(pauseDate(issued, 'MONTHLY').getTime() - issued.getTime()).toBe(7 * DAY);
  });

  it('asks the database for both kinds, each with its own cut-off', async () => {
    const tx = { commissionInvoice: { count: jest.fn().mockResolvedValue(1) } };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await hasOverdueCommission(tx as any, now)).toBe(true);
    const [monthly, fee] = tx.commissionInvoice.count.mock.calls[0][0].where.OR;
    expect(monthly.dueDate.lt.getTime()).toBe(now.getTime() - 7 * DAY);
    expect(fee.kind).toBe('DAILY_FEE');
    expect(fee.dueDate.lt.getTime()).toBe(now.getTime() - 3 * DAY);
  });
});

describe('daily reminders about unsent fees', () => {
  it('texts and emails the notice the first evening', async () => {
    const { service, sms, email, tx } = setup({ issued: [feeInvoice()] });
    expect(await sendNotices(service, new Date('2026-10-20T18:00:00Z'))).toBe(1);
    expect(sms.sendSms.mock.calls[0][0].to).toBe('+254712345678');
    expect(sms.sendSms.mock.calls[0][0].message).toContain('KES 45');
    expect(email.sendEmail).toHaveBeenCalled();
    expect(tx.commissionInvoice.update.mock.calls[0][0].data.reminderStage).toBe(1);
  });

  it('sends the next reminder a day later, and not again the same day', async () => {
    const sentOnce = feeInvoice({ reminderStage: 1, emailedAt: new Date() });
    const same = setup({ issued: [sentOnce] });
    expect(await sendNotices(same.service, new Date('2026-10-20T19:00:00Z'))).toBe(0);
    const next = setup({ issued: [sentOnce] });
    expect(await sendNotices(next.service, new Date('2026-10-21T17:30:00Z'))).toBe(1);
    expect(next.tx.commissionInvoice.update.mock.calls[0][0].data.reminderStage).toBe(2);
  });

  it('stays quiet in the middle of the night', async () => {
    const { service, sms } = setup({ issued: [feeInvoice()] });
    expect(await sendNotices(service, new Date('2026-10-20T23:30:00Z'))).toBe(0); // 2:30am Nairobi
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('falls back to email when the text cannot be delivered (e.g. a Safaricom number)', async () => {
    const { service, email } = setup({ smsSent: false, issued: [feeInvoice()] });
    expect(await sendNotices(service, new Date('2026-10-20T18:00:00Z'))).toBe(1);
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('keeps every text within one SMS', () => {
    for (const stage of [1, 2, 3, 4] as const) expect(feeNoticeSms(stage, 12345).length).toBeLessThanOrEqual(160);
  });
});
