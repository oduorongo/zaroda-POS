import { createHmac, randomBytes } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { OnlineOrderStatus } from '@prisma/client';
import { encryptSecret } from '../common/crypto/secret-box';
import { OnlineOrdersService, toOrderView } from './online-orders.service';
import { generateOrderNumber, normalizeKenyanPhone } from './online-orders.util';

const KEY = randomBytes(32);
const ORG = '11111111-1111-1111-1111-111111111111';
const ORDER = '22222222-2222-2222-2222-222222222222';
const goodToken = createHmac('sha256', KEY).update(`tuma-callback:${ORDER}`).digest('base64url');

function baseOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: ORDER,
    organizationId: ORG,
    orderNumber: 'ZR-ABC234',
    status: OnlineOrderStatus.PENDING_PAYMENT,
    amountDue: 500,
    tumaMerchantRequestId: 'mr-2',
    mpesaReceiptNumber: null,
    paymentDeadline: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

type Confirmation = { outcome: 'paid'; mpesaReceipt?: string } | { outcome: 'review'; detail: string } | { outcome: 'unconfirmed'; detail: string };

function setup(order: Record<string, unknown> | null, confirmation: Confirmation = { outcome: 'paid', mpesaReceipt: 'QAB1' }) {
  const tx = {
    $executeRaw: jest.fn(),
    onlineOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...order, ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    onlineStore: {
      findUnique: jest.fn().mockResolvedValue({
        tumaEmail: 'shop@example.com',
        tumaApiKeyEncrypted: encryptSecret('shop-api-key', KEY),
        contactPhone: '0712345678',
      }),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const tuma = { confirmPayment: jest.fn().mockResolvedValue(confirmation) };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
  const config = { get: jest.fn((k: string) => (k === 'SECRETS_ENCRYPTION_KEY' ? KEY.toString('base64') : undefined)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new OnlineOrdersService(
    prisma as any,
    {} as any,
    {} as any,
    tuma as any,
    {} as any,
    sms as any,
    config as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, tuma, sms };
}

describe('OnlineOrdersService.handleTumaCallback (Tuma decides, the callback only prompts)', () => {
  it('rejects a callback without the right URL token and never asks Tuma', async () => {
    const { service, tuma, tx } = setup(baseOrder());
    await expect(service.handleTumaCallback(ORG, ORDER, 'forged-token', { status: 'completed' })).rejects.toThrow(NotFoundException);
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it("marks the order paid only because Tuma confirmed it, using the shop's own credentials", async () => {
    const { service, tx, tuma, sms } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'completed' });
    expect(tuma.confirmPayment).toHaveBeenCalledWith({ email: 'shop@example.com', apiKey: 'shop-api-key' }, 'mr-2', 500);
    expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1' }) }),
    );
    expect(sms.sendSms).toHaveBeenCalled();
  });

  it('ignores a callback that CLAIMS success when Tuma does not confirm it', async () => {
    const { service, tx, sms } = setup(baseOrder(), { outcome: 'unconfirmed', detail: 'Tuma status: pending' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'completed', amount: 500, mpesa_receipt_number: 'FAKE' });
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('still honours a payment Tuma confirms after the order expired', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.EXPIRED }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed' });
    expect(tx.onlineOrder.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OnlineOrderStatus.PAID }) }),
    );
  });

  it('falls back to the request id as the receipt when Tuma gives none (still unique per payment)', async () => {
    const { service, tx } = setup(baseOrder(), { outcome: 'paid' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'completed' });
    expect(tx.onlineOrder.updateMany.mock.calls[0][0].data.mpesaReceiptNumber).toBe('TUMA:mr-2');
  });

  it('flags a payment for the wrong amount for review instead of marking it paid', async () => {
    const { service, tx } = setup(baseOrder(), { outcome: 'review', detail: 'Tuma reported KES 100, expected KES 500' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed' });
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/doesn't match/);
  });

  it('does nothing for an order that is already paid', async () => {
    const { service, tuma, tx } = setup(baseOrder({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed' });
    expect(tuma.confirmPayment).not.toHaveBeenCalled();
    expect(tx.onlineOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not text the shop twice when two settlements race', async () => {
    const { service, tx, sms } = setup(baseOrder());
    tx.onlineOrder.updateMany.mockResolvedValue({ count: 0 }); // someone else got there first
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed' });
    expect(sms.sendSms).not.toHaveBeenCalled();
  });

  it('records a reported failure for the current prompt so the buyer can retry', async () => {
    const { service, tx } = setup(baseOrder({ tumaMerchantRequestId: 'mr-2' }), { outcome: 'unconfirmed', detail: 'failed' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-2', status: 'failed' });
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/cancelled or failed/);
  });

  it('ignores a failure report for an earlier, superseded prompt', async () => {
    const { service, tx } = setup(baseOrder({ tumaMerchantRequestId: 'mr-2' }), { outcome: 'unconfirmed', detail: 'failed' });
    await service.handleTumaCallback(ORG, ORDER, goodToken, { merchant_request_id: 'mr-1', status: 'failed' });
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
  });
});

describe('toOrderView', () => {
  it('shows an unpaid order past its deadline as EXPIRED', () => {
    const order = {
      ...baseOrder({ paymentDeadline: new Date(Date.now() - 1000) }),
      subtotal: 500,
      commissionRate: 0.03,
      commissionAmount: null,
      lines: [],
    };
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
