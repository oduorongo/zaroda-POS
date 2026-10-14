import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { OnlineOrderStatus } from '@prisma/client';
import { encryptSecret } from '../common/crypto/secret-box';
import { OnlineOrdersService, toOrderView } from './online-orders.service';
import { generateOrderNumber, normalizeKenyanPhone } from './online-orders.util';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const ORDER = '22222222-2222-2222-2222-222222222222';
const BUYER = '33333333-3333-3333-3333-333333333333';
const goodToken = createHmac('sha256', KEY).update(`tuma-callback:${ORDER}`).digest('base64url');

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    organizationId: ORG,
    buyerId: BUYER,
    orderNumber: 'ZR-ABC234',
    status: OnlineOrderStatus.PENDING_PAYMENT,
    amountDue: 500,
    tumaMerchantRequestId: 'mr-2',
    mpesaReceiptNumber: null,
    paymentDeadline: new Date(Date.now() + 60_000),
    subtotal: 500,
    commissionRate: 0.03,
    commissionAmount: null,
    lines: [],
    ...overrides,
  };
}

// What a complete, successful Tuma callback looks like.
const goodCallback = { merchant_request_id: 'mr-2', status: 'completed', amount: 500, mpesa_receipt_number: 'QAB1' };

type Confirmation =
  | { outcome: 'paid'; mpesaReceipt?: string }
  | { outcome: 'review'; detail: string }
  | { outcome: 'unconfirmed'; detail: string }
  | { outcome: 'unavailable'; detail: string };

function setup(
  order: Record<string, unknown> | null,
  confirmation: Confirmation = { outcome: 'paid', mpesaReceipt: 'QAB1' },
  storeOverrides: Record<string, unknown> = {},
) {
  const tx = {
    $executeRaw: jest.fn(),
    onlineOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ ...order, status: OnlineOrderStatus.PAID }),
      findFirst: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...order, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    onlineStore: {
      findUnique: jest.fn().mockResolvedValue({
        tumaEmail: 'shop@example.com',
        tumaApiKeyEncrypted: encryptSecret('shop-api-key', KEY),
        contactPhone: '0712345678',
        ...storeOverrides,
      }),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const tuma = { confirmPayment: jest.fn().mockResolvedValue(confirmation) };
  const daraja = { queryStk: jest.fn().mockResolvedValue({ outcome: 'unconfirmed', detail: 'no result yet' }), stkPush: jest.fn() };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
  const config = { get: jest.fn((k: string) => (k === 'SECRETS_ENCRYPTION_KEY' ? KEY.toString('base64') : undefined)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new OnlineOrdersService(
    prisma as any,
    tenantPrisma as any,
    {} as any,
    tuma as any,
    daraja as any,
    {} as any,
    sms as any,
    config as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, tuma, daraja, sms };
}

const settledWith = (tx: ReturnType<typeof setup>['tx']) => tx.onlineOrder.updateMany.mock.calls[0]?.[0]?.data;

describe("OnlineOrdersService.handleTumaCallback (Tuma's free webhook is how a payment is learned)", () => {
  it('rejects a callback without the right URL token and never touches Tuma', async () => {
    const { service, tuma, tx } = setup(baseOrder());
    await expect(service.handleTumaCallback(ORG, ORDER, 'forged-token', goodCallback)).rejects.toThrow(NotFoundException);
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('settles a complete callback straight away - and spends nothing on a paid status check', async () => {
    const { service, tx, tuma, sms } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, goodCallback);
    expect(settledWith(tx)).toMatchObject({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1', tumaMerchantRequestId: 'mr-2' });
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(sms.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+254712345678' }));
  });

  it('still honours a payment that completes after the order expired', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.EXPIRED }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, goodCallback);
    expect(settledWith(tx)).toMatchObject({ status: OnlineOrderStatus.PAID });
  });

  it('does not mark an underpaid order paid; it flags it for review', async () => {
    const { service, tx } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, { ...goodCallback, amount: 100 });
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/doesn't match/);
  });

  it('does not trust a "completed" callback that has no receipt: it asks Tuma instead (KES 1)', async () => {
    const { service, tx, tuma } = setup(baseOrder(), { outcome: 'paid', mpesaReceipt: 'FROMTUMA1' });
    const { mpesa_receipt_number: _r, ...noReceipt } = goodCallback;
    await service.handleTumaCallback(ORG, ORDER, goodToken, noReceipt);
    expect(tuma.confirmPayment).toHaveBeenCalledWith({ email: 'shop@example.com', apiKey: 'shop-api-key' }, 'mr-2', 500);
    expect(settledWith(tx)).toMatchObject({ mpesaReceiptNumber: 'FROMTUMA1' });
  });

  it('leaves the order unpaid when the check says Tuma has not been paid', async () => {
    const { service, tx } = setup(baseOrder(), { outcome: 'unconfirmed', detail: 'Tuma status: pending' });
    const { mpesa_receipt_number: _r, ...noReceipt } = goodCallback;
    await service.handleTumaCallback(ORG, ORDER, goodToken, noReceipt);
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not trust a callback for an earlier payment request: it checks the latest instead', async () => {
    const { service, tuma, tx } = setup(baseOrder({ tumaMerchantRequestId: 'mr-2' }), { outcome: 'unconfirmed', detail: 'pending' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { ...goodCallback, merchant_request_id: 'mr-1' });
    expect(tuma.confirmPayment).toHaveBeenCalledWith(expect.anything(), 'mr-2', 500);
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing for an order that is already paid', async () => {
    const { service, tuma, tx } = setup(baseOrder({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, goodCallback);
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not text the shop twice when two settlements race', async () => {
    const { service, tx, sms } = setup(baseOrder());
    tx.onlineOrder.updateMany.mockResolvedValue({ count: 0 }); // someone else got there first
    await service.handleTumaCallback(ORG, ORDER, goodToken, goodCallback);
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('records a reported failure for the current prompt so the buyer can retry', async () => {
    const { service, tx } = setup(baseOrder({ tumaMerchantRequestId: 'mr-2' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'failed' });
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/cancelled or failed/);
  });

  it('ignores a failure report for an earlier, superseded prompt', async () => {
    const { service, tx } = setup(baseOrder({ tumaMerchantRequestId: 'mr-2' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-1', status: 'failed' });
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
  });

  it('ignores a still-pending callback', async () => {
    const { service, tx, tuma } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'pending' });
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
  });
});

describe('the buyer\'s "I\'ve paid, check now" (a paid backup, so it is limited)', () => {
  it('asks Tuma once and settles when Tuma says paid', async () => {
    const { service, tuma, tx } = setup(baseOrder({ id: 'order-a' }), { outcome: 'paid', mpesaReceipt: 'QCHK1' });
    const result = await service.checkPaymentForBuyer(BUYER, 'order-a');
    expect(tuma.confirmPayment).toHaveBeenCalledTimes(1);
    expect(settledWith(tx)).toMatchObject({ mpesaReceiptNumber: 'QCHK1' });
    expect(result.checkResult).toBe('paid');
  });

  it('refuses to check again within the cooldown', async () => {
    const { service, tuma } = setup(baseOrder({ id: 'order-b' }), { outcome: 'unconfirmed', detail: 'pending' });
    const first = await service.checkPaymentForBuyer(BUYER, 'order-b');
    expect(first.checkResult).toBe('not-paid-yet');
    await expect(service.checkPaymentForBuyer(BUYER, 'order-b')).rejects.toThrow(/wait about 30 seconds/);
    expect(tuma.confirmPayment).toHaveBeenCalledTimes(1);
  });

  it('stops after the per-order cap so a shop cannot be billed endlessly', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-11-03T08:00:00Z'));
    try {
      const { service, tuma } = setup(baseOrder({ id: 'order-c' }), { outcome: 'unconfirmed', detail: 'pending' });
      for (let i = 0; i < 5; i++) {
        await service.checkPaymentForBuyer(BUYER, 'order-c');
        jest.setSystemTime(new Date(Date.now() + 31_000));
      }
      await expect(service.checkPaymentForBuyer(BUYER, 'order-c')).rejects.toThrow(/checked several times/);
      expect(tuma.confirmPayment).toHaveBeenCalledTimes(5);
    } finally {
      jest.useRealTimers();
    }
  });

  it('says so, and tells the shop, when Tuma cannot answer (for example no credits)', async () => {
    const { service, tx } = setup(baseOrder({ id: 'order-d' }), { outcome: 'unavailable', detail: 'no credits' });
    const result = await service.checkPaymentForBuyer(BUYER, 'order-d');
    expect(result.checkResult).toBe('unavailable');
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/could not confirm the payment with Tuma/);
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not call Tuma for an order that is not waiting for payment', async () => {
    const { service, tuma } = setup(baseOrder({ id: 'order-e', status: OnlineOrderStatus.PAID }));
    const result = await service.checkPaymentForBuyer(BUYER, 'order-e');
    expect(result.checkResult).toBe('not-needed');
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
  });
});

describe('the shop marking an order as paid by hand', () => {
  it('records the M-Pesa code and releases the order', async () => {
    const { service, tx } = setup(baseOrder());
    await service.confirmPaymentByBusiness(ORDER, ' sjk1abc2de ');
    expect(settledWith(tx)).toMatchObject({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'SJK1ABC2DE' });
  });

  it('refuses an order that is not waiting for payment', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.COMPLETED }));
    tx.onlineOrder.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.confirmPaymentByBusiness(ORDER, 'SJK1ABC2DE')).rejects.toThrow(BadRequestException);
  });

  it('refuses an M-Pesa code already attached to another order', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const { service, tx } = setup(baseOrder());
    tx.onlineOrder.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
    await expect(service.confirmPaymentByBusiness(ORDER, 'SJK1ABC2DE')).rejects.toThrow(ConflictException);
  });
});

describe('toOrderView', () => {
  it('shows an unpaid order past its deadline as EXPIRED', () => {
    const order = baseOrder({ paymentDeadline: new Date(Date.now() - 1000) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(toOrderView(order as any).status).toBe(OnlineOrderStatus.EXPIRED);
  });
});

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '254712345678'],
    ['0712 345 678', '254712345678'],
    ['+254712345678', '254712345678'],
    ['254112345678', '254112345678'],
    ['712345678', '254712345678'],
  ])('normalizes %p', (input, expected) => {
    expect(normalizeKenyanPhone(input)).toBe(expected);
  });

  it.each(['0812345678', '12345', '+1 415 555 0100', '07123456789'])('rejects %p', (input) => {
    expect(normalizeKenyanPhone(input)).toBeNull();
  });
});

describe('generateOrderNumber', () => {
  it('uses only unambiguous characters', () => {
    for (let i = 0; i < 200; i++) expect(generateOrderNumber()).toMatch(/^ZR-[2-9A-HJ-NP-Z]{6}$/);
  });
});

// A shop collecting through its OWN M-Pesa (Safaricom Daraja) instead of Tuma.
const darajaStore = {
  paymentGateway: 'DARAJA',
  tumaEmail: null,
  tumaApiKeyEncrypted: null,
  mpesaAccountType: 'PAYBILL',
  mpesaShortcode: '174379',
  mpesaConsumerKeyEncrypted: encryptSecret('consumer-key-1234', KEY),
  mpesaConsumerSecretEncrypted: encryptSecret('consumer-secret-1234', KEY),
  mpesaPasskeyEncrypted: encryptSecret('passkey-passkey-passkey-1234', KEY),
  mpesaEnvironment: 'sandbox',
};

const darajaCallback = (overrides: { code?: number; amount?: number; receipt?: string | null; id?: string } = {}) => ({
  Body: {
    stkCallback: {
      MerchantRequestID: 'm-1',
      CheckoutRequestID: overrides.id ?? 'ws_CO_2',
      ResultCode: overrides.code ?? 0,
      ResultDesc: 'The service request is processed successfully.',
      ...(overrides.code && overrides.code !== 0
        ? {}
        : {
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: overrides.amount ?? 500 },
                ...(overrides.receipt === null ? [] : [{ Name: 'MpesaReceiptNumber', Value: overrides.receipt ?? 'SDA1B2C3D4' }]),
                { Name: 'PhoneNumber', Value: 254712345678 },
              ],
            },
          }),
    },
  },
});

describe("OnlineOrdersService.handleDarajaCallback (a shop's own M-Pesa)", () => {
  const order = () => baseOrder({ tumaMerchantRequestId: 'ws_CO_2' });

  it('rejects a callback without the right URL token and never asks Safaricom', async () => {
    const { service, daraja, tx } = setup(order(), undefined, darajaStore);
    await expect(service.handleDarajaCallback(ORG, ORDER, 'forged-token', darajaCallback())).rejects.toThrow(NotFoundException);
    expect(daraja.queryStk).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('settles a complete success callback with its receipt, and acknowledges Safaricom', async () => {
    const { service, tx, daraja } = setup(order(), undefined, darajaStore);
    const reply = await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback());
    expect(reply).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    expect(settledWith(tx)).toMatchObject({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'SDA1B2C3D4', tumaMerchantRequestId: 'ws_CO_2' });
    expect(daraja.queryStk).not.toHaveBeenCalled();
  });

  it('flags a cancelled prompt in plain words and settles nothing', async () => {
    const { service, tx } = setup(order(), undefined, darajaStore);
    await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback({ code: 1032 }));
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.onlineOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastPaymentError: expect.stringContaining('cancelled') } }));
  });

  it('does not settle a payment for less than the order, and flags it for review', async () => {
    const { service, tx } = setup(order(), undefined, darajaStore);
    await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback({ amount: 100 }));
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.onlineOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: { lastPaymentError: expect.stringContaining("doesn't match") } }));
  });

  it('asks Safaricom (free) when the callback has no receipt, and settles only if Safaricom confirms', async () => {
    const { service, tx, daraja } = setup(order(), undefined, darajaStore);
    daraja.queryStk.mockResolvedValue({ outcome: 'paid' });
    await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback({ receipt: null }));
    expect(daraja.queryStk).toHaveBeenCalledTimes(1);
    expect(settledWith(tx)).toMatchObject({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'DARAJA:ws_CO_2' });
  });

  it('leaves the order waiting when Safaricom cannot confirm', async () => {
    const { service, tx, daraja } = setup(order(), undefined, darajaStore);
    daraja.queryStk.mockResolvedValue({ outcome: 'unconfirmed', detail: 'no result yet' });
    await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback({ receipt: null }));
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('ignores a callback for an order that is already settled', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.PAID }), undefined, darajaStore);
    await service.handleDarajaCallback(ORG, ORDER, goodToken, darajaCallback());
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });
});
