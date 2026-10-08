import { createHmac, randomBytes } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { OnlineOrderStatus } from '@prisma/client';
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
    tumaPaymentId: 'pay-2',
    mpesaReceiptNumber: null,
    paymentDeadline: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function setup(order: Record<string, unknown> | null) {
  const tx = {
    $executeRaw: jest.fn(),
    onlineOrder: {
      findUnique: jest.fn().mockResolvedValue(order),
      update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...order, ...data })),
    },
    onlineStore: { findUnique: jest.fn().mockResolvedValue({ contactPhone: '0712345678' }) },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const sms = { sendSms: jest.fn().mockResolvedValue({ sent: true }) };
  const config = { get: jest.fn((k: string) => (k === 'SECRETS_ENCRYPTION_KEY' ? KEY.toString('base64') : undefined)) };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const service = new OnlineOrdersService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    sms as any,
    config as any,
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { service, tx, sms };
}

describe('OnlineOrdersService.handleTumaCallback', () => {
  it('rejects a callback without the right URL token', async () => {
    const { service, tx } = setup(baseOrder());
    await expect(
      service.handleTumaCallback(ORG, ORDER, 'forged-token', { status: 'completed', amount: 500, mpesa_receipt_number: 'QAB1' }),
    ).rejects.toThrow(NotFoundException);
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
  });

  it('marks the order paid on a full, receipted payment and texts the shop', async () => {
    const { service, tx, sms } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, {
      status: 'completed',
      amount: 500,
      payment_id: 'pay-2',
      mpesa_receipt_number: 'QAB1',
    });
    expect(tx.onlineOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1' }) }),
    );
    expect(sms.sendSms).toHaveBeenCalled();
  });

  it('still honours a payment that completes after the order expired', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.EXPIRED }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed', amount: 500, mpesa_receipt_number: 'QAB1' });
    expect(tx.onlineOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: OnlineOrderStatus.PAID }) }),
    );
  });

  it('does not mark an underpaid order paid', async () => {
    const { service, tx } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed', amount: 100, mpesa_receipt_number: 'QAB1' });
    const data = tx.onlineOrder.update.mock.calls[0][0].data;
    expect(data.status).toBeUndefined();
    expect(data.lastPaymentError).toMatch(/could not be matched/);
  });

  it('does not mark paid without an M-Pesa receipt', async () => {
    const { service, tx } = setup(baseOrder());
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed', amount: 500 });
    expect(tx.onlineOrder.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('ignores a duplicate delivery of the same payment', async () => {
    const { service, tx } = setup(baseOrder({ status: OnlineOrderStatus.PAID, mpesaReceiptNumber: 'QAB1' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'completed', amount: 500, mpesa_receipt_number: 'QAB1' });
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
  });

  it('ignores a failure report for an earlier, superseded prompt', async () => {
    const { service, tx } = setup(baseOrder({ tumaPaymentId: 'pay-2' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'failed', payment_id: 'pay-1' });
    expect(tx.onlineOrder.update).not.toHaveBeenCalled();
  });

  it('records a failure for the current prompt so the buyer can retry', async () => {
    const { service, tx } = setup(baseOrder({ tumaPaymentId: 'pay-2' }));
    await service.handleTumaCallback(ORG, ORDER, goodToken, { status: 'failed', payment_id: 'pay-2' });
    expect(tx.onlineOrder.update.mock.calls[0][0].data.lastPaymentError).toMatch(/cancelled or failed/);
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
