import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { CommissionService, hasOverdueCommission } from './commission.service';
import { PAUSE_GRACE_DAYS, invoiceDueDate } from './commission.util';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const INVOICE = '33333333-3333-3333-3333-333333333333';
const day = 24 * 60 * 60 * 1000;
const goodToken = createHmac('sha256', KEY).update(`commission-callback:${INVOICE}`).digest('base64url');

// Two orders in October (Nairobi), one in September.
const orders = [
  { id: 'o1', subtotal: 1000, commissionAmount: 30, completedAt: new Date('2026-10-05T10:00:00Z') },
  { id: 'o2', subtotal: 2000.5, commissionAmount: 60.02, completedAt: new Date('2026-10-20T10:00:00Z') },
  { id: 'o3', subtotal: 500, commissionAmount: 15, completedAt: new Date('2026-09-15T10:00:00Z') },
];

function issuedInvoice(overrides: Record<string, unknown> = {}) {
  const issuedAt = new Date('2026-11-01T06:00:00Z');
  return {
    id: INVOICE,
    organizationId: ORG,
    invoiceNumber: 'ZC-202610-7K3Q',
    periodMonth: '2026-10',
    orderCount: 2,
    salesTotal: 3000.5,
    commissionTotal: 90.02,
    amountDue: 91,
    status: 'ISSUED',
    issuedAt,
    dueDate: invoiceDueDate(issuedAt),
    paidAt: null,
    paymentMethod: null,
    paymentReference: null,
    waivedReason: null,
    tumaMerchantRequestId: null,
    payPhone: null,
    payAttemptedAt: null,
    lastPaymentError: null,
    emailedAt: null,
    reminderStage: 0,
    ...overrides,
  };
}

type Confirmation =
  | { outcome: 'paid'; mpesaReceipt?: string }
  | { outcome: 'review'; detail: string }
  | { outcome: 'unconfirmed'; detail: string }
  | { outcome: 'unavailable'; detail: string };

function setup(opts: { existing?: Record<string, unknown> | null; invoice?: Record<string, unknown>; confirmation?: Confirmation; emailSent?: boolean; bookings?: Record<string, unknown>[] } = {}) {
  const invoice = opts.invoice ?? issuedInvoice();
  const tx = {
    $executeRaw: jest.fn(),
    onlineOrder: {
      findMany: jest.fn().mockResolvedValue(orders),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    roomBooking: {
      findMany: jest.fn().mockResolvedValue(opts.bookings ?? []),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: { depositAmount: null, commissionAmount: null } }),
    },
    commissionInvoice: {
      // `existing: null` means "no invoice yet for this month" (not "use the default").
      findUnique: jest.fn().mockResolvedValue('existing' in opts ? opts.existing : invoice),
      findMany: jest.fn().mockResolvedValue([invoice]),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `inv-${data.periodMonth}`, issuedAt: new Date(), ...data })),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...invoice, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...invoice, status: 'PAID' }),
    },
    organization: { findUnique: jest.fn().mockResolvedValue({ name: 'Mama Mboga Ltd' }) },
    onlineStore: { findUnique: jest.fn().mockResolvedValue({ displayName: 'Mama Mboga' }) },
    orgUser: {
      findMany: jest.fn().mockResolvedValue([
        { role: Role.OWNER, user: { email: 'Owner@Example.com' } },
        { role: Role.MANAGER, user: { email: 'manager@example.com' } },
      ]),
    },
  };
  const prisma = {
    organization: { findMany: jest.fn().mockResolvedValue([{ id: ORG, name: 'Mama Mboga' }]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const tuma = {
    hasPlatformCredentials: jest.fn().mockReturnValue(true),
    platformCredentials: jest.fn().mockReturnValue({ email: 'platform@zaroda.test', apiKey: 'platform-key' }),
    stkPush: jest.fn().mockResolvedValue({ merchantRequestId: 'mr-1' }),
    confirmPayment: jest.fn().mockResolvedValue(opts.confirmation ?? { outcome: 'paid', mpesaReceipt: 'QAB1' }),
  };
  const email = {
    isConfigured: jest.fn().mockReturnValue(true),
    sendEmail: jest.fn().mockResolvedValue({ sent: opts.emailSent ?? true }),
  };
  const config = {
    get: jest.fn((k: string) =>
      ({
        SECRETS_ENCRYPTION_KEY: KEY.toString('base64'),
        PUBLIC_API_BASE_URL: 'https://api.example.com/',
        BACKOFFICE_BASE_URL: 'https://office.example.com',
      })[k],
    ),
  };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new CommissionService(prisma as any, tenantPrisma as any, tuma as any, email as any, config as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, tuma, email };
}

const asTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);

describe('CommissionService.generateInvoices', () => {
  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T08:00:00Z'));
  });
  afterAll(() => jest.useRealTimers());

  it('creates one invoice per closed month with correct totals, a whole-shilling amount due, and links the orders', async () => {
    const { service, tx } = setup({ existing: null });
    const result = await service.generateInvoices();

    expect(result.created).toBe(2);
    const created = tx.commissionInvoice.create.mock.calls.map((c) => c[0].data);
    expect(created.find((d) => d.periodMonth === '2026-10')).toMatchObject({ orderCount: 2, salesTotal: 3000.5, commissionTotal: 90.02, amountDue: 91, organizationId: ORG });
    expect(created.find((d) => d.periodMonth === '2026-09')).toMatchObject({ orderCount: 1, commissionTotal: 15, amountDue: 15 });
    // Each order is tied to its invoice, so it can never be billed twice.
    expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { commissionInvoiceId: 'inv-2026-10' } });
  });

  it('only looks at completed, unbilled orders from before this month', async () => {
    const { service, tx } = setup({ existing: null });
    await service.generateInvoices();
    const where = tx.onlineOrder.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('COMPLETED');
    expect(where.commissionInvoiceId).toBeNull();
    expect(where.completedAt.lt.toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });

  describe('with hotel bookings', () => {
    // A guest who checked out in October stayed 3 nights at KES 4,000 = KES 12,000 (the deposit they paid online does not matter):
    // KES 360 commission at 3%.
    const booking = { id: 'b1', total: 12000, commissionAmount: 360, checkedOutAt: new Date('2026-10-12T10:00:00Z') };

    it('bills checked-out bookings in the same monthly invoice as the shop orders', async () => {
      const { service, tx } = setup({ existing: null, bookings: [booking] });
      await service.generateInvoices({ month: '2026-10' });
      const data = tx.commissionInvoice.create.mock.calls[0][0].data;
      expect(data).toMatchObject({ periodMonth: '2026-10', orderCount: 3, salesTotal: 15000.5, commissionTotal: 450.02, amountDue: 451 });
      expect(tx.roomBooking.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1'] } }, data: { commissionInvoiceId: 'inv-2026-10' } });
      expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['o1', 'o2'] } }, data: { commissionInvoiceId: 'inv-2026-10' } });
    });

    it('a hotel with only bookings in a month still gets an invoice for them', async () => {
      const { service, tx } = setup({ existing: null, bookings: [{ ...booking, checkedOutAt: new Date('2026-08-20T10:00:00Z') }] });
      await service.generateInvoices({ month: '2026-08' });
      expect(tx.commissionInvoice.create.mock.calls[0][0].data).toMatchObject({ periodMonth: '2026-08', orderCount: 1, salesTotal: 12000, commissionTotal: 360, amountDue: 360 });
      expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    });

    it('only bills paid, checked-out, not-yet-billed bookings from before this month', async () => {
      const { service, tx } = setup({ existing: null });
      await service.generateInvoices();
      const where = tx.roomBooking.findMany.mock.calls[0][0].where;
      expect(where.status).toBe('CHECKED_OUT');
      expect(where.commissionInvoiceId).toBeNull();
      expect(where.paidAt).toEqual({ not: null });
      expect(where.checkedOutAt.lt.toISOString()).toBe('2026-10-31T21:00:00.000Z');
    });

    it('tops up an unpaid invoice with a late booking instead of creating a second invoice', async () => {
      const { service, tx } = setup({ bookings: [booking] });
      await service.generateInvoices({ month: '2026-10' });
      expect(tx.commissionInvoice.create).not.toHaveBeenCalled();
      expect(tx.commissionInvoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ orderCount: { increment: 3 } }) }));
      expect(tx.roomBooking.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['b1'] } }, data: { commissionInvoiceId: INVOICE } });
    });

    it('leaves bookings unbilled when their month was already settled', async () => {
      const { service, tx } = setup({ existing: issuedInvoice({ status: 'PAID' }), bookings: [booking] });
      const result = await service.generateInvoices({ month: '2026-10' });
      expect(result.created).toBe(0);
      expect(tx.roomBooking.updateMany).not.toHaveBeenCalled();
    });
  });

  it('can be limited to one month, and refuses one that has not ended', async () => {
    const { service, tx } = setup({ existing: null });
    await service.generateInvoices({ month: '2026-09' });
    expect(tx.commissionInvoice.create).toHaveBeenCalledTimes(1);
    await expect(service.generateInvoices({ month: '2026-11' })).rejects.toThrow(/has not ended/);
  });

  it('tops up a month that already has an unpaid invoice instead of creating a duplicate', async () => {
    const { service, tx } = setup();
    await service.generateInvoices({ month: '2026-10' });
    expect(tx.commissionInvoice.create).not.toHaveBeenCalled();
    expect(tx.commissionInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ orderCount: { increment: 2 }, amountDue: 181 }) }),
    );
  });

  it('leaves orders unbilled when their month was already settled', async () => {
    const { service, tx } = setup({ existing: issuedInvoice({ status: 'PAID' }) });
    const result = await service.generateInvoices({ month: '2026-10' });
    expect(result.created).toBe(0);
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe('paying an invoice online (through the platform Tuma account)', () => {
  beforeAll(() => jest.useFakeTimers().setSystemTime(new Date('2026-11-03T08:00:00Z')));
  afterAll(() => jest.useRealTimers());

  it('sends an STK push for the whole-shilling amount with the platform credentials and a signed callback URL', async () => {
    const { service, tuma, tx } = setup();
    const view = await asTenant(() => service.payOnline(INVOICE, '0712 345 678'));

    expect(tuma.stkPush).toHaveBeenCalledWith(
      { email: 'platform@zaroda.test', apiKey: 'platform-key' },
      expect.objectContaining({
        amount: 91,
        phone: '254712345678',
        callbackUrl: `https://api.example.com/public/commission/${ORG}/${INVOICE}/tuma-callback/${goodToken}`,
      }),
    );
    expect(tx.commissionInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tumaMerchantRequestId: 'mr-1', payPhone: '254712345678', lastPaymentError: null }) }),
    );
    expect(view).toBeDefined();
  });

  it('rejects a bad number, a settled invoice, and a too-quick second prompt', async () => {
    const bad = setup();
    await expect(asTenant(() => bad.service.payOnline(INVOICE, '12345'))).rejects.toThrow(BadRequestException);

    const paid = setup({ invoice: issuedInvoice({ status: 'PAID' }) });
    await expect(asTenant(() => paid.service.payOnline(INVOICE, '0712345678'))).rejects.toThrow(ConflictException);
    expect(paid.tuma.stkPush).not.toHaveBeenCalled();

    const quick = setup({ invoice: issuedInvoice({ payAttemptedAt: new Date(Date.now() - 10_000) }) });
    await expect(asTenant(() => quick.service.payOnline(INVOICE, '0712345678'))).rejects.toThrow(/retry in a minute/);
  });

  it('keeps the invoice unpaid and records why when Tuma refuses the prompt', async () => {
    const { service, tuma, tx } = setup();
    tuma.stkPush.mockRejectedValue(new Error('The payment service is unavailable right now'));
    await asTenant(() => service.payOnline(INVOICE, '0712345678'));
    expect(tx.commissionInvoice.update.mock.calls[0][0].data.lastPaymentError).toMatch(/unavailable/);
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
  });
});

describe("Tuma's callback for an invoice (the free webhook is how a payment is learned)", () => {
  const pending = () => issuedInvoice({ tumaMerchantRequestId: 'mr-1', payAttemptedAt: new Date() });
  // What a complete, successful Tuma callback looks like for the KES 91 invoice.
  const goodCallback = { merchant_request_id: 'mr-1', status: 'completed', amount: 91, mpesa_receipt_number: 'QAB1' };

  it('rejects a callback without the right URL token and never touches Tuma', async () => {
    const { service, tuma } = setup({ invoice: pending() });
    await expect(service.handleTumaCallback(ORG, INVOICE, 'forged', goodCallback)).rejects.toThrow(NotFoundException);
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
  });

  it('settles a complete callback straight away, spends nothing on a paid check, and emails a receipt', async () => {
    const { service, tuma, tx, email } = setup({ invoice: pending() });
    await service.handleTumaCallback(ORG, INVOICE, goodToken, goodCallback);

    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.commissionInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: INVOICE, status: 'ISSUED' },
      data: expect.objectContaining({ status: 'PAID', paymentMethod: 'MPESA', paymentReference: 'QAB1' }),
    });
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', subject: expect.stringContaining('Payment received') }));
  });

  it('flags a payment for the wrong amount for review instead of settling', async () => {
    const { service, tx } = setup({ invoice: pending() });
    await service.handleTumaCallback(ORG, INVOICE, goodToken, { ...goodCallback, amount: 10 });
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
    expect(tx.commissionInvoice.update.mock.calls[0][0].data.lastPaymentError).toMatch(/doesn't match/);
  });

  it('does not trust a "completed" callback with no receipt: it asks Tuma instead (KES 1)', async () => {
    const { service, tuma, tx } = setup({ invoice: pending(), confirmation: { outcome: 'paid', mpesaReceipt: 'FROMTUMA1' } });
    const { mpesa_receipt_number: _r, ...noReceipt } = goodCallback;
    await service.handleTumaCallback(ORG, INVOICE, goodToken, noReceipt);
    expect(tuma.confirmPayment).toHaveBeenCalledWith({ email: 'platform@zaroda.test', apiKey: 'platform-key' }, 'mr-1', 91);
    expect(tx.commissionInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentReference: 'FROMTUMA1' }) }));
  });

  it('leaves the invoice unpaid when that check says it has not been paid', async () => {
    const { service, tx, email } = setup({ invoice: pending(), confirmation: { outcome: 'unconfirmed', detail: 'pending' } });
    const { mpesa_receipt_number: _r, ...noReceipt } = goodCallback;
    await service.handleTumaCallback(ORG, INVOICE, goodToken, noReceipt);
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('does nothing for an invoice that is already settled', async () => {
    const { service, tuma, tx } = setup({ invoice: issuedInvoice({ status: 'PAID' }) });
    await service.handleTumaCallback(ORG, INVOICE, goodToken, goodCallback);
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('does not send two receipts when two settlements race', async () => {
    const { service, tx, email } = setup({ invoice: pending() });
    tx.commissionInvoice.updateMany.mockResolvedValue({ count: 0 });
    await service.handleTumaCallback(ORG, INVOICE, goodToken, goodCallback);
    expect(email.sendEmail).not.toHaveBeenCalled();
  });

  it('records a reported failure for the current prompt so the business can retry', async () => {
    const { service, tx } = setup({ invoice: pending() });
    await service.handleTumaCallback(ORG, INVOICE, goodToken, { merchant_request_id: 'mr-1', status: 'failed' });
    expect(tx.commissionInvoice.update.mock.calls[0][0].data.lastPaymentError).toMatch(/cancelled or failed/);
  });
});

describe('"check now" on an invoice (a paid backup, so it is limited)', () => {
  const pending = (id = INVOICE) => issuedInvoice({ id, tumaMerchantRequestId: 'mr-1', payAttemptedAt: new Date() });

  it('asks Tuma once, and refuses to again within the cooldown', async () => {
    const { service, tuma } = setup({ invoice: pending('inv-a'), confirmation: { outcome: 'unconfirmed', detail: 'pending' } });
    const first = await asTenant(() => service.checkPayment('inv-a'));
    expect(first.checkResult).toBe('not-paid-yet');
    await expect(asTenant(() => service.checkPayment('inv-a'))).rejects.toThrow(/wait about 30 seconds/);
    expect(tuma.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('settles the invoice when Tuma confirms it', async () => {
    const { service, tx } = setup({ invoice: pending('inv-b'), confirmation: { outcome: 'paid', mpesaReceipt: 'QCHK1' } });
    tx.commissionInvoice.findUnique.mockResolvedValue(pending('inv-b'));
    await asTenant(() => service.checkPayment('inv-b'));
    expect(tx.commissionInvoice.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ paymentReference: 'QCHK1' }) }));
  });

  it("reports honestly when Tuma can't answer (for example no credits), without calling it unpaid", async () => {
    const { service, tx } = setup({ invoice: pending('inv-c'), confirmation: { outcome: 'unavailable', detail: 'no credits' } });
    const result = await asTenant(() => service.checkPayment('inv-c'));
    expect(result.checkResult).toBe('unavailable');
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('does not call Tuma for an invoice with no payment started', async () => {
    const { service, tuma } = setup({ invoice: issuedInvoice({ id: 'inv-d' }) });
    const result = await asTenant(() => service.checkPayment('inv-d'));
    expect(result.checkResult).toBe('not-needed');
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
  });
});

describe('the daily automation: emails', () => {
  const issuedAt = new Date('2026-11-01T06:00:00Z');

  beforeEach(() => jest.useFakeTimers().setSystemTime(issuedAt));
  afterEach(() => jest.useRealTimers());

  const noOrders = (s: ReturnType<typeof setup>) => s.tx.onlineOrder.findMany.mockResolvedValue([]);

  it('emails a new invoice to the owner only (not the manager) and records that it was sent', async () => {
    const s = setup();
    noOrders(s);
    const result = await s.service.runAutomation();
    expect(result.emailsSent).toBe(1);
    expect(s.email.sendEmail).toHaveBeenCalledTimes(1);
    expect(s.email.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com', subject: expect.stringContaining('ZC-202610-7K3Q'), html: expect.stringContaining('https://office.example.com/settings/online-shop') }),
    );
    expect(s.tx.commissionInvoice.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reminderStage: 1 }) }),
    );
  });

  it('does not send the same notice twice', async () => {
    const s = setup({ invoice: issuedInvoice({ reminderStage: 1, emailedAt: issuedAt }) });
    noOrders(s);
    expect((await s.service.runAutomation()).emailsSent).toBe(0);
    expect(s.email.sendEmail).not.toHaveBeenCalled();
  });

  it('sends the overdue notice once the due date has passed', async () => {
    const s = setup({ invoice: issuedInvoice({ reminderStage: 2 }) });
    noOrders(s);
    jest.setSystemTime(new Date(issuedAt.getTime() + 15 * day));
    await s.service.runAutomation();
    expect(s.email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: expect.stringMatching(/Overdue/) }));
  });

  it('leaves the invoice due for another try when the email could not be sent', async () => {
    const s = setup({ emailSent: false });
    noOrders(s);
    const result = await s.service.runAutomation();
    expect(result.emailsSent).toBe(0);
    expect(result.emailsSkipped).toBe(1);
    expect(s.tx.commissionInvoice.update).not.toHaveBeenCalled();
  });

  it('skips a business with no owner or manager email', async () => {
    const s = setup();
    noOrders(s);
    s.tx.orgUser.findMany.mockResolvedValue([]);
    expect((await s.service.runAutomation()).emailsSkipped).toBe(1);
  });

  it('does nothing when email is not configured, and can be told not to email (night time)', async () => {
    const off = setup();
    noOrders(off);
    off.email.isConfigured.mockReturnValue(false);
    await off.service.runAutomation();
    expect(off.email.sendEmail).not.toHaveBeenCalled();

    const night = setup();
    noOrders(night);
    await night.service.runAutomation({ sendEmails: false });
    expect(night.email.sendEmail).not.toHaveBeenCalled();
  });

  it('the hourly scheduler never spends on a paid re-check (reconcile: false)', async () => {
    const s = setup({ invoice: issuedInvoice({ tumaMerchantRequestId: 'mr-1', payAttemptedAt: new Date(issuedAt.getTime() - 60_000), reminderStage: 1 }) });
    noOrders(s);
    await s.service.runAutomation({ sendEmails: false, reconcile: false });
    expect(s.tuma.confirmPayment).not.toHaveBeenCalled();
  });

  it('a person pressing Run billing now does re-check a payment whose callback never arrived', async () => {
    const s = setup({ invoice: issuedInvoice({ tumaMerchantRequestId: 'mr-1', payAttemptedAt: new Date(issuedAt.getTime() - 60_000), reminderStage: 1 }) });
    noOrders(s);
    const result = await s.service.runAutomation({ sendEmails: false });
    expect(s.tuma.confirmPayment).toHaveBeenCalledWith(expect.anything(), 'mr-1', 91);
    expect(result.paymentsConfirmed).toBe(1);
  });
});

describe('recording a payment by hand (bank transfer, cash)', () => {
  it('refuses to pay an invoice that is already settled', async () => {
    const { service, tx } = setup({ invoice: issuedInvoice({ status: 'PAID' }) });
    await expect(service.recordPayment(ORG, INVOICE, { method: 'MPESA' }, 'admin-1')).rejects.toThrow(ConflictException);
    expect(tx.commissionInvoice.updateMany).not.toHaveBeenCalled();
  });

  it('marks an issued invoice paid, recording who and how, and emails a receipt', async () => {
    const { service, tx, email } = setup();
    await service.recordPayment(ORG, INVOICE, { method: 'BANK', reference: ' TX123 ' }, 'admin-1');
    expect(tx.commissionInvoice.updateMany).toHaveBeenCalledWith({
      where: { id: INVOICE, status: 'ISSUED' },
      data: expect.objectContaining({ status: 'PAID', paymentMethod: 'BANK', paymentReference: 'TX123', recordedByPlatformAdminId: 'admin-1' }),
    });
    expect(email.sendEmail).toHaveBeenCalled();
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
