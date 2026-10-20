import { PurchaseOrdersService } from './purchase-orders.service';

const ORDER = 'o1';
const BRANCH = 'b1';

function setup(lineUnitCost: number | null) {
  const line = { id: 'l1', variantId: 'v1', quantityOrdered: 50, quantityReceived: 0, unitCost: lineUnitCost, variant: { sku: 'RICE-KG', quantityMode: 'WEIGHT' } };
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
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  const inventory = { recordInTx: jest.fn().mockResolvedValue({}) };
  const audit = { logInTx: jest.fn().mockResolvedValue(undefined) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new PurchaseOrdersService(tenantPrisma as any, inventory as any, audit as any);
  return { service, inventory };
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
