import { pluRows, ReportDoc, summarise } from './etims-reports.util';

const rates = { A: 0, B: 16, C: 0, D: 0, E: 8 };
const line = (over: Partial<ReportDoc['lines'][number]> = {}): ReportDoc['lines'][number] => ({
  variantId: 'v1',
  itemCd: 'KE2BEXUXXX0000001',
  itemNm: 'Bread',
  qty: 2,
  splyAmt: 232,
  dcAmt: 0,
  taxTyCd: 'B',
  taxAmt: 32,
  totAmt: 232,
  ...over,
});
const extras = {
  copies: { sale: { count: 1, amount: 232 }, credit: { count: 0, amount: 0 } },
  openingDeposit: 500,
  incomplete: 2,
  manualCreditNotes: 1,
};

describe('summarise', () => {
  const docs: ReportDoc[] = [
    { kind: 'SALE', pmtTyCd: '01', rates, lines: [line(), line({ itemCd: 'B2', itemNm: 'Milk', variantId: 'v2', qty: 1, splyAmt: 100, dcAmt: 10, taxTyCd: 'A', taxAmt: 0, totAmt: 90 })] },
    { kind: 'SALE', pmtTyCd: '06', rates, lines: [line({ qty: 1, splyAmt: 116, taxAmt: 16, totAmt: 116 })] },
    { kind: 'CREDIT', pmtTyCd: '01', rates, lines: [line({ qty: 1, splyAmt: 116, taxAmt: 16, totAmt: 116 })] },
  ];
  const r = summarise(docs, extras);
  it('counts and totals sales and credit notes separately', () => {
    expect(r.sales).toEqual({ count: 2, total: 438 });
    expect(r.creditNotes).toEqual({ count: 1, total: 116 });
  });
  it('splits taxable amounts and tax by rate, sales and credit notes apart, showing a rate only when above 0 or used', () => {
    expect(r.taxByRate.map((t) => t.label)).toEqual(['EX', '16%', '8%']);
    const b = r.taxByRate.find((t) => t.letter === 'B')!;
    expect(b.sales).toEqual({ taxable: 300, tax: 48 });
    expect(b.credit).toEqual({ taxable: 100, tax: 16 });
    expect(r.taxByRate.find((t) => t.letter === 'A')!.sales).toEqual({ taxable: 90, tax: 0 });
  });
  it('splits the takings by how they were paid', () => {
    expect(r.paymentsSales).toEqual([
      { code: '01', name: 'CASH', amount: 322 },
      { code: '06', name: 'MOBILE MONEY', amount: 116 },
    ]);
    expect(r.paymentsCreditNotes).toEqual([{ code: '01', name: 'CASH', amount: 116 }]);
  });
  it('adds up items sold and discounts', () => {
    expect(r.itemsSold).toBe(4);
    expect(r.discounts).toBe(10);
  });
  it('carries the extras and says training and proforma were none', () => {
    expect(r.copies.sale).toEqual({ count: 1, amount: 232 });
    expect(r.openingDeposit).toBe(500);
    expect(r.incompleteSales).toBe(2);
    expect(r.manualCreditNotes).toBe(1);
    expect(r.training.count).toBe(0);
    expect(r.proforma.count).toBe(0);
  });
  it('is all zeros with nothing in it, and still lists the taxed rates', () => {
    const e = summarise([], extras);
    expect(e.sales).toEqual({ count: 0, total: 0 });
    expect(e.taxByRate).toEqual([]);
  });
});

describe('pluRows', () => {
  const docs: ReportDoc[] = [
    { kind: 'SALE', pmtTyCd: '01', rates, lines: [line(), line({ itemCd: 'B2', itemNm: 'Arrowroot', variantId: 'v2', qty: 3, splyAmt: 300, taxTyCd: 'A', taxAmt: 0, totAmt: 300 })] },
    { kind: 'SALE', pmtTyCd: '01', rates, lines: [line({ qty: 1, splyAmt: 116, totAmt: 116, taxAmt: 16 })] },
    { kind: 'CREDIT', pmtTyCd: '01', rates, lines: [line({ qty: 1, splyAmt: 116, totAmt: 116, taxAmt: 16 })] },
  ];
  const rows = pluRows(docs, new Map([['v1', 40]]));
  it('groups by item, takes credit notes off, and sorts by name', () => {
    expect(rows.map((r) => r.name)).toEqual(['Arrowroot', 'Bread']);
    const bread = rows.find((r) => r.name === 'Bread')!;
    expect(bread).toMatchObject({ quantity: 2, amount: 232, unitPrice: 116, tax: '16%', remaining: 40 });
  });
  it('has no stock figure for an item it knows nothing about', () => {
    expect(rows.find((r) => r.name === 'Arrowroot')).toMatchObject({ quantity: 3, amount: 300, tax: 'EX', remaining: null });
  });
});
