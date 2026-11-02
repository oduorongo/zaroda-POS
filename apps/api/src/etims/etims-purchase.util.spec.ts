import {
  buildPurchaseBody,
  compactDate,
  groupMoves,
  invoiceNumberFrom,
  MoveRow,
  parseInvoices,
  purchaseLineFromInvoice,
  purchaseTotals,
  stockTypeFor,
} from './etims-purchase.util';

const creds = { tin: 'A123456789Z', bhfId: '00', cmcKey: 'k'.repeat(32) };
const who = { id: 'u1', name: 'Wanjiru' };
const at = new Date('2026-11-21T09:30:00Z');

describe('stockTypeFor', () => {
  it('maps what changed stock to KRA movement types (spec 4.15)', () => {
    expect(stockTypeFor('RECEIPT', 5)).toBe('02');
    expect(stockTypeFor('RECEIPT', -5)).toBe('12');
    expect(stockTypeFor('ADJUSTMENT', 5)).toBe('06');
    expect(stockTypeFor('ADJUSTMENT', -5)).toBe('16');
    expect(stockTypeFor('STOCKTAKE', -1)).toBe('16');
    expect(stockTypeFor('WASTE', -1)).toBe('15');
    expect(stockTypeFor('TRANSFER', -1)).toBe('13');
    expect(stockTypeFor('TRANSFER', 1)).toBe('04');
    expect(stockTypeFor('REPACK', -1)).toBe('14');
    expect(stockTypeFor('PRODUCTION', 1)).toBe('05');
  });
  it('leaves out what this route does not report: sales and returns have their own handling, and a zero change is nothing', () => {
    expect(stockTypeFor('SALE', -1)).toBeNull();
    expect(stockTypeFor('ONLINE_SALE', -1)).toBeNull();
    expect(stockTypeFor('RETURN', 1)).toBeNull();
    expect(stockTypeFor('ADJUSTMENT', 0)).toBeNull();
  });
});

const row = (over: Partial<MoveRow>): MoveRow => ({
  id: 'r1',
  branchId: 'b1',
  variantId: 'v1',
  type: 'ADJUSTMENT',
  quantityDelta: 1,
  referenceId: null,
  createdAt: at,
  ...over,
});

describe('groupMoves', () => {
  it('makes one movement per operation, branch and direction, adding up a product that appears twice', () => {
    const groups = groupMoves([
      row({
        id: '1',
        type: 'STOCKTAKE',
        referenceId: 'st1',
        variantId: 'a',
        quantityDelta: 3,
      }),
      row({
        id: '2',
        type: 'STOCKTAKE',
        referenceId: 'st1',
        variantId: 'b',
        quantityDelta: 2,
      }),
      row({
        id: '3',
        type: 'STOCKTAKE',
        referenceId: 'st1',
        variantId: 'c',
        quantityDelta: -4,
      }),
      row({
        id: '4',
        type: 'STOCKTAKE',
        referenceId: 'st1',
        variantId: 'a',
        quantityDelta: 1,
      }),
    ]);
    expect(groups).toHaveLength(2);
    const up = groups.find((g) => g.sarTyCd === '06')!;
    expect(up.rows).toEqual([
      { variantId: 'a', quantity: 4 },
      { variantId: 'b', quantity: 2 },
    ]);
    expect(groups.find((g) => g.sarTyCd === '16')!.rows).toEqual([
      { variantId: 'c', quantity: 4 },
    ]);
  });

  it("keeps a transfer's two ends apart, each at its own branch", () => {
    const groups = groupMoves([
      row({
        id: '1',
        type: 'TRANSFER',
        referenceId: 't1',
        branchId: 'b1',
        quantityDelta: -5,
      }),
      row({
        id: '2',
        type: 'TRANSFER',
        referenceId: 't1',
        branchId: 'b2',
        quantityDelta: 5,
      }),
    ]);
    expect(groups.map((g) => [g.branchId, g.sarTyCd]).sort()).toEqual([
      ['b1', '13'],
      ['b2', '04'],
    ]);
  });

  it('lets a change with no operation behind it stand alone, with a key that is the same every time', () => {
    const a = groupMoves([row({ id: 'x' }), row({ id: 'y', variantId: 'v2' })]);
    expect(a).toHaveLength(2);
    expect(groupMoves([row({ id: 'x' })])[0].key).toBe(a[0].key);
  });

  it('skips what is not reported here', () => {
    expect(groupMoves([row({ type: 'SALE', quantityDelta: -1 })])).toEqual([]);
  });
});

describe('compactDate', () => {
  it("turns KRA's listed dates into the form KRA wants back", () => {
    expect(compactDate('2020-01-27 21:03:00')).toBe('20200127210300');
    expect(compactDate('20200127')).toBe('20200127');
    expect(compactDate(null)).toBeNull();
    expect(compactDate('soon')).toBeNull();
  });
});

describe('invoiceNumberFrom', () => {
  it("only a plain number can be KRA's supplier invoice number", () => {
    expect(invoiceNumberFrom('7001')).toBe(7001);
    expect(invoiceNumberFrom(' 12 ')).toBe(12);
    expect(invoiceNumberFrom('DN-12')).toBeNull();
    expect(invoiceNumberFrom(null)).toBeNull();
  });
});

const listed = {
  saleList: [
    {
      spplrTin: 'A111111111Z',
      spplrNm: 'Taxpayer1111',
      spplrBhfId: '00',
      spplrInvcNo: 2,
      rcptTyCd: 'S',
      pmtTyCd: '01',
      cfmDt: '2020-01-27 21:03:00',
      salesDt: '20200127',
      totAmt: 10500,
      taxRtB: 18,
      itemList: [
        {
          itemSeq: 1,
          itemCd: 'KE1NTXU0000001',
          itemClsCd: '5059690800',
          itemNm: 'test item 1',
          bcd: null,
          pkgUnitCd: 'NT',
          pkg: 2,
          qtyUnitCd: 'U',
          qty: 2,
          prc: 3500,
          splyAmt: 7000,
          dcRt: 0,
          dcAmt: 0,
          taxTyCd: 'B',
          taxblAmt: 7000,
          taxAmt: 1068,
          totAmt: 7000,
        },
        {
          itemSeq: 2,
          itemCd: 'KE1NTXU0000002',
          itemClsCd: '5022110801',
          itemNm: 'test item 2',
          bcd: '123',
          pkgUnitCd: 'NT',
          pkg: 1,
          qtyUnitCd: 'U',
          qty: 1,
          prc: 3500,
          splyAmt: 3500,
          dcRt: 0,
          dcAmt: 0,
          taxTyCd: 'B',
          taxblAmt: 3500,
          taxAmt: 534,
          totAmt: 3500,
        },
      ],
    },
    { spplrTin: null, spplrInvcNo: 3, itemList: [{ itemCd: 'x' }] },
    { spplrTin: 'A111111111Z', spplrInvcNo: 4, itemList: [] },
  ],
};

describe('parseInvoices', () => {
  it('reads the supplier invoices KRA lists, with their lines and rates', () => {
    const out = parseInvoices(listed);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      spplrTin: 'A111111111Z',
      spplrInvcNo: 2,
      rcptTyCd: 'S',
      totAmt: 10500,
    });
    expect(out[0].rates.B).toBe(18);
    expect(out[0].lines).toHaveLength(2);
    expect(out[0].lines[1]).toMatchObject({
      itemCd: 'KE1NTXU0000002',
      bcd: '123',
      qty: 1,
      totAmt: 3500,
    });
  });
  it('ignores an invoice with no supplier PIN, no number or no lines, and an answer with no list', () => {
    expect(parseInvoices(listed)).toHaveLength(1);
    expect(parseInvoices(null)).toEqual([]);
    expect(parseInvoices({})).toEqual([]);
  });
});

describe('the purchase body', () => {
  const inv = parseInvoices(listed)[0];
  const ours = {
    variantId: 'v1',
    itemCd: 'KE2NTU0000009',
    itemClsCd: '5059690800',
    itemTyCd: '2',
    itemNm: 'Our unga',
    bcd: null,
    pkgUnitCd: 'NT',
    qtyUnitCd: 'U',
  };
  const lines = inv.lines.map((l, i) =>
    purchaseLineFromInvoice(l, ours, i + 1),
  );

  it("a line keeps the supplier's amounts, carries our item code and keeps theirs beside it", () => {
    expect(lines[0]).toMatchObject({
      itemCd: 'KE2NTU0000009',
      spplrItemCd: 'KE1NTXU0000001',
      spplrItemNm: 'test item 1',
      splyAmt: 7000,
      taxAmt: 1068,
      qty: 2,
      itemSeq: 1,
    });
    expect(lines[1].itemSeq).toBe(2);
  });

  it('confirming a supplier invoice carries its number, "approved", the totals by tax type and the registrar', () => {
    const b = buildPurchaseBody({
      creds,
      invcNo: 3,
      supplier: {
        tin: inv.spplrTin,
        bhfId: inv.spplrBhfId,
        name: inv.spplrNm,
        invcNo: inv.spplrInvcNo,
      },
      regTyCd: 'A',
      pmtTyCd: '01',
      at,
      purchaseDate: '20200127',
      lines,
      totals: purchaseTotals(lines, inv.rates),
      registrant: who,
    }) as Record<string, unknown>;
    expect(b).toMatchObject({
      tin: creds.tin,
      cmcKey: creds.cmcKey,
      invcNo: 3,
      orgInvcNo: 0,
      spplrTin: 'A111111111Z',
      spplrInvcNo: 2,
      regTyCd: 'A',
      pchsTyCd: 'N',
      rcptTyCd: 'P',
      pchsSttsCd: '02',
      cfmDt: '20261121123000',
      pchsDt: '20200127',
      totItemCnt: 2,
      taxblAmtB: 10500,
      taxAmtB: 1602,
      taxRtB: 18,
      totAmt: 10500,
      regrId: 'u1',
    });
    expect((b.itemList as unknown[]).length).toBe(2);
  });

  it('a purchase entered by hand has no supplier invoice number unless the delivery note is one', () => {
    const b = buildPurchaseBody({
      creds,
      invcNo: 1,
      supplier: {
        tin: 'A111111111Z',
        bhfId: '00',
        name: 'Hand Supplier',
        invcNo: null,
      },
      regTyCd: 'M',
      pmtTyCd: '02',
      at,
      purchaseDate: '20261121',
      lines,
      totals: purchaseTotals(lines, {}),
      registrant: who,
    }) as Record<string, unknown>;
    expect(b).toMatchObject({
      regTyCd: 'M',
      spplrInvcNo: null,
      pmtTyCd: '02',
      taxRtB: 16,
    });
  });
});
