import {
  allocate,
  backoffMinutes,
  buildLines,
  buildSalesBody,
  buildStockIoBody,
  buildStockMasterBody,
  LineInfo,
  paymentCode,
  SaleDoesNotAddUp,
  taxTotals,
  unsendableReason,
} from './etims-sales.util';

const info = (over: Partial<LineInfo> = {}): LineInfo => ({
  itemCd: 'KE2NTU0000001',
  itemClsCd: '5059690800',
  itemTyCd: '2',
  itemNm: 'Unga',
  bcd: null,
  pkgUnitCd: 'NT',
  qtyUnitCd: 'U',
  taxTyCd: 'B',
  ...over,
});
const creds = { tin: 'A123456789Z', bhfId: '00', cmcKey: 'k'.repeat(32) };
const who = { id: 'u1', name: 'Wanjiru' };

describe('allocate', () => {
  it('shares an amount exactly, giving odd cents to the largest remainders', () => {
    const out = allocate(100, [1, 1, 1]);
    expect(out.reduce((a, b) => a + b, 0)).toBe(100);
    expect(out).toEqual([34, 33, 33]);
  });
  it('gives nothing when there is nothing to share or no weight', () => {
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(10, [0, 0])).toEqual([0, 0]);
    expect(allocate(10, [])).toEqual([]);
  });
});

describe('buildLines', () => {
  it('turns a price before tax plus tax into KRA amounts with the tax in them', () => {
    const [l] = buildLines(
      [{ variantId: 'v', quantity: 2, unitPrice: 100, taxAmount: 32 }],
      [info()],
      232,
    );
    expect(l).toMatchObject({
      qty: 2,
      prc: 116,
      splyAmt: 232,
      dcAmt: 0,
      dcRt: 0,
      taxblAmt: 232,
      taxAmt: 32,
      totAmt: 232,
    });
  });

  it('shares a sale-level discount between lines and lowers the tax inside each, so the lines add up to what was paid', () => {
    const lines = buildLines(
      [
        { variantId: 'a', quantity: 1, unitPrice: 100, taxAmount: 16 },
        { variantId: 'b', quantity: 1, unitPrice: 200, taxAmount: 0 },
      ],
      [info(), info({ itemCd: 'KE2NTU0000002', taxTyCd: 'A' })],
      290, // 316 less 26
    );
    const total = lines.reduce((s, l) => s + Math.round(l.totAmt * 100), 0);
    expect(total).toBe(29000);
    expect(lines[0].dcAmt + lines[1].dcAmt).toBeCloseTo(26, 2);
    expect(lines[0].taxAmt).toBeLessThan(16);
    expect(lines[1].taxAmt).toBe(0);
    for (const l of lines)
      expect(Math.round(l.splyAmt * 100) - Math.round(l.dcAmt * 100)).toBe(
        Math.round(l.totAmt * 100),
      );
  });

  it('refuses a sale whose total is more than its items add up to', () => {
    expect(() =>
      buildLines(
        [{ variantId: 'v', quantity: 1, unitPrice: 100, taxAmount: 0 }],
        [info()],
        150,
      ),
    ).toThrow(SaleDoesNotAddUp);
  });

  it('copes with a free line', () => {
    const [l] = buildLines(
      [{ variantId: 'v', quantity: 1, unitPrice: 0, taxAmount: 0 }],
      [info()],
      0,
    );
    expect(l).toMatchObject({ prc: 0, totAmt: 0, dcRt: 0 });
  });
});

describe('taxTotals', () => {
  it('adds up by tax type and overall, in whole cents', () => {
    const t = taxTotals([
      { taxTyCd: 'B', taxblAmt: 116.1, taxAmt: 16.1, totAmt: 116.1 },
      { taxTyCd: 'B', taxblAmt: 0.2, taxAmt: 0.03, totAmt: 0.2 },
      { taxTyCd: 'A', taxblAmt: 50, taxAmt: 0, totAmt: 50 },
    ]);
    expect(t.taxblAmt.B).toBe(116.3);
    expect(t.taxAmt.B).toBe(16.13);
    expect(t.taxblAmt.A).toBe(50);
    expect(t.totTaxblAmt).toBe(166.3);
    expect(t.totTaxAmt).toBe(16.13);
    expect(t.totAmt).toBe(166.3);
    expect(t.taxRt.B).toBe(16);
  });
  it('uses the rates KRA lists when given', () => {
    expect(taxTotals([], { B: 18 }).taxRt.B).toBe(18);
  });
});

describe('paymentCode', () => {
  it('uses the way most of the money came in', () => {
    expect(paymentCode([{ method: 'CASH', amount: 100 }])).toBe('01');
    expect(
      paymentCode([
        { method: 'CASH', amount: 100 },
        { method: 'MPESA', amount: 300 },
      ]),
    ).toBe('06');
    expect(paymentCode([{ method: 'CARD', amount: 10 }])).toBe('05');
    expect(paymentCode([{ method: 'ROOM_CHARGE', amount: 10 }])).toBe('02');
    expect(paymentCode([])).toBe('01');
  });
});

describe('the bodies sent to KRA', () => {
  const lines = buildLines(
    [{ variantId: 'v', quantity: 2, unitPrice: 100, taxAmount: 32 }],
    [info()],
    232,
  );
  const base = {
    creds,
    invcNo: 7,
    trdInvcNo: 'sale-1',
    orgInvcNo: 0,
    credit: null,
    at: new Date('2026-11-21T09:30:00Z'),
    customerName: 'Amina',
    customerPhone: '0712000000',
    pmtTyCd: '01',
    lines,
    totals: taxTotals(lines),
    registrant: who,
    business: { name: 'Mama Shop', address: 'Westlands' },
  };

  it('a sale carries the key, the sale type, Kenya time, every tax total and the lines', () => {
    const b = buildSalesBody(base) as Record<string, unknown>;
    expect(b).toMatchObject({
      tin: creds.tin,
      bhfId: '00',
      cmcKey: creds.cmcKey,
      invcNo: 7,
      orgInvcNo: 0,
      rcptTyCd: 'S',
      salesSttsCd: '02',
      cfmDt: '20261121123000',
      salesDt: '20261121',
      totItemCnt: 1,
      taxblAmtB: 232,
      taxAmtB: 32,
      totAmt: 232,
      rfdDt: null,
      rfdRsnCd: null,
    });
    expect((b.itemList as unknown[]).length).toBe(1);
    expect((b.receipt as Record<string, unknown>).custMblNo).toBe('0712000000');
  });

  it('a credit note is a refund receipt pointing at the original invoice', () => {
    const b = buildSalesBody({
      ...base,
      invcNo: 8,
      orgInvcNo: 7,
      credit: { at: new Date('2026-11-22T06:00:00Z'), reasonCd: '06' },
    }) as Record<string, unknown>;
    expect(b).toMatchObject({
      rcptTyCd: 'R',
      orgInvcNo: 7,
      rfdRsnCd: '06',
      rfdDt: '20261122090000',
      salesSttsCd: '05',
    });
  });

  it('stock out for a sale, stock back in for a credit note, and services are left out', () => {
    const two = buildLines(
      [
        { variantId: 'a', quantity: 1, unitPrice: 100, taxAmount: 0 },
        { variantId: 'b', quantity: 1, unitPrice: 50, taxAmount: 0 },
      ],
      [info(), info({ itemCd: 'KE3NTU0000009', itemTyCd: '3' })],
      150,
    );
    const out = buildStockIoBody({
      creds,
      sarNo: 3,
      sarTyCd: '11',
      at: base.at,
      lines: two,
      registrant: who,
    }) as Record<string, unknown>;
    expect(out).toMatchObject({
      sarNo: 3,
      sarTyCd: '11',
      totItemCnt: 1,
      ocrnDt: '20261121',
    });
    expect(
      buildStockIoBody({
        creds,
        sarNo: 4,
        sarTyCd: '03',
        at: base.at,
        lines: two,
        registrant: who,
      }),
    ).toMatchObject({ sarTyCd: '03' });
  });

  it('the stock level is never below zero', () => {
    expect(buildStockMasterBody(creds, 'KE2NTU0000001', -3, who)).toMatchObject(
      { itemCd: 'KE2NTU0000001', rsdQty: 0 },
    );
    expect(
      buildStockMasterBody(creds, 'KE2NTU0000001', 4.5, who),
    ).toMatchObject({ rsdQty: 4.5 });
  });
});

describe('unsendableReason', () => {
  it('names the products KRA does not have yet', () => {
    const l = { variantId: 'v', quantity: 1, unitPrice: 1, taxAmount: 0 };
    expect(
      unsendableReason([l, l], [info(), null], ['Unga', 'Rice']),
    ).toContain('Rice');
    expect(unsendableReason([l], [info()], ['Unga'])).toBeNull();
  });
});

describe('backoffMinutes', () => {
  it('doubles from a minute and stops at an hour', () => {
    expect([1, 2, 3, 4].map(backoffMinutes)).toEqual([1, 2, 4, 8]);
    expect(backoffMinutes(20)).toBe(60);
  });
});
