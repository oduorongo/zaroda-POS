import { normalizeBarcode } from './barcode.util';

// Checking the rows of a catalog import as plain functions, so every rule can be tested without a database. The same checks run
// for the dry run and for the real import, so what the preview promises is what the import does.

/** The most rows one import may carry. Enforced on the server as well as in the browser. */
export const MAX_IMPORT_ROWS = 5000;

export type RawRow = Record<string, unknown>;

/** What is already in the catalog (names and codes compared ignoring upper/lower case). */
export interface ExistingCatalog {
  /** lower-case product codes (SKUs) */
  skus: Set<string>;
  /** lower-case barcodes */
  barcodes: Set<string>;
  /** lower-case tax class name -> id */
  taxClasses: Map<string, string>;
  /** lower-case category name -> id */
  categories: Map<string, string>;
  /** lower-case product name -> id */
  products: Map<string, string>;
}

export interface PlannedVariant {
  row: number;
  productKey: string;
  productName: string;
  /** Spelling as first written in the file. */
  category: string | null;
  taxClassId: string | null;
  variantName: string | null;
  sku: string;
  price: number;
  cost: number | null;
  barcode: string | null;
  quantityMode: 'COUNT' | 'WEIGHT';
  openingStock: number | null;
}

export interface RowError {
  row: number;
  field: string;
  message: string;
}

export interface ImportSummary {
  rows: number;
  newCategories: string[];
  newProducts: number;
  existingProducts: number;
  newVariants: number;
  duplicates: { row: number; sku: string; where: 'file' | 'catalog' }[];
  openingStockRows: number;
}

/** Why an import cannot be taken, before any row is looked at. */
export function rowLimitProblem(count: number): string | null {
  if (count === 0) return 'The file has no rows to import';
  if (count > MAX_IMPORT_ROWS)
    return `A file can have at most ${MAX_IMPORT_ROWS.toLocaleString('en-US')} rows. Split it into smaller files.`;
  return null;
}

/** A cell as text: trimmed, and the apostrophe an export puts in front of a cell starting with = + - @ taken off again. */
export function cell(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return /^'[=+\-@]/.test(text) ? text.slice(1) : text;
}

function money(text: string): number | null {
  const clean = text.replace(/,/g, '').replace(/^KES\s*/i, '');
  return /^\d{1,10}(\.\d{1,2})?$/.test(clean) ? Number(clean) : null;
}

function quantity(text: string, whole: boolean): number | null {
  const clean = text.replace(/,/g, '');
  if (whole) return /^\d{1,9}$/.test(clean) ? Number(clean) : null;
  return /^\d{1,9}(\.\d{1,3})?$/.test(clean) ? Number(clean) : null;
}

export function validateImport(
  rows: RawRow[],
  existing: ExistingCatalog,
  hasBranch: boolean,
): { errors: RowError[]; variants: PlannedVariant[]; summary: ImportSummary } {
  const errors: RowError[] = [];
  const variants: PlannedVariant[] = [];
  const seenSku = new Map<string, number>();
  const seenBarcode = new Map<string, number>();
  const productFirst = new Map<
    string,
    { row: number; category: string | null; taxClass: string | null }
  >();
  const newCategories = new Map<string, string>();
  const duplicates: ImportSummary['duplicates'] = [];
  const newProductKeys = new Set<string>();
  const existingProductKeys = new Set<string>();

  rows.forEach((raw, index) => {
    const row = index + 2; // the header is row 1 of the spreadsheet
    const fail = (field: string, message: string) =>
      errors.push({ row, field, message });
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return fail('row', 'This row is not readable');

    const productName = cell(raw.product_name);
    const categoryName = cell(raw.category);
    const taxClassName = cell(raw.tax_class);
    const variantName = cell(raw.variant_name);
    const sku = cell(raw.sku);
    const priceText = cell(raw.price);
    const costText = cell(raw.cost);
    const barcodeText = cell(raw.barcode);
    const modeText = cell(raw.quantity_mode).toUpperCase();
    const stockText = cell(raw.opening_stock);

    let ok = true;
    const bad = (field: string, message: string) => {
      ok = false;
      fail(field, message);
    };

    if (!productName) bad('product_name', 'The product name is empty');
    else if (productName.length > 200)
      bad('product_name', 'The product name is longer than 200 letters');
    if (categoryName.length > 200)
      bad('category', 'The category is longer than 200 letters');
    if (variantName.length > 60)
      bad('variant_name', 'The option name is longer than 60 letters');

    let taxClassId: string | null = null;
    if (taxClassName) {
      taxClassId = existing.taxClasses.get(taxClassName.toLowerCase()) ?? null;
      if (!taxClassId)
        bad(
          'tax_class',
          `There is no tax class called "${taxClassName}". Add it under Tax Settings first.`,
        );
    }

    const mode: 'COUNT' | 'WEIGHT' | null =
      modeText === '' || modeText === 'COUNT'
        ? 'COUNT'
        : modeText === 'WEIGHT'
          ? 'WEIGHT'
          : null;
    if (!mode)
      bad(
        'quantity_mode',
        'The quantity mode must be COUNT or WEIGHT (or empty for COUNT)',
      );

    let price: number | null = null;
    if (!priceText) bad('price', 'The price is empty');
    else {
      price = money(priceText);
      if (price === null)
        bad(
          'price',
          `"${priceText}" is not a valid price (a number like 150 or 149.50)`,
        );
    }
    let cost: number | null = null;
    if (costText) {
      cost = money(costText);
      if (cost === null)
        bad(
          'cost',
          `"${costText}" is not a valid cost (a number like 90 or 89.50)`,
        );
    }

    let openingStock: number | null = null;
    if (stockText) {
      openingStock = mode ? quantity(stockText, mode === 'COUNT') : null;
      if (openingStock === null)
        bad(
          'opening_stock',
          mode === 'COUNT'
            ? `"${stockText}" is not a whole number of items`
            : `"${stockText}" is not a valid quantity (up to 3 decimals)`,
        );
      else if (openingStock > 0 && !hasBranch)
        bad('opening_stock', 'Choose which branch holds the opening stock');
    }

    if (!sku) bad('sku', 'The product code (SKU) is empty');
    else if (sku.length > 100)
      bad('sku', 'The product code is longer than 100 letters');
    else {
      const key = sku.toLowerCase();
      if (seenSku.has(key)) {
        bad(
          'sku',
          `The product code "${sku}" is already used on row ${seenSku.get(key)} of this file`,
        );
        duplicates.push({ row, sku, where: 'file' });
      } else if (existing.skus.has(key)) {
        bad('sku', `The product code "${sku}" already exists in your catalog`);
        duplicates.push({ row, sku, where: 'catalog' });
      } else if (existing.barcodes.has(key) || seenBarcode.has(key)) {
        bad('sku', `The product code "${sku}" is already a barcode`);
      }
      if (!seenSku.has(key)) seenSku.set(key, row);
    }

    let barcode: string | null = null;
    if (barcodeText) {
      try {
        barcode = normalizeBarcode(barcodeText);
      } catch (e) {
        bad(
          'barcode',
          e instanceof Error ? e.message : 'The barcode is not usable',
        );
      }
      if (barcode) {
        const key = barcode.toLowerCase();
        if (seenBarcode.has(key))
          bad(
            'barcode',
            `The barcode "${barcode}" is already used on row ${seenBarcode.get(key)} of this file`,
          );
        else if (
          existing.barcodes.has(key) ||
          existing.skus.has(key) ||
          (seenSku.has(key) && seenSku.get(key) !== row)
        )
          bad(
            'barcode',
            `The barcode "${barcode}" is already used by another product`,
          );
        if (!seenBarcode.has(key)) seenBarcode.set(key, row);
      }
    }

    // One product can take several rows (its options); its category and tax class come from its first row.
    const productKey = productName.toLowerCase();
    if (productName) {
      const first = productFirst.get(productKey);
      if (!first)
        productFirst.set(productKey, {
          row,
          category: categoryName || null,
          taxClass: taxClassName || null,
        });
      else if ((categoryName || null) !== first.category && categoryName)
        bad(
          'category',
          `This product is in "${first.category ?? 'no category'}" on row ${first.row} but "${categoryName}" here`,
        );
      else if ((taxClassName || null) !== first.taxClass && taxClassName)
        bad(
          'tax_class',
          `This product has tax class "${first.taxClass ?? 'none'}" on row ${first.row} but "${taxClassName}" here`,
        );
    }

    if (!ok || price === null || !mode) return;

    const isExisting = existing.products.has(productKey);
    (isExisting ? existingProductKeys : newProductKeys).add(productKey);
    if (
      categoryName &&
      !isExisting &&
      !existing.categories.has(categoryName.toLowerCase()) &&
      !newCategories.has(categoryName.toLowerCase())
    )
      newCategories.set(categoryName.toLowerCase(), categoryName);
    variants.push({
      row,
      productKey,
      productName,
      category: categoryName || null,
      taxClassId,
      variantName: variantName || null,
      sku,
      price,
      cost,
      barcode,
      quantityMode: mode,
      openingStock:
        openingStock !== null && openingStock > 0 ? openingStock : null,
    });
  });

  return {
    errors,
    variants,
    summary: {
      rows: rows.length,
      newCategories: Array.from(newCategories.values()),
      newProducts: newProductKeys.size,
      existingProducts: existingProductKeys.size,
      newVariants: variants.length,
      duplicates,
      openingStockRows: variants.filter((v) => v.openingStock !== null).length,
    },
  };
}
