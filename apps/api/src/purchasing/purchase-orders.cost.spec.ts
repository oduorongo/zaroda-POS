import { Role } from '@prisma/client';
import { tenantContext } from '../common/tenant/tenant-context';
import { GoodsReceiptsService } from './goods-receipts.service';
import { PurchaseOrdersService } from './purchase-orders.service';

const ORDER = 'o1';
const BRANCH = 'b1';

function setup(lineUnitCost: number | null) {
  const line = { id: 'l1', variantId: 'v1', quantityOrdered: 50, quantityReceived: 0, unitCost: lineUnitCost, variant: { sku: 'RICE-KG', quantityMode: 'WEIGHT', cost: 90 } };
  const tx = {
    purchaseOrder: {
      findUnique: jest.fn().mockResolvedValue({ id: ORDER, branchId: BRANCH, status: 'ORDERED', lineItems: [line] }),
      update: jest.fn().mockResolvedValue({}),
    },
    purchaseOrderLineItem: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([{ ...line, quantityReceived: 20 }]),
    },
    batch: { create: jest.fn().mockResolvedValue({ id: 'batch1' }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(1),
    branch: { findUnique: jest.fn().mockResolvedValue({ id: BRANCH }) },
    supplier: { findUnique: jest.fn().mockResolvedValue(null) },
    goodsReceipt: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'r1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r1', receiptNumber: 'GRN-2026-0001', createdAt: new Date(), deliveryNote: null, notes: null, branch: null, supplier: null, purchaseOrder: null, bills: [], lines: [] }),
    },
    goodsReceiptLine: { create: jest.fn().mockResolvedValue({}) },
    productVariant: { findUniqueOrThrow: jest.fn().mockResolvedValue({ sku: 'RICE-KG', name: null, price: 200, cost: 95, product: { name: 'Rice' } }) },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const inventory = { recordInTx: jest.fn().mockResolvedValue({}) };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const receipts = new GoodsReceiptsService(tenantPrisma as any, inventory as any, audit as any);
  const orders = new PurchaseOrdersService(tenantPrisma as any, inventory as any, audit as any, receipts);
  const service = { receive: (id: string, dto: Parameters<PurchaseOrdersService['receive']>[1]) => tenantContext.run({ organizationId: 'org', orgUserId: 'u1', role: Role.OWNER }, () => orders.receive(id, dto)) };
  return { service, inventory, tx };
}

describe('receiving a purchase order with a price', () => {
  it('uses the price agreed on the order when none is given', async () => {
    const { service, inventory } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20 }] });
    expect(inventory.recordInTx.mock.calls[0][1]).toMatchObject({ branchId: BRANCH, variantId: 'v1', quantityDelta: 20, unitCost: 95 });
  });

  it('uses what was actually charged when the delivery says so', async () => {
    const { service, inventory } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20, unitCost: 102.5 }] });
    expect(inventory.recordInTx.mock.calls[0][1].unitCost).toBe(102.5);
  });

  it('records no price (and so leaves the product cost alone) when neither the order nor the delivery has one', async () => {
    const { service, inventory } = setup(null);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20 }] });
    expect(inventory.recordInTx.mock.calls[0][1].unitCost).toBeUndefined();
  });

  it('passes the price on for batch-tracked receipts too', async () => {
    const { service, inventory } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20, batchNumber: 'B-1' }] });
    expect(inventory.recordInTx.mock.calls[0][1]).toMatchObject({ batchId: 'batch1', unitCost: 95 });
  });
});

describe('receiving records a goods-received note', () => {
  it('stock goes in as a RECEIPT (not an adjustment) pointing at the note', async () => {
    const { service, inventory } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20 }] });
    expect(inventory.recordInTx.mock.calls[0][1]).toMatchObject({ type: 'RECEIPT', referenceId: 'r1' });
  });

  it('damaged goods are written on the note but never go into stock', async () => {
    const { service, inventory, tx } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 15, damaged: 5, damagedNote: 'Bags torn' }] });
    expect(inventory.recordInTx.mock.calls[0][1].quantityDelta).toBe(15);
    expect(tx.goodsReceiptLine.create.mock.calls[0][0].data).toMatchObject({ quantityAccepted: 15, quantityDamaged: 5, damagedNote: 'Bags torn' });
  });

  it('a line that was all damaged adds no stock but is still recorded', async () => {
    const { service, inventory, tx } = setup(95);
    await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 0, damaged: 10 }] });
    expect(inventory.recordInTx).not.toHaveBeenCalled();
    expect(tx.goodsReceiptLine.create).toHaveBeenCalled();
  });

  it('more than is outstanding is refused', async () => {
    const { service, inventory } = setup(95);
    await expect(service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 51 }] })).rejects.toThrow(/only 50 outstanding/);
    expect(inventory.recordInTx).not.toHaveBeenCalled();
  });

  it('the same order line twice in one delivery is refused', async () => {
    const { service } = setup(95);
    await expect(service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 5 }, { lineItemId: 'l1', quantity: 5 }] })).rejects.toThrow(/listed twice/);
  });

  it('warns when the new cost leaves too thin a margin (cost 195 on a price of 200)', async () => {
    const { service, tx } = setup(195);
    tx.productVariant.findUniqueOrThrow.mockResolvedValue({ sku: 'RICE-KG', name: null, price: 200, cost: 195, product: { name: 'Rice' } });
    const r = (await service.receive(ORDER, { lines: [{ lineItemId: 'l1', quantity: 20 }] })) as { warnings: { reason: string }[] };
    expect(r.warnings[0].reason).toBe('BELOW_MINIMUM');
  });
});
