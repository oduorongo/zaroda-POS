/**
 * Where a product's options can turn up once the business has used them: sales, stock movements, purchase orders, recipes,
 * online orders, bills, invoices and so on. A product that appears in any of these is archived instead of deleted, so history
 * (and the reports built on it) never loses what was sold. Each entry is a Prisma model delegate and the column that points at a
 * product option.
 */
export const HISTORY_SOURCES: { delegate: string; field: string }[] = [
  { delegate: 'saleLineItem', field: 'variantId' },
  { delegate: 'saleLineItemIngredient', field: 'ingredientVariantId' },
  { delegate: 'inventoryTransaction', field: 'variantId' },
  { delegate: 'batch', field: 'variantId' },
  { delegate: 'stockTransfer', field: 'variantId' },
  { delegate: 'stockTakeLine', field: 'variantId' },
  { delegate: 'purchaseOrderLineItem', field: 'variantId' },
  { delegate: 'recipeIngredient', field: 'variantId' },
  { delegate: 'recipeIngredient', field: 'ingredientVariantId' },
  { delegate: 'repackaging', field: 'fromVariantId' },
  { delegate: 'repackaging', field: 'toVariantId' },
  { delegate: 'productionOrder', field: 'variantId' },
  { delegate: 'wasteLog', field: 'variantId' },
  { delegate: 'wasteIngredient', field: 'ingredientVariantId' },
  { delegate: 'layawayLineItem', field: 'variantId' },
  { delegate: 'onlineOrderLine', field: 'variantId' },
  { delegate: 'kitchenTicketLine', field: 'variantId' },
  { delegate: 'restaurantTabLine', field: 'variantId' },
  { delegate: 'schoolOrderLine', field: 'variantId' },
  { delegate: 'supplierInvoiceLine', field: 'variantId' },
  { delegate: 'hotelRoomType', field: 'variantId' },
];

/** Archive when the product appears anywhere in the business's history; delete only when it never has. */
export function deleteDecision(counts: number[]): 'ARCHIVE' | 'DELETE' {
  return counts.some((n) => n > 0) ? 'ARCHIVE' : 'DELETE';
}
