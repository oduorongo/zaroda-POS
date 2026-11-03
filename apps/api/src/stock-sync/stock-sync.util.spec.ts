import { planStockUpdate } from './stock-sync.util';

const variants = [
  { id: 'v1', sku: 'SUG-1KG', barcode: '6161100000011', price: 180, quantityMode: 'COUNT' as const, name: 'Sugar 1kg' },
  { id: 'v2', sku: 'RICE-LOOSE', barcode: null, price: 150, quantityMode: 'WEIGHT' as const, name: 'Rice (loose)' },
];

describe('planStockUpdate', () => {
  it('matches by SKU (any case) or barcode and reads stock and price', () => {
    const { planned, problems } = planStockUpdate(
      [
        { sku: 'sug-1kg', stock: '24', price: '185' },
        { barcode: '', sku: 'RICE-LOOSE', stock: '12.5' },
      ],
      variants,
    );
    expect(problems).toEqual([]);
    expect(planned).toEqual([
      { row: 2, variantId: 'v1', name: 'Sugar 1kg', stock: 24, price: 185 },
      { row: 3, variantId: 'v2', name: 'Rice (loose)', stock: 12.5, price: null },
    ]);
    expect(planStockUpdate([{ barcode: '6161100000011', stock: '3' }], variants).planned[0].variantId).toBe('v1');
  });

  it('explains each bad row by its spreadsheet row number, and skips empty rows', () => {
    const { planned, problems } = planStockUpdate(
      [
        { sku: 'NOPE', stock: '1' },
        { sku: 'SUG-1KG', stock: '2.5' },
        {},
        { sku: 'RICE-LOOSE', price: '-4' },
        { stock: '5' },
        { sku: 'SUG-1KG' },
      ],
      variants,
    );
    expect(planned).toEqual([]);
    expect(problems.map((p) => p.row)).toEqual([2, 3, 5, 6, 7]);
    expect(problems[1].problem).toMatch(/whole number/);
  });

  it('refuses the same product twice in one list', () => {
    const { problems } = planStockUpdate([{ sku: 'SUG-1KG', stock: '1' }, { barcode: '6161100000011', stock: '2' }], variants);
    expect(problems).toEqual([{ row: 3, problem: 'Sugar 1kg appears more than once' }]);
  });

  it('accepts thousands separators', () => {
    expect(planStockUpdate([{ sku: 'SUG-1KG', stock: '1,200', price: '1,250.50' }], variants).planned[0]).toMatchObject({ stock: 1200, price: 1250.5 });
  });
});
