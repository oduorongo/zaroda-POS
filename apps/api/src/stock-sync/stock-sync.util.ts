export const MAX_STOCK_ROWS = 5000;

export interface StockRowInput {
  sku?: unknown;
  barcode?: unknown;
  stock?: unknown;
  price?: unknown;
}

export interface KnownVariant {
  id: string;
  sku: string;
  barcode: string | null;
  price: number;
  quantityMode: 'COUNT' | 'WEIGHT';
  name: string;
}

export interface PlannedStockRow {
  row: number;
  variantId: string;
  name: string;
  stock: number | null;
  price: number | null;
}

export interface StockRowProblem {
  row: number;
  problem: string;
}

const cell = (v: unknown) => (v == null ? '' : String(v).trim());

function amount(text: string, decimals: number): number | null {
  const clean = text.replace(/,/g, '');
  const pattern = decimals === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`);
  if (!pattern.test(clean)) return null;
  return Number(clean);
}

/**
 * Matches each row of the other POS's stock list to a ZARODA product option by SKU, else barcode, and checks the new stock
 * count and price. Rows are numbered from 2 (row 1 is the spreadsheet's header). Nothing is written here.
 */
export function planStockUpdate(rows: StockRowInput[], variants: KnownVariant[]) {
  const bySku = new Map(variants.map((v) => [v.sku.toLowerCase(), v]));
  const byBarcode = new Map(variants.filter((v) => v.barcode).map((v) => [v.barcode!.toLowerCase(), v]));
  const planned: PlannedStockRow[] = [];
  const problems: StockRowProblem[] = [];
  const seen = new Set<string>();

  rows.forEach((raw, i) => {
    const row = i + 2;
    const sku = cell(raw.sku);
    const barcode = cell(raw.barcode);
    const stockText = cell(raw.stock);
    const priceText = cell(raw.price);
    if (!sku && !barcode && !stockText && !priceText) return;
    if (!sku && !barcode) return void problems.push({ row, problem: 'Give the SKU or the barcode' });
    const v = (sku && bySku.get(sku.toLowerCase())) || (barcode && byBarcode.get(barcode.toLowerCase())) || null;
    if (!v) return void problems.push({ row, problem: `No product in ZARODA with ${sku ? `SKU "${sku}"` : `barcode "${barcode}"`}` });
    if (seen.has(v.id)) return void problems.push({ row, problem: `${v.name} appears more than once` });
    seen.add(v.id);
    if (!stockText && !priceText) return void problems.push({ row, problem: 'Give the stock, the price, or both' });

    let stock: number | null = null;
    if (stockText) {
      stock = amount(stockText, v.quantityMode === 'COUNT' ? 0 : 3);
      if (stock === null) {
        return void problems.push({ row, problem: v.quantityMode === 'COUNT' ? `"${stockText}" is not a whole number of items` : `"${stockText}" is not a valid quantity (up to 3 decimals)` });
      }
    }
    let price: number | null = null;
    if (priceText) {
      price = amount(priceText, 2);
      if (price === null || price <= 0) return void problems.push({ row, problem: `"${priceText}" is not a valid price` });
    }
    planned.push({ row, variantId: v.id, name: v.name, stock, price });
  });
  return { planned, problems };
}
