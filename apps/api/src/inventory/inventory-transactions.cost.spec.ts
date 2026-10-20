import { BadRequestException } from '@nestjs/common';
import { InventoryTxnType } from '@prisma/client';
import { InventoryTransactionsService } from './inventory-transactions.service';

const BRANCH = '11111111-1111-1111-1111-111111111111';
const VARIANT = '22222222-2222-2222-2222-222222222222';

function setup(opts: { onHand?: number; cost?: number | null; mode?: 'COUNT' | 'WEIGHT' } = {}) {
  const order: string[] = [];
  const tx = {
    branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH }) },
    productVariant: {
      findUnique: jest.fn().mockResolvedValue({ id: VARIANT, sku: 'TOM-KG', quantityMode: opts.mode ?? 'WEIGHT', cost: opts.cost === undefined ? null : opts.cost }),
      update: jest.fn().mockImplementation(() => {
        order.push('cost updated');
        return Promise.resolve({});
      }),
    },
    batch: { findUnique: jest.fn() },
    inventoryItem: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { quantity: opts.onHand ?? 0 } }),
      upsert: jest.fn().mockImplementation(() => {
        order.push('stock increased');
        return Promise.resolve({ branchId: BRANCH, variantId: VARIANT, quantity: 0, lowStockThreshold: 0 });
      }),
    },
    inventoryTransaction: { create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 't1', ...data })) },
    lowStockAlert: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  };
  const events = { emitAsync: jest.fn().mockResolvedValue([]) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new InventoryTransactionsService({} as any, events as any);
  return { service, tx, order };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const receive = (s: ReturnType<typeof setup>, extra: Record<string, unknown>) => s.service.recordInTx(s.tx as any, { branchId: BRANCH, variantId: VARIANT, type: InventoryTxnType.ADJUSTMENT, quantityDelta: 20, ...extra });

describe('receiving stock with a price paid', () => {
  it('blends the price into the product cost by weight (10 kg at 80 + 20 kg at 110 = 100)', async () => {
    const s = setup({ onHand: 10, cost: 80 });
    await receive(s, { unitCost: 110 });
    expect(s.tx.productVariant.update).toHaveBeenCalledWith({ where: { id: VARIANT }, data: { cost: 100 } });
  });

  it('counts the stock in EVERY branch, since a product has one cost', async () => {
    const s = setup({ onHand: 10, cost: 80 });
    await receive(s, { unitCost: 110 });
    expect(s.tx.inventoryItem.aggregate.mock.calls[0][0].where).toEqual({ variantId: VARIANT });
  });

  it('weighs against the stock held BEFORE this delivery (the cost is updated before the stock goes up)', async () => {
    const s = setup({ onHand: 10, cost: 80 });
    await receive(s, { unitCost: 110 });
    expect(s.order).toEqual(['cost updated', 'stock increased']);
  });

  it('sets the cost outright the first time (no cost yet, or nothing in stock)', async () => {
    const first = setup({ onHand: 0, cost: null });
    await receive(first, { unitCost: 95.5 });
    expect(first.tx.productVariant.update).toHaveBeenCalledWith({ where: { id: VARIANT }, data: { cost: 95.5 } });
    const empty = setup({ onHand: 0, cost: 80 });
    await receive(empty, { unitCost: 120 });
    expect(empty.tx.productVariant.update).toHaveBeenCalledWith({ where: { id: VARIANT }, data: { cost: 120 } });
  });

  it('remembers what was paid on the stock movement itself', async () => {
    const s = setup({ onHand: 10, cost: 80 });
    await receive(s, { unitCost: 110 });
    expect(s.tx.inventoryTransaction.create.mock.calls[0][0].data.unitCost).toBe(110);
  });

  it('leaves the cost alone when no price is given', async () => {
    const s = setup({ onHand: 10, cost: 80 });
    await receive(s, {});
    expect(s.tx.productVariant.update).not.toHaveBeenCalled();
    expect(s.tx.inventoryItem.aggregate).not.toHaveBeenCalled();
  });

  it('refuses a price on anything but stock coming in', async () => {
    const out = setup({ onHand: 10, cost: 80 });
    await expect(receive(out, { quantityDelta: -2, unitCost: 110 })).rejects.toBeInstanceOf(BadRequestException);
    const sale = setup({ onHand: 10, cost: 80 });
    await expect(receive(sale, { type: InventoryTxnType.WASTE, quantityDelta: -2, unitCost: 110 })).rejects.toThrow(/only applies when stock is received/);
    const wrongType = setup({ onHand: 10, cost: 80 });
    await expect(receive(wrongType, { type: InventoryTxnType.TRANSFER, quantityDelta: 5, unitCost: 110 })).rejects.toBeInstanceOf(BadRequestException);
    expect(out.tx.productVariant.update).not.toHaveBeenCalled();
    expect(out.tx.inventoryTransaction.create).not.toHaveBeenCalled();
  });
});
