import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProductVariantsService } from './product-variants.service';
import { isValidEan13 } from './barcode.util';

const PRODUCT = 'p1';
const VARIANT = 'v1';

function setup(opts: { skuClash?: Record<string, unknown> | null; clash?: Record<string, unknown> | null; variant?: Record<string, unknown> | null; takenCodes?: number } = {}) {
  let taken = opts.takenCodes ?? 0;
  const tx = {
    product: { findUnique: jest.fn().mockResolvedValue({ id: PRODUCT }) },
    productVariant: {
      findFirst: jest.fn().mockImplementation(({ where }) => {
        // is this product code already somebody's barcode? (only a `barcode` filter, no OR)
        if (where?.barcode && !where?.OR) return Promise.resolve(opts.skuClash ?? null);
        // the clash check (has an `OR` on barcode and sku) vs. the "is this generated code taken" check
        if (where?.OR) {
          if (taken > 0 && where.OR[0]?.barcode && typeof where.OR[0].barcode === 'string') {
            taken--;
            return Promise.resolve({ id: 'someone' });
          }
          return Promise.resolve(opts.clash ?? null);
        }
        return Promise.resolve({ id: VARIANT, productId: PRODUCT });
      }),
      findUnique: jest.fn().mockResolvedValue('variant' in opts ? opts.variant : { id: VARIANT, barcode: null }),
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'new', ...data })),
      update: jest.fn().mockImplementation(({ where, data }) => Promise.resolve({ id: where?.id ?? VARIANT, ...data })),
    },
  };
  const tenantPrisma = { run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { service: new ProductVariantsService(tenantPrisma as any), tx };
}

const dto = { sku: 'BR-S', price: 60 };

describe('a barcode on a product option', () => {
  it('is saved tidied (spaces removed) when it is free', async () => {
    const { service, tx } = setup();
    await service.create(PRODUCT, { ...dto, barcode: ' 6161 1100 00123 ' });
    expect(tx.productVariant.create.mock.calls[0][0].data.barcode).toBe('6161110000123');
  });

  it('refuses a barcode another option already has, naming that option', async () => {
    const { service, tx } = setup({ clash: { id: 'other', sku: 'SODA-500', name: null, product: { name: 'Soda 500ml' } } });
    const attempt = service.create(PRODUCT, { ...dto, barcode: '6161110000123' });
    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toThrow(/already used by Soda 500ml \(SODA-500\)/);
    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('checks against barcodes AND product codes, ignoring upper/lower case', async () => {
    const { service, tx } = setup();
    await service.create(PRODUCT, { ...dto, barcode: 'abc123' });
    const where = tx.productVariant.findFirst.mock.calls.map((c) => c[0].where).find((w) => w?.OR);
    expect(where.OR).toEqual([{ barcode: { equals: 'abc123', mode: 'insensitive' } }, { sku: { equals: 'abc123', mode: 'insensitive' } }]);
  });

  it('lets an option keep its own barcode when it is edited (it does not clash with itself)', async () => {
    const { service, tx } = setup();
    await service.update(PRODUCT, VARIANT, { barcode: '6161110000123', price: 70 });
    expect(tx.productVariant.findFirst.mock.calls.at(-1)?.[0].where.id).toEqual({ not: VARIANT });
  });

  it('can be removed by sending a blank', async () => {
    const { service, tx } = setup();
    await service.update(PRODUCT, VARIANT, { barcode: '  ' });
    expect(tx.productVariant.update.mock.calls[0][0].data.barcode).toBeNull();
  });

  it('is left alone when an edit says nothing about it', async () => {
    const { service, tx } = setup();
    await service.update(PRODUCT, VARIANT, { price: 70 });
    expect(tx.productVariant.update.mock.calls[0][0].data.barcode).toBeUndefined();
    expect(tx.productVariant.findFirst.mock.calls.some((c) => c[0].where?.OR)).toBe(false);
  });

  it('refuses a product code that is already the barcode of another option', async () => {
    const { service, tx } = setup({ skuClash: { id: 'other', sku: 'SODA-500', name: null, product: { name: 'Soda 500ml' } } });
    await expect(service.create(PRODUCT, { sku: '6161110000123', price: 10 })).rejects.toThrow(/already the barcode of Soda 500ml/);
    expect(tx.productVariant.create).not.toHaveBeenCalled();
  });

  it('refuses characters a barcode cannot have', async () => {
    const { service } = setup();
    await expect(service.create(PRODUCT, { ...dto, barcode: '12$34' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('making a barcode of the shop\'s own', () => {
  it('gives an option without one a valid in-store EAN-13', async () => {
    const { service, tx } = setup();
    const done = await service.generateBarcode(PRODUCT, VARIANT);
    const code = tx.productVariant.update.mock.calls[0][0].data.barcode as string;
    expect(code).toMatch(/^2\d{12}$/);
    expect(isValidEan13(code)).toBe(true);
    expect(done.barcode).toBe(code);
  });

  it('returns the option as it is when it already has one (the same code every time)', async () => {
    const { service, tx } = setup({ variant: { id: VARIANT, barcode: '6161110000123' } });
    const done = await service.generateBarcode(PRODUCT, VARIANT);
    expect(done.barcode).toBe('6161110000123');
    expect(tx.productVariant.update).not.toHaveBeenCalled();
  });

  it('tries again when the code it made happens to be taken', async () => {
    const { service, tx } = setup({ takenCodes: 2 });
    await service.generateBarcode(PRODUCT, VARIANT);
    expect(tx.productVariant.update).toHaveBeenCalledTimes(1);
  });

  it('makes them for many options at once, leaving ones that have a barcode alone', async () => {
    const { service, tx } = setup();
    tx.productVariant.findUnique.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, barcode: where.id === 'has' ? '5901234123457' : null }));
    const done = await service.generateBarcodes(['a', 'b', 'has', 'a']);
    expect(done.map((v) => v.id)).toEqual(['a', 'b', 'has']);
    expect(tx.productVariant.update).toHaveBeenCalledTimes(2);
    expect(done[2].barcode).toBe('5901234123457');
  });
});
