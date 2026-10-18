import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { RentalListingPaymentsService } from './rental-listing-payments.service';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const L1 = '22222222-2222-2222-2222-222222222221';
const L2 = '22222222-2222-2222-2222-222222222222';
const L3 = '22222222-2222-2222-2222-222222222223';
const PAYMENT = '33333333-3333-3333-3333-333333333333';
const token = (id = PAYMENT) => createHmac('sha256', KEY).update(`rental-listing-callback:${id}`).digest('base64url');
const DAY = 86_400_000;

interface Opts {
  unitStatus?: 'VACANT' | 'OCCUPIED';
  paidUntil?: Date | null;
  hasCredentials?: boolean;
  blocked?: string[]; // listing ids taken down by ZARODA
  paused?: string[];
}

function build(opts: Opts = {}) {
  let payment: Record<string, unknown> | null = null;
  const listings = new Map<string, Record<string, unknown>>(
    [L1, L2, L3].map((id) => [
      id,
      {
        id,
        unitId: `unit-${id}`,
        title: `Advert ${id.slice(-1)}`,
        isActive: !(opts.paused ?? []).includes(id),
        paidUntil: opts.paidUntil ?? null,
        blockedAt: (opts.blocked ?? []).includes(id) ? new Date() : null,
      },
    ]),
  );

  const tx = {
    $executeRaw: jest.fn(async () => 1),
    rentalUnit: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, status: opts.unitStatus ?? 'VACANT' }))),
    },
    rentalListing: {
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => listings.get(id)).filter(Boolean)),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => listings.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const next = { ...listings.get(where.id), ...data };
        listings.set(where.id, next);
        return next;
      }),
    },
    rentalListingPayment: {
      findMany: jest.fn(async () => (payment && payment.status === 'PENDING' ? [payment] : [])),
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
      updateMany: jest.fn(async ({ where, data }: { where: { id?: string | { in: string[] }; status?: string }; data: Record<string, unknown> }) => {
        const idOk = !where.id || (typeof where.id === 'string' ? payment?.id === where.id : where.id.in.includes(String(payment?.id)));
        if (!payment || !idOk || (where.status && payment.status !== where.status)) return { count: 0 };
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
  return { service, tx, stkPush, listing: (id: string) => listings.get(id) as Record<string, unknown>, getPayment: () => payment };
}

const asTenant = <T>(fn: () => Promise<T>) => tenantContext.run({ organizationId: ORG, orgUserId: 'ou-1', role: Role.OWNER }, fn);
const paidCallback = (amount: number, over: Record<string, unknown> = {}) => ({ status: 'completed', merchant_request_id: 'req-1', amount, mpesa_receipt_number: 'QAB123', ...over });
const daysAhead = (d: unknown) => ((d as Date).getTime() - Date.now()) / DAY;

describe('RentalListingPaymentsService', () => {
  describe('pay - one advert', () => {
    it('sends an M-Pesa prompt for exactly KES 100 to the landlord’s number', async () => {
      const { service, stkPush } = build();
      await asTenant(() => service.pay([L1], '0712 345 678'));
      expect(stkPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 100, phone: '254712345678' }));
      const url = (stkPush.mock.calls[0] as unknown as [unknown, { callbackUrl: string }])[1].callbackUrl;
      expect(url).toContain(`/public/rental-listing-payments/${ORG}/${PAYMENT}/tuma-callback/${token()}`);
    });

    it('rejects a bad phone number without sending anything', async () => {
      const { service, stkPush } = build();
      await expect(asTenant(() => service.pay([L1], '123'))).rejects.toThrow(BadRequestException);
      expect(stkPush).not.toHaveBeenCalled();
    });

    it('refuses to charge for a unit that has been let', async () => {
      const { service, stkPush } = build({ unitStatus: 'OCCUPIED' });
      await expect(asTenant(() => service.pay([L1], '0712345678'))).rejects.toThrow(ConflictException);
      expect(stkPush).not.toHaveBeenCalled();
    });

    it('stops a second prompt within a minute', async () => {
      const { service } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await expect(asTenant(() => service.pay([L1], '0712345678'))).rejects.toThrow(/try again in a minute/);
    });

    it('records a failed prompt as FAILED and says why', async () => {
      const { service, stkPush, getPayment } = build();
      stkPush.mockRejectedValueOnce(new Error('Tuma is down'));
      await expect(asTenant(() => service.pay([L1], '0712345678'))).rejects.toThrow(/Tuma is down/);
      expect(getPayment()?.status).toBe('FAILED');
    });

    it('is unavailable until ZARODA’s Tuma account is set up', async () => {
      const { service } = build({ hasCredentials: false });
      await expect(asTenant(() => service.pay([L1], '0712345678'))).rejects.toThrow(/not available/);
    });
  });

  describe('pay - several adverts at once', () => {
    it('sends ONE prompt for KES 100 per advert', async () => {
      const { service, stkPush, getPayment } = build();
      const result = await asTenant(() => service.pay([L1, L2, L3], '0712345678'));
      expect(stkPush).toHaveBeenCalledTimes(1);
      expect(stkPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 300 }));
      expect(result.amount).toBe(300);
      expect(getPayment()?.listingIds).toEqual([L1, L2, L3]);
    });

    it('counts a repeated advert once', async () => {
      const { service, stkPush } = build();
      await asTenant(() => service.pay([L1, L1, L2], '0712345678'));
      expect(stkPush).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ amount: 200 }));
    });

    it('extends every advert it covers when the payment lands', async () => {
      const { service, listing } = build();
      await asTenant(() => service.pay([L1, L2], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(200));
      for (const id of [L1, L2]) {
        expect(listing(id).isActive).toBe(true);
        expect(daysAhead(listing(id).paidUntil)).toBeGreaterThan(29.9);
      }
      expect(listing(L3).paidUntil).toBeNull(); // not part of this payment
    });

    it('does not accept a bulk payment that covers only part of the total', async () => {
      const { service, listing, getPayment } = build();
      await asTenant(() => service.pay([L1, L2, L3], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(100));
      expect(getPayment()?.status).not.toBe('PAID');
      expect(listing(L1).paidUntil).toBeNull();
    });

    it('refuses the whole payment if any advert is taken down, paused or missing', async () => {
      await expect(asTenant(() => build({ blocked: [L2] }).service.pay([L1, L2], '0712345678'))).rejects.toThrow(/taken down/);
      await expect(asTenant(() => build({ paused: [L2] }).service.pay([L1, L2], '0712345678'))).rejects.toThrow(/paused/);
      await expect(asTenant(() => build().service.pay([L1, '99999999-9999-9999-9999-999999999999'], '0712345678'))).rejects.toThrow(NotFoundException);
    });

    it('refuses an empty list and an over-large one', async () => {
      const { service, stkPush } = build();
      await expect(asTenant(() => service.pay([], '0712345678'))).rejects.toThrow(/at least one/);
      const many = Array.from({ length: 31 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
      await expect(asTenant(() => service.pay(many, '0712345678'))).rejects.toThrow(/up to 30/);
      expect(stkPush).not.toHaveBeenCalled();
    });

    it('skips an advert that was taken down while the prompt was open, but extends the others', async () => {
      const { service, listing } = build();
      await asTenant(() => service.pay([L1, L2], '0712345678'));
      listing(L2).blockedAt = new Date(); // ZARODA takes L2 down before the PIN is entered
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(200));
      expect(daysAhead(listing(L1).paidUntil)).toBeGreaterThan(29.9);
      expect(listing(L2).paidUntil).toBeNull();
    });
  });

  describe('callback', () => {
    it('a genuine payment switches the advert on for 30 days', async () => {
      const { service, listing, getPayment } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(100));
      expect(getPayment()?.status).toBe('PAID');
      expect(getPayment()?.paymentReference).toBe('QAB123');
      expect(listing(L1).isActive).toBe(true);
      expect(daysAhead(listing(L1).paidUntil)).toBeGreaterThan(29.9);
      expect(daysAhead(listing(L1).paidUntil)).toBeLessThan(30.1);
    });

    it('paying early adds 30 days on top of the time left', async () => {
      const left = new Date(Date.now() + 10 * DAY);
      const { service, listing } = build({ paidUntil: left });
      await asTenant(() => service.pay([L1], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(100));
      expect((listing(L1).paidUntil as Date).getTime()).toBe(left.getTime() + 30 * DAY);
    });

    it('a repeated callback extends the advert only once', async () => {
      const { service, listing } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(100));
      const first = (listing(L1).paidUntil as Date).getTime();
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(100));
      expect((listing(L1).paidUntil as Date).getTime()).toBe(first);
    });

    it('rejects a forged address', async () => {
      const { service, getPayment } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await expect(service.handleTumaCallback(ORG, PAYMENT, 'not-the-token', paidCallback(100))).rejects.toThrow(NotFoundException);
      expect(getPayment()?.status).toBe('PENDING');
    });

    it('does not accept a payment for less than KES 100', async () => {
      const { service, listing, getPayment } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), paidCallback(20));
      expect(getPayment()?.status).not.toBe('PAID');
      expect(listing(L1).paidUntil).toBeNull();
    });

    it('a cancelled payment leaves the advert unpaid and can be retried', async () => {
      const { service, listing, getPayment } = build();
      await asTenant(() => service.pay([L1], '0712345678'));
      await service.handleTumaCallback(ORG, PAYMENT, token(), { status: 'failed', merchant_request_id: 'req-1', result_code: 1032 });
      expect(getPayment()?.status).toBe('FAILED');
      expect(listing(L1).paidUntil).toBeNull();
    });
  });
});
