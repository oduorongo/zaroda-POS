import { Prisma } from '@prisma/client';
import { deleteDecision, HISTORY_SOURCES } from './product-archive.util';

describe('deleteDecision', () => {
  it('archives when the product appears anywhere in the history, deletes when it never has', () => {
    expect(deleteDecision([])).toBe('DELETE');
    expect(deleteDecision([0, 0, 0])).toBe('DELETE');
    expect(deleteDecision([0, 3])).toBe('ARCHIVE');
    expect(deleteDecision([1])).toBe('ARCHIVE');
  });
});

describe('HISTORY_SOURCES', () => {
  const models = Prisma.dmmf.datamodel.models;
  const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

  it('only names models and columns that really exist, so a renamed table cannot silently stop counting', () => {
    for (const source of HISTORY_SOURCES) {
      const model = models.find((m) => lowerFirst(m.name) === source.delegate);
      expect(model).toBeDefined();
      expect(model!.fields.some((f) => f.name === source.field)).toBe(true);
    }
  });

  it('covers every table that points at a product option (except stock figures and settings that go with it)', () => {
    const pointing = models
      .filter((m) => m.name !== 'ProductVariant')
      .flatMap((m) =>
        m.fields
          .filter(
            (f) => f.type === 'ProductVariant' && f.relationFromFields?.length,
          )
          .map((f) => `${lowerFirst(m.name)}.${f.relationFromFields![0]}`),
      );
    const known = new Set(
      HISTORY_SOURCES.map((s) => `${s.delegate}.${s.field}`),
    );
    // these are removed together with the product (stock levels, alerts, which station a dish uses), so they are not history
    const goWithProduct = new Set([
      'inventoryItem.variantId',
      'lowStockAlert.variantId',
      'restaurantDish.variantId',
      // a remembered match between a supplier's product code and ours: only a memory, not a record of anything that happened
      'etimsSupplierItem.variantId',
    ]);
    const missing = pointing.filter(
      (p) => !known.has(p) && !goWithProduct.has(p),
    );
    expect(missing).toEqual([]);
  });
});
