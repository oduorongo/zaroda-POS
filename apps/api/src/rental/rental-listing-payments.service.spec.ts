import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { RentalListingPaymentsService } from './rental-listing-payments.service';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const LISTING = '22222222-2222-2222-2222-222222222222';
const PAYMENT = '33333333-3333-3333-3333-333333333333';
const token = (id = PAYMENT) => createHmac('sha256', KEY).update(`rental-listing-callback:${id}`).digest('base64url');
const DAY = 86_400_000;

function build(opts: { unitStatus?: 'VACANT' | 'OCCUPIED'; paidUntil?: Date | null; hasCredentials?: boolean } = {}) {
  let payment: Record<string, unknown> | null = null;
  let listing: Record<string, unknown> = { id: LISTING, unitId: 'unit-1', isActive: false, paidUntil: opts.paidUntil ?? null };

  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalUnit: { findUnique: jest.fn(async () => ({ id: 'unit-1', status: opts.unitStatus ?? 'VACANT' })) },
    rentalListing: {
      findUnique: jest.fn(async () => listing),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        listing = { ...listing, ...data };
        return listing;
      }),
    },
    rentalListingPayment: {
      findFirst: jest.fn(async () => (payment && payment.status === 'PENDING' ? payment : null)),
      findUnique: jest.fn(async () => payment),
      findUniqueOrThrow: jest.fn(async () => payment),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        payment = { id: PAYMENT, status: 'PENDING', createdAt: new Date(), tumaMerchantRequestId: null, ...data };
        return payment;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        payment = { ...payment, ...data };
        return payment;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { id?: string; status?: string }; data: Record<string, unknown> }) => {
        if (!payment || (where.id && payment.id !== where.id) || (where.status && payment.status !== where.status)) return { count: 0 };
        payment = { ...payment, ...data };
        return { count: 1 };
      }),
    },
  };
  const prisma = { $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const tenantPrisma = { run: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const stkPush = jest.fn(async () => ({ merchantRequestId: 'req-1' }));
  const tuma = {
    hasPlatformCredentials: () => opts.hasCredentials ?? true,
    platformCredentials: () => ({ email: 'z@z', apiKey: 'k' }),
    stkPush,
    confirmPayment: jest.fn(),
  };
  const config = {
    get: (name: string) => ({ SECRETS_ENCRYPTION_KEY: KEY.toString('base64'), PUBLIC_API_BASE_URL: 'https://api.example' })[name],
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RentalListingPaymentsService(prisma as any, tenantPrisma as any, tuma as any, config as any);
  return { service, tx, stkPush, getListing: () => listing, getPayment: () => payment };
}

const asTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);
const paidCallback = (over: Record<string, unknown> = {}) => ({ status: 'completed', merchant_request_id: 'req-1', amount: 100, mpesa_receipt_number: 'QAB123', ...over });

describe('RentalListingPaymentsService', () => {
  describe('pay', () => {
    it('sends an M-Pesa prompt for exactly KES 100 to the landlord’s number', async () => {
      const { service, stkPush } = build();
      await asTenant(() => service.pay(LISTING, '0712 345 678'));
      expect(stkPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 100, phone: '254712345678' }));
      const url = (stkPush.mock.calls[0] as unknown as [unknown, { callbackUrl: string }])[1].callbackUrl;
      expect(url).toContain(`/public/rental-listing-payments/${ORG}/${PAYMENT}/tuma-callback/${token()}`);
    });

    it('rejects a bad phone number without sending anything', async () => {
      const { service, stkPush } = build();
      await expect(asTenant(() => service.pay(LISTING, '123'))).rejects.toThrow(BadRequestException);
      expect(stkPush).not.toHaveBeenCalled();
    });

    it('refuses to charge for a unit that has been let', async () => {
      const { service, stkPush } = build({ unitStatus: 'OCCUPIED' });
      await expect(asTenant(() => service.pay(LISTING, '0712345678'))).rejects.toThrow(ConflictException);
      expect(stkPush).not.toHaveBeenCalled();
    });

    it('stops a second prompt within a minute', async () => {
      const { service } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await expect(asTenant(() => service.pay(LISTING, '0712345678'))).rejects.toThrow(/try again in a minute/);
    });

    it('records a failed prompt as FAILED and says why', async () => {
      const { service, stkPush, getPayment } = build();
      stkPush.mockRejectedValueOnce(new Error('Tuma is down'));
      await expect(asTenant(() => service.pay(LISTING, '0712345678'))).rejects.toThrow(/Tuma is down/);
      expect(getPayment()?.status).toBe('FAILED');
    });

    it('is unavailable until ZARODA’s Tuma account is set up', async () => {
      const { service } = build({ hasCredentials: false });
      await expect(asTenant(() => service.pay(LISTING, '0712345678'))).rejects.toThrow(/not available/);
    });
  });

  describe('callback', () => {
    it('a genuine payment switches the advert on for 30 days', async () => {
      const { service, getListing, getPayment } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback());
      expect(getPayment()?.status).toBe('PAID');
      expect(getPayment()?.paymentReference).toBe('QAB123');
      const listing = getListing();
      expect(listing.isActive).toBe(true);
      const days = ((listing.paidUntil as Date).getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
    });

    it('paying early adds 30 days on top of the time left', async () => {
      const left = new Date(Date.now() + 10 * DAY);
      const { service, getListing } = build({ paidUntil: left });
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback());
      expect((getListing().paidUntil as Date).getTime()).toBe(left.getTime() + 30 * DAY);
    });

    it('a repeated callback extends the advert only once', async () => {
      const { service, getListing } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback());
      const first = (getListing().paidUntil as Date).getTime();
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback());
      expect((getListing().paidUntil as Date).getTime()).toBe(first);
    });

    it('rejects a forged address', async () => {
      const { service, getPayment } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await expect(service.handleTumaCallback(ORG, PAYMENT, 'not-the-token', paidCallback())).rejects.toThrow(NotFoundException);
      expect(getPayment()?.status).toBe('PENDING');
    });

    it('does not accept a payment for less than KES 100', async () => {
      const { service, getListing, getPayment } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback({ amount: 20 }));
      expect(getPayment()?.status).not.toBe('PAID');
      expect(getListing().paidUntil).toBeNull();
    });

    it('a cancelled payment leaves the advert unpaid and can be retried', async () => {
      const { service, getListing, getPayment } = build();
      await asTenant(() => service.pay(LISTING, '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), { status: 'failed', merchant_request_id: 'req-1', result_code: 1032 });
      expect(getPayment()?.status).toBe('FAILED');
      expect(getListing().paidUntil).toBeNull();
    });
  });
});
