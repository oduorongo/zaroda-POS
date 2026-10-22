import {
  cell,
  ExistingCatalog,
  MAX_IMPORT_ROWS,
  rowLimitProblem,
  validateImport,
} from './catalog-import.util';

const existing = (over: Partial<ExistingCatalog> = {}): ExistingCatalog => ({
  skus: new Set(['old-sku']),
  barcodes: new Set(['6001234567890']),
  taxClasses: new Map([['vat 16%', 'tax-1']]),
  categories: new Map([['drinks', 'cat-1']]),
  products: new Map([['soda', 'prod-1']]),
  ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  product_name: 'Bread',
  category: 'Bakery',
  tax_class: '',
  variant_name: 'Large 800g',
  sku: 'BRD-L',
  price: '85',
  cost: '60',
  barcode: '',
  quantity_mode: 'COUNT',
  opening_stock: '20',
  ...over,
});
const run = (
  rows: Record<string, unknown>[],
  hasBranch = true,
  e = existing(),
) => validateImport(rows, e, hasBranch);

describe('rowLimitProblem', () => {
  it('refuses an empty file and a file over the limit', () => {
    expect(rowLimitProblem(0)).toMatch(/no rows/);
    expect(rowLimitProblem(MAX_IMPORT_ROWS)).toBeNull();
    expect(rowLimitProblem(MAX_IMPORT_ROWS + 1)).toMatch(/at most 5,000 rows/);
  });
});

describe('cell', () => {
  it('trims, and takes off the apostrophe an export puts before = + - @', () => {
    expect(cell('  Bread  ')).toBe('Bread');
    expect(cell("'=SUM(A1)")).toBe('=SUM(A1)');
    expect(cell("'-5 pack")).toBe('-5 pack');
    expect(cell("'quoted")).toBe("'quoted");
    expect(cell(undefined)).toBe('');
    expect(cell(150)).toBe('150');
  });
});

describe('validateImport', () => {
  it('accepts a good row and summarises it: a new product, a new category, opening stock', () => {
    const r = run([row()]);
    expect(r.errors).toEqual([]);
    expect(r.variants[0]).toMatchObject({
      productName: 'Bread',
      category: 'Bakery',
      sku: 'BRD-L',
      price: 85,
      cost: 60,
      quantityMode: 'COUNT',
      openingStock: 20,
      variantName: 'Large 800g',
    });
    expect(r.summary).toMatchObject({
      rows: 1,
      newProducts: 1,
      existingProducts: 0,
      newVariants: 1,
      newCategories: ['Bakery'],
      openingStockRows: 1,
    });
  });

  it('refuses a bad price (empty, text, negative, three decimals) with the row number', () => {
    for (const price of ['', 'abc', '-5', '10.123', '1e5']) {
      const r = run([row({ price })]);
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0]).toMatchObject({ row: 2, field: 'price' });
      expect(r.variants).toHaveLength(0);
    }
    expect(run([row({ price: '1,200.50' })]).errors).toEqual([]);
    expect(run([row({ price: 'KES 150' })]).errors).toEqual([]);
  });

  it('refuses a bad cost', () => {
    expect(run([row({ cost: 'cheap' })]).errors[0]).toMatchObject({
      field: 'cost',
    });
  });

  it('refuses a duplicate SKU inside the file (ignoring case) and names the earlier row', () => {
    const r = run([row(), row({ sku: 'brd-l', variant_name: 'Again' })]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3, field: 'sku' });
    expect(r.errors[0].message).toMatch(/row 2/);
    expect(r.summary.duplicates).toEqual([
      { row: 3, sku: 'brd-l', where: 'file' },
    ]);
  });

  it('refuses a SKU that is already in the catalog', () => {
    const r = run([row({ sku: 'OLD-SKU' })]);
    expect(r.errors[0]).toMatchObject({ field: 'sku' });
    expect(r.summary.duplicates).toEqual([
      { row: 2, sku: 'OLD-SKU', where: 'catalog' },
    ]);
  });

  it("refuses a SKU that is another product's barcode, and a barcode that is another's SKU or barcode", () => {
    expect(run([row({ sku: '6001234567890' })]).errors[0]).toMatchObject({
      field: 'sku',
      message: expect.stringMatching(/already a barcode/),
    });
    expect(run([row({ barcode: '6001234567890' })]).errors[0]).toMatchObject({
      field: 'barcode',
    });
    expect(run([row({ barcode: 'OLD-SKU' })]).errors[0]).toMatchObject({
      field: 'barcode',
    });
    const twice = run([
      row({ barcode: '4001' }),
      row({ sku: 'X2', barcode: '4001' }),
    ]);
    expect(twice.errors).toHaveLength(1);
    expect(twice.errors[0]).toMatchObject({ row: 3, field: 'barcode' });
  });

  it('lets a row use the same code as its SKU and its barcode', () => {
    expect(run([row({ sku: 'ABC123', barcode: 'ABC123' })]).errors).toEqual([]);
  });

  it('refuses an unknown tax class, but matches a known one ignoring case', () => {
    const bad = run([row({ tax_class: 'Mystery' })]);
    expect(bad.errors[0]).toMatchObject({ field: 'tax_class' });
    expect(bad.errors[0].message).toMatch(/Tax Settings/);
    const good = run([row({ tax_class: 'VAT 16%' })]);
    expect(good.errors).toEqual([]);
    expect(good.variants[0].taxClassId).toBe('tax-1');
  });

  it('creates a missing category but reuses an existing one (any case), counting it once', () => {
    const r = run([
      row({ sku: 'A', category: 'Bakery' }),
      row({ product_name: 'Cake', sku: 'B', category: 'bakery' }),
      row({ product_name: 'Cola', sku: 'C', category: 'DRINKS' }),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.summary.newCategories).toEqual(['Bakery']);
  });

  it('groups rows of one product (its options) and separates new from existing products', () => {
    const r = run([
      row({ sku: 'A', variant_name: 'Small' }),
      row({ sku: 'B', variant_name: 'Large' }),
      row({ product_name: 'SODA', category: '', sku: 'C' }),
    ]);
    expect(r.errors).toEqual([]);
    expect(r.summary).toMatchObject({
      newProducts: 1,
      existingProducts: 1,
      newVariants: 3,
    });
  });

  it('refuses rows of the same product that disagree about its category', () => {
    const r = run([row({ sku: 'A' }), row({ sku: 'B', category: 'Cakes' })]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3, field: 'category' });
  });

  it('checks the quantity mode and what opening stock means for it', () => {
    expect(run([row({ quantity_mode: 'litres' })]).errors[0]).toMatchObject({
      field: 'quantity_mode',
    });
    expect(
      run([row({ quantity_mode: 'weight', opening_stock: '12.5' })]).errors,
    ).toEqual([]);
    expect(
      run([row({ quantity_mode: 'COUNT', opening_stock: '12.5' })]).errors[0],
    ).toMatchObject({ field: 'opening_stock' });
    expect(run([row({ quantity_mode: '' })]).variants[0].quantityMode).toBe(
      'COUNT',
    );
  });

  it('needs a branch for opening stock, but not when it is zero or empty', () => {
    expect(run([row()], false).errors[0]).toMatchObject({
      field: 'opening_stock',
      message: expect.stringMatching(/branch/),
    });
    expect(run([row({ opening_stock: '0' })], false).errors).toEqual([]);
    expect(
      run([row({ opening_stock: '' })], false).variants[0].openingStock,
    ).toBeNull();
  });

  it('reports every problem of every bad row at once, and still plans the good rows', () => {
    const r = run([
      row({ product_name: '', price: 'x' }),
      row({ sku: 'GOOD' }),
    ]);
    expect(r.errors.map((e) => `${e.row}:${e.field}`)).toEqual([
      '2:product_name',
      '2:price',
    ]);
    expect(r.variants.map((v) => v.sku)).toEqual(['GOOD']);
  });

  it('puts the first data row at spreadsheet row 2', () => {
    expect(run([row({ price: '' })]).errors[0].row).toBe(2);
  });

  it('survives a row that is not an object', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = run([null as any, 'text' as any]);
    expect(r.errors).toHaveLength(2);
  });
});
