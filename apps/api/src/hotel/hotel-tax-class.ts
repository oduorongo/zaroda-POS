import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { combinedRate, TaxLine } from './tax.util';

/** The tax class the room products carry while the hotel has set its own room taxes (its rate is all of them together). */
export const MANAGED_TAX_CLASS_NAME = 'Hotel room tax';

/** The taxes and levies the hotel has switched on, in the order it set them. */
export async function activeTaxLines(tx: TenantTx): Promise<TaxLine[]> {
  const rows = await tx.hotelTax.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => ({ name: r.name, percent: Number(r.percent) }));
}

/**
 * Makes sure there is a "Hotel room tax" tax class whose rate is the hotel's room taxes added together, and returns its id (or null
 * when the hotel has set no taxes). A sale takes its tax from the product's tax class, so this is how several named taxes reach the
 * settlement sale as one correct total, while the folio still shows each by name.
 */
export async function syncManagedTaxClass(
  tx: TenantTx,
  organizationId: string,
): Promise<string | null> {
  const lines = await activeTaxLines(tx);
  if (lines.length === 0) return null;
  const rate = combinedRate(lines);
  const existing = await tx.taxClass.findFirst({
    where: { name: MANAGED_TAX_CLASS_NAME },
  });
  if (existing) {
    if (Number(existing.rate) !== rate || existing.isExempt)
      await tx.taxClass.update({
        where: { id: existing.id },
        data: { rate, isExempt: false },
      });
    return existing.id;
  }
  return (
    await tx.taxClass.create({
      data: {
        organizationId,
        name: MANAGED_TAX_CLASS_NAME,
        rate,
        isExempt: false,
      },
    })
  ).id;
}

/** Puts the managed tax class on every room product (called when the hotel's taxes change, and when a room product is made). */
export async function applyManagedTaxClass(
  tx: TenantTx,
  organizationId: string,
): Promise<void> {
  const id = await syncManagedTaxClass(tx, organizationId);
  if (!id) return;
  await tx.product.updateMany({
    where: { variants: { some: { hotelRoomType: { isNot: null } } } },
    data: { taxClassId: id },
  });
}
