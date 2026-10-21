/** Barcodes are compared without regard to spaces or upper/lower case. */
export const sameCode = (a: string | null | undefined, b: string | null | undefined) =>
  Boolean(a && b) && a!.replace(/\s+/g, "").toLowerCase() === b!.replace(/\s+/g, "").toLowerCase();

/** The option a scanned code belongs to: its barcode, or failing that its product code (the same rule the till uses). */
export function findByCode<T extends { barcode?: string | null; sku: string }>(variants: T[], code: string): T | undefined {
  return variants.find((v) => sameCode(v.barcode, code)) ?? variants.find((v) => sameCode(v.sku, code));
}
