import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HISTORY_SOURCES } from './product-archive.util';
import { ProductsService } from './products.service';

jest.mock('../common/tenant/tenant-context', () => ({
  getTenantStore: () => ({ organizationId: 'org-1' }),
}));

function setup(
  opts: {
    product?: unknown;
    history?: Record<string, number>;
    deleteError?: Error;
  } = {},
) {
  const product =
    opts.product === undefined
      ? { id: 'p1', name: 'Bread', isActive: true, variants: [{ id: 'v1' }] }
      : opts.product;
  const tx: Record<string, unknown> = {
    product: {
      findUnique: jest.fn().mockResolvedValue(product),
      update: jest.fn().mockResolvedValue({}),
      delete: opts.deleteError
        ? jest.fn().mockRejectedValue(opts.deleteError)
        : jest.fn().mockResolvedValue({}),
    },
  };
  for (const source of HISTORY_SOURCES) {
    tx[source.delegate] = tx[source.delegate] ?? { count: jest.fn() };
    (tx[source.delegate] as { count: jest.Mock }).count.mockImplementation(
      async () => opts.history?.[source.delegate] ?? 0,
    );
  }
  const tenantPrisma = {
    run: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  };
  const images = { keysForProduct: jest.fn().mockResolvedValue(['k1']) };
  const storage = { deleteMany: jest.fn() };
  const audit = { logInTx: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ProductsService(
    tenantPrisma as any,
    images as any,
    storage as any,
    audit as any,
  );
  return {
    service,
    tx: tx as { product: { update: jest.Mock; delete: jest.Mock } },
    storage,
    audit,
  };
}

describe('ProductsService.remove - archive or delete', () => {
  it('archives a product that has been sold (hidden, off the online shop, history kept) and does not delete it', async () => {
    const { service, tx, storage, audit } = setup({
      history: { saleLineItem: 3 },
    });
    expect(await service.remove('p1')).toEqual({ archived: true });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({
        isActive: false,
        onlineVisible: false,
        archivedAt: expect.any(Date),
      }),
    });
    expect(tx.product.delete).not.toHaveBeenCalled();
    expect(storage.deleteMany).toHaveBeenCalledWith([]);
    expect(audit.logInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'catalog.product_archived' }),
    );
  });

  it.each([
    'inventoryTransaction',
    'purchaseOrderLineItem',
    'recipeIngredient',
    'onlineOrderLine',
    'schoolOrderLine',
    'restaurantTabLine',
  ])('archives when it appears in %s', async (delegate) => {
    const { service } = setup({ history: { [delegate]: 1 } });
    expect(await service.remove('p1')).toEqual({ archived: true });
  });

  it('deletes a product with no history, and removes its photo files', async () => {
    const { service, tx, storage } = setup();
    expect(await service.remove('p1')).toEqual({ archived: false });
    expect(tx.product.delete).toHaveBeenCalledWith({ where: { id: 'p1' } });
    expect(tx.product.update).not.toHaveBeenCalled();
    expect(storage.deleteMany).toHaveBeenCalledWith(['k1']);
  });

  it('a product with no options at all has no history to protect and is deleted', async () => {
    const { service } = setup({
      product: { id: 'p1', name: 'Empty', variants: [] },
    });
    expect(await service.remove('p1')).toEqual({ archived: false });
  });

  it('archives instead of failing when something the list did not know about still points at it', async () => {
    const fk = new Prisma.PrismaClientKnownRequestError(
      'Foreign key constraint failed',
      { code: 'P2003', clientVersion: 'test' },
    );
    const { service, tx } = setup({ deleteError: fk });
    expect(await service.remove('p1')).toEqual({ archived: true });
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: expect.objectContaining({ isActive: false }),
    });
  });

  it('says not found for a product that is not there', async () => {
    await expect(
      setup({ product: null }).service.remove('nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ProductsService.restore', () => {
  it('brings an archived product back (but not back onto the online shop)', async () => {
    const { service, tx, audit } = setup({
      product: { id: 'p1', name: 'Bread', isActive: false },
    });
    await service.restore('p1');
    expect(tx.product.update).toHaveBeenCalledWith({
      where: { id: 'p1' },
      data: { isActive: true, archivedAt: null },
    });
    expect(audit.logInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'catalog.product_restored' }),
    );
  });

  it('does nothing to a product that is not archived', async () => {
    const { service, tx } = setup({
      product: { id: 'p1', name: 'Bread', isActive: true },
    });
    await service.restore('p1');
    expect(tx.product.update).not.toHaveBeenCalled();
  });
});
