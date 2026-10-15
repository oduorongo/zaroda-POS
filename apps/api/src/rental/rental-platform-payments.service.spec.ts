import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { tenantContext } from '../common/tenant/tenant-context';
import { FOUNDING_LANDLORD_LIMIT, RentalPlatformPaymentsService } from './rental-platform-payments.service';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const INVOICE = '33333333-3333-3333-3333-333333333333';
const token = (id = INVOICE) => createHmac('sha256', KEY).update(`rental-platform-callback:${id}`).digest('base64url');

function invoiceRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: INVOICE,
    organizationId: ORG,
    invoiceNumber: 'ZRB-202611-ABCD',
    kind: 'SUBSCRIPTION',
    invoiceMonth: '2026-11',
    periodStart: new Date('2026-10-31T21:00:00Z'),
    periodEnd: new Date('2026-11-30T21:00:00Z'),
    plan: 'starter',
    billingCycle: 'monthly',
    occupiedUnits: 12,
    matchedRentTotal: null,
    amountDue: 1000,
    status: 'ISSUED',
    issuedAt: new Date('2026-11-01T06:00:00Z'),
    dueDate: new Date('2026-11-14T21:00:00Z'),
    paidAt: null,
    paymentMethod: null,
    paymentReference: null,
    waivedReason: null,
    tumaMerchantRequestId: 'req-1',
    payPhone: '254712345678',
    payAttemptedAt: new Date(),
    lastPaymentError: null,
    reminderStage: 1,
    ...overrides,
  };
}

function build(opts: { invoice?: Record<string, unknown>; foundingTaken?: number; ownFounding?: Date | null } = {}) {
  let invoice = invoiceRow(opts.invoice);
  const updateMany = jest.fn(async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
    if (invoice.id !== where.id || invoice.status !== where.status) return { count: 0 };
    invoice = { ...invoice, ...data };
    return { count: 1 };
  });
  const settingsUpdate = jest.fn(async () => ({}));
  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalPlatformInvoice: {
      findUnique: jest.fn(async () => invoice),
      findUniqueOrThrow: jest.fn(async () => invoice),
      updateMany,
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        invoice = { ...invoice, ...data };
        return invoice;
      }),
    },
    rentalSettings: {
      findUnique: jest.fn(async () => ({ foundingPriceUntil: opts.ownFounding ?? null })),
      count: jest.fn(async () => ((opts.foundingTaken ?? 0) > 0 ? 1 : 0)),
      update: settingsUpdate,
    },
    organization: {
      findMany: jest.fn(async () => Array.from({ length: Math.max(opts.foundingTaken ?? 0, 1) }, (_, i) => ({ id: `org-${i}` }))),
      findUnique: jest.fn(async () => ({ name: 'Mwangi Properties' })),
    },
    orgUser: { findMany: jest.fn(async () => [{ role: 'OWNER', user: { email: 'owner@example.com' } }]) },
  };
  const prisma = { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) };
  const tuma = {
    hasPlatformCredentials: () => true,
    platformCredentials: () => ({ email: 'z@z.co', apiKey: 'k' }),
    stkPush: jest.fn(async () => ({ merchantRequestId: 'req-new' })),
    confirmPayment: jest.fn(async () => ({ outcome: 'unconfirmed' })),
  };
  const email = { isConfigured: () => true, sendEmail: jest.fn(async (_m: { to: string; subject: string }) => ({ sent: true })) };
  const config = { get: (k: string) => (k === 'SECRETS_ENCRYPTION_KEY' ? KEY.toString('base64') : k === 'PUBLIC_API_BASE_URL' ? 'https://api.zarodashop.com' : undefined) };
  const billing = { recipientsFor: jest.fn(async () => ({ emails: ['owner@example.com'], name: 'Mwangi Properties' })) };
  const service = new RentalPlatformPaymentsService(prisma as never, { run: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never, tuma as never, email as never, config as never, billing as never);
  const asLandlord = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: 'OWNER' }, fn);
  return { service, tx, tuma, email, updateMany, settingsUpdate, current: () => invoice, asLandlord };
}

const paidCallback = (extra: Record<string, unknown> = {}) => ({
  status: 'completed',
  merchant_request_id: 'req-1',
  result_code: 0,
  amount: 1000,
  mpesa_receipt_number: 'UJBPD9NF5O',
  ...extra,
});

describe('paying a rental invoice online', () => {
  it('sends an M-Pesa prompt for the whole amount to the number typed, whatever its format', async () => {
    const { service, tuma, asLandlord } = build({ invoice: { tumaMerchantRequestId: null, payAttemptedAt: null, payPhone: null } });
    const view = await asLandlord(() => service.payOnline(INVOICE, '0712 345 678'));
    expect(tuma.stkPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ amount: 1000, phone: '254712345678', callbackUrl: expect.stringContaining(`/public/rental-platform/${ORG}/${INVOICE}/tuma-callback/${token()}`) }),
    );
    expect(view.paymentPending).toBe(true);
  });

  it('refuses a bad number, a paid invoice, and a second prompt within a minute', async () => {
    const fresh = { tumaMerchantRequestId: null, payAttemptedAt: null };
    await expect(build({ invoice: fresh }).asLandlord(() => build({ invoice: fresh }).service.payOnline(INVOICE, '12345'))).rejects.toThrow(BadRequestException);
    const paid = build({ invoice: { ...fresh, status: 'PAID' } });
    await expect(paid.asLandlord(() => paid.service.payOnline(INVOICE, '0712345678'))).rejects.toThrow(ConflictException);
    const recent = build({ invoice: { payAttemptedAt: new Date() } });
    await expect(recent.asLandlord(() => recent.service.payOnline(INVOICE, '0712345678'))).rejects.toThrow(/retry in a minute/);
  });

  it('keeps the error when Tuma will not start the payment, so the landlord can try again', async () => {
    const { service, tuma, asLandlord } = build({ invoice: { tumaMerchantRequestId: null, payAttemptedAt: null } });
    tuma.stkPush.mockRejectedValueOnce(new BadRequestException('Payment could not be started: insufficient credits'));
    const view = await asLandlord(() => service.payOnline(INVOICE, '0712345678'));
    expect(view.lastPaymentError).toMatch(/could not be started/);
    expect(view.paymentPending).toBe(false);
  });
});

describe('Tuma callback for a rental invoice', () => {
  it('refuses a callback whose address does not carry the right HMAC', async () => {
    const { service } = build();
    await expect(service.handleTumaCallback(ORG, INVOICE, 'forged', paidCallback())).rejects.toThrow(NotFoundException);
  });

  it('settles a complete, matching payment, records the M-Pesa receipt and emails a receipt', async () => {
    const { service, current, email } = build();
    await service.handleTumaCallback(ORG, INVOICE, token(), paidCallback());
    expect(current()).toMatchObject({ status: 'PAID', paymentMethod: 'MPESA', paymentReference: 'UJBPD9NF5O' });
    expect(email.sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'owner@example.com', subject: expect.stringContaining('Payment received') }));
  });

  it('settles only once however many times Tuma calls', async () => {
    const { service, email } = build();
    await service.handleTumaCallback(ORG, INVOICE, token(), paidCallback());
    await service.handleTumaCallback(ORG, INVOICE, token(), paidCallback());
    expect(email.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('does not settle a short payment; it flags it for a person to look at', async () => {
    const { service, current } = build();
    await service.handleTumaCallback(ORG, INVOICE, token(), paidCallback({ amount: 500 }));
    expect(current().status).toBe('ISSUED');
    expect(String(current().lastPaymentError)).toMatch(/does not match/);
  });

  it('does not settle a callback for a payment that failed, and says so', async () => {
    const { service, current } = build();
    await service.handleTumaCallback(ORG, INVOICE, token(), { status: 'failed', merchant_request_id: 'req-1', result_code: 1032 });
    expect(current().status).toBe('ISSUED');
    expect(String(current().lastPaymentError)).toMatch(/cancelled or failed/);
  });

  it('asks Tuma instead of trusting a callback that carries no receipt', async () => {
    const { service, tuma, current } = build();
    await service.handleTumaCallback(ORG, INVOICE, token(), paidCallback({ mpesa_receipt_number: undefined }));
    expect(tuma.confirmPayment).toHaveBeenCalledTimes(1);
    expect(current().status).toBe('ISSUED');
  });
});

describe('recording and waiving by a platform admin', () => {
  it('records a bank payment with who recorded it, once', async () => {
    const { service, current } = build();
    const view = await service.recordPayment(ORG, INVOICE, { method: 'BANK', reference: 'KCB-7788' }, 'admin-1');
    expect(view).toMatchObject({ status: 'PAID', paymentMethod: 'BANK', paymentReference: 'KCB-7788' });
    expect(current().recordedByPlatformAdminId).toBe('admin-1');
    await expect(service.recordPayment(ORG, INVOICE, { method: 'CASH' }, 'admin-2')).rejects.toThrow(ConflictException);
  });

  it('waives an unpaid invoice with a reason, and cannot waive a paid one', async () => {
    const { service } = build();
    expect(await service.waive(ORG, INVOICE, 'Goodwill after the outage', 'admin-1')).toMatchObject({ status: 'WAIVED', waivedReason: 'Goodwill after the outage' });
    const paid = build({ invoice: { status: 'PAID' } });
    await expect(paid.service.waive(ORG, INVOICE, 'oops', 'admin-1')).rejects.toThrow(ConflictException);
  });
});

describe('the founding offer', () => {
  it('gives one of the first 20 paying landlords the launch price for 12 months', async () => {
    const { service, settingsUpdate } = build({ foundingTaken: 3 });
    expect(await service.claimFoundingOffer(ORG, new Date('2026-11-05T10:00:00Z'))).toBe(true);
    expect(settingsUpdate).toHaveBeenCalledWith({ where: { organizationId: ORG }, data: { foundingPriceUntil: new Date('2027-11-05T10:00:00Z') } });
  });

  it('gives nothing once 20 landlords already have it', async () => {
    const { service, settingsUpdate, tx } = build({ foundingTaken: FOUNDING_LANDLORD_LIMIT });
    tx.rentalSettings.count.mockResolvedValue(1);
    expect(await service.claimFoundingOffer(ORG)).toBe(false);
    expect(settingsUpdate).not.toHaveBeenCalled();
  });

  it('never moves a landlord who already has it', async () => {
    const { service, settingsUpdate } = build({ ownFounding: new Date('2027-06-01T00:00:00Z') });
    expect(await service.claimFoundingOffer(ORG)).toBe(false);
    expect(settingsUpdate).not.toHaveBeenCalled();
  });

  it('is claimed by the first landlord payment that settles', async () => {
    const { service, settingsUpdate } = build({ foundingTaken: 0 });
    await service.recordPayment(ORG, INVOICE, { method: 'MPESA', reference: 'X1' }, 'admin-1');
    expect(settingsUpdate).toHaveBeenCalledTimes(1);
  });
});
