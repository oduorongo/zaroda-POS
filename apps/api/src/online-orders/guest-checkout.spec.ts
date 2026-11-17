import { HttpException, NotFoundException } from '@nestjs/common';
import { FulfilmentType, OnlineOrderStatus } from '@prisma/client';
import { guestSecretMatches, parseGuestToken } from './guest-token';
import { OnlineOrdersService } from './online-orders.service';
import { sha256 } from './online-orders.util';

const ORG = '11111111-1111-1111-1111-111111111111';
const ORDER = '22222222-2222-2222-2222-222222222222';
const VARIANT = '44444444-4444-4444-4444-444444444444';

/* eslint-disable @typescript-eslint/no-explicit-any */
function setup(opts: { openGuestOrders?: number; order?: any } = {}) {
  const created: any[] = [];
  const tx: any = {
    $executeRaw: jest.fn(),
    branch: { findUnique: jest.fn().mockResolvedValue({ county: 'Kisumu' }) },
    productVariant: { findMany: jest.fn().mockResolvedValue([{ id: VARIANT, name: 'Default', sku: 'S1', price: 250, quantityMode: 'UNIT', product: { name: 'Sugar 1kg' } }]) },
    onlineOrder: {
      count: jest.fn().mockResolvedValue(opts.openGuestOrders ?? 0),
      create: jest.fn(({ data }) => {
        created.push(data);
        return Promise.resolve({ id: ORDER, ...data, lines: [] });
      }),
      findFirst: jest.fn().mockResolvedValue(opts.order ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...(opts.order ?? {}), status: OnlineOrderStatus.CANCELLED, lines: [] }),
    },
  };
  const shop = { organizationId: ORG, slug: 'mama', displayName: 'Mama Shop', fulfilmentBranchId: 'b1', pickupEnabled: true, deliveryEnabled: true, deliveryCounties: null, commissionRate: 0.03, onlineStockBuffer: 0 };
  const catalog = { runForShop: jest.fn((_slug: string, fn: any, _extra?: any) => fn(tx, shop)), availableQuantities: jest.fn().mockResolvedValue(new Map([[VARIANT, 10]])) };
  const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)), buyer: { findUnique: jest.fn(), update: jest.fn() } };
  const service = new OnlineOrdersService(prisma, {} as any, catalog as any, {} as any, {} as any, {} as any, {} as any, { get: () => undefined } as any);
  jest.spyOn(service as any, 'startPayment').mockImplementation((o: any) => Promise.resolve({ id: o.id, status: o.status ?? 'PENDING_PAYMENT' }));
  return { service, tx, created, prisma, catalog };
}

const order = { shopSlug: 'mama', lines: [{ variantId: VARIANT, quantity: 2 }], fulfilmentType: FulfilmentType.PICKUP, paymentPhone: '0712 345 678', buyerName: 'Akinyi' };

describe('guest checkout (no account)', () => {
  it('places the order with only a phone, keeps just the hash of the link secret, and returns the link once', async () => {
    const { service, created, prisma, catalog } = setup();
    const result: any = await service.createOrder(null, order);
    expect(prisma.buyer.findUnique).not.toHaveBeenCalled();
    expect(catalog.runForShop.mock.calls[0][2]).toBeUndefined();
    expect(created[0]).toMatchObject({ buyerId: null, buyerPhone: '254712345678', paymentPhone: '254712345678', buyerName: 'Akinyi', subtotal: 500 });
    const parsed = parseGuestToken(result.guestToken)!;
    expect(parsed.organizationId).toBe(ORG);
    expect(created[0].guestTokenHash).toBe(sha256(parsed.secret));
  });

  it('refuses a guest order with no valid M-Pesa number, and orders at a table', async () => {
    const { service } = setup();
    await expect(service.createOrder(null, { ...order, paymentPhone: undefined })).rejects.toThrow(/M-Pesa/);
    await expect(service.createOrder(null, { ...order, fulfilmentType: FulfilmentType.DINE_IN })).rejects.toThrow(/QR code/);
  });

  it('a number with 3 unpaid guest orders at the shop gets no more M-Pesa prompts for now', async () => {
    const { service, tx } = setup({ openGuestOrders: 3 });
    await expect(service.createOrder(null, order)).rejects.toBeInstanceOf(HttpException);
    expect(tx.onlineOrder.count.mock.calls[0][0].where).toMatchObject({ buyerId: null, buyerPhone: '254712345678', status: OnlineOrderStatus.PENDING_PAYMENT });
    expect(tx.onlineOrder.create).not.toHaveBeenCalled();
  });

  it('a guest can cancel an unpaid order only with its link secret', async () => {
    const secret = 'the-secret';
    const { service, tx } = setup({ order: { id: ORDER, organizationId: ORG, guestTokenHash: sha256(secret), lines: [] } });
    await expect(service.cancelForGuest(ORDER, `${ORG}.wrong`)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancelForGuest(ORDER, 'not-a-token')).rejects.toBeInstanceOf(NotFoundException);
    await service.cancelForGuest(ORDER, `${ORG}.${secret}`);
    expect(tx.onlineOrder.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: ORDER, status: OnlineOrderStatus.PENDING_PAYMENT }, data: { status: OnlineOrderStatus.CANCELLED } });
  });
});

describe('guest link secret', () => {
  it('needs a business id and a secret, and only the matching secret opens the order', () => {
    expect(parseGuestToken('abc')).toBeNull();
    expect(parseGuestToken(`${ORG}.`)).toBeNull();
    expect(guestSecretMatches(sha256('s'), 's')).toBe(true);
    expect(guestSecretMatches(sha256('s'), 't')).toBe(false);
    expect(guestSecretMatches(null, 's')).toBe(false);
  });
});
