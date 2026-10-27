import {
  buildReceipt,
  dashed,
  parseKraDateTime,
  qrText,
  ReceiptIn,
  taxLabel,
} from './etims-receipt.util';

const sale = (over: Partial<ReceiptIn> = {}): ReceiptIn => ({
  kind: 'SALE',
  copy: false,
  business: { name: 'Jaribu Stores', address: 'Moi Avenue, Nairobi', pin: 'P051234567Z' },
  buyerPin: null,
  lines: [
    // KRA's own sample: bread exempt, 6,720.00 of cheese less a discount, gum - amounts with tax in them
    { itemNm: 'Plain Bread', qty: 1, prc: 1000, splyAmt: 1000, dcAmt: 0, dcRt: 0, taxTyCd: 'A', taxAmt: 0, totAmt: 1000 },
    { itemNm: 'Gouda cheese', qty: 0.2, prc: 33600, splyAmt: 6720, dcAmt: 1680, dcRt: 25, taxTyCd: 'B', taxAmt: 695.17, totAmt: 5040 },
    { itemNm: 'Wriggly gum', qty: 5, prc: 60, splyAmt: 300, dcAmt: 0, dcRt: 0, taxTyCd: 'B', taxAmt: 41.38, totAmt: 300 },
  ],
  rates: { A: 0, B: 16, C: 0, D: 0, E: 8 },
  payment: { label: 'CASH' },
  scu: { scuId: 'KRACU0100000001', receiptNo: 152, totalReceiptNo: 160, internalData: 'TE68SLA234J5EAV3N56988LJQ7', signature: 'V249J39CFJ48HE2W', at: '20230125110735' },
  tis: { receiptNumber: 'S-152', at: new Date('2023-01-25T08:07:36Z') },
  originalCuInvoiceNo: null,
  ...over,
});

describe('dashed', () => {
  it('puts a dash after every fourth character', () => {
    expect(dashed('TE68SLA234J5EAV3N56988LJQ7')).toBe('TE68-SLA2-34J5-EAV3-N569-88LJ-Q7');
    expect(dashed('V249J39CFJ48HE2W')).toBe('V249-J39C-FJ48-HE2W');
  });
  it('does not double up dashes already there, and copes with nothing', () => {
    expect(dashed('V249-J39C-FJ48-HE2W')).toBe('V249-J39C-FJ48-HE2W');
    expect(dashed(null)).toBe('');
    expect(dashed('ABCD')).toBe('ABCD');
  });
});

describe('parseKraDateTime', () => {
  it('reads KRA\'s timestamp', () => {
    expect(parseKraDateTime('20230125110735')).toEqual({ date: '25/01/2023', time: '11:07:35', dateCompact: '25012023', timeCompact: '110735' });
  });
  it('is null for anything else', () => {
    expect(parseKraDateTime('2023-01-25')).toBeNull();
    expect(parseKraDateTime(undefined)).toBeNull();
  });
});

describe('qrText', () => {
  it('joins date#time#CU number#receipt number#internal data#signature', () => {
    const when = parseKraDateTime('20230125110735')!;
    expect(qrText({ when, scuId: 'KRACU0100000001', receiptNo: 152, internalData: 'INT', signature: 'SIG' })).toBe('25012023#110735#KRACU0100000001#152#INT#SIG');
  });
});

describe('taxLabel', () => {
  it('matches the specification\'s sample receipt', () => {
    expect(taxLabel('A', 0)).toBe('EX');
    expect(taxLabel('B', 16)).toBe('16%');
    expect(taxLabel('C', 0)).toBe('0%');
    expect(taxLabel('D', 0)).toBe('Non-VAT');
    expect(taxLabel('E', 8)).toBe('8%');
  });
});

describe('buildReceipt - a sale', () => {
  const r = buildReceipt(sale());
  it('shows the totals the way the sample does', () => {
    expect(r.title).toBe('TAX INVOICE');
    expect(r.totals.beforeDiscount).toBe(8020);
    expect(r.totals.discount).toBe(-1680);
    expect(r.totals.total).toBe(6340);
    expect(r.totals.vat).toBe(736.55);
    expect(r.totals.subTotal).toBe(5603.45);
    expect(r.itemsNumber).toBe(3);
    expect(r.payment).toEqual({ label: 'CASH', amount: 6340 });
  });
  it('lists the discount against the item that has one', () => {
    expect(r.lines[1].discount).toEqual({ rate: 25, amount: -1680 });
    expect(r.lines[0].discount).toBeNull();
  });
  it('prints a tax table row for every rate above 0 and for a 0 rate only when it was used', () => {
    expect(r.taxTable.map((t) => t.label)).toEqual(['EX', '16%', '8%']);
    const exempt = r.taxTable.find((t) => t.letter === 'A')!;
    expect(exempt).toMatchObject({ taxable: 1000, tax: 0 });
    const b = r.taxTable.find((t) => t.letter === 'B')!;
    expect(b.taxable).toBe(4603.45);
    expect(b.tax).toBe(736.55);
    const eight = r.taxTable.find((t) => t.letter === 'E')!;
    expect(eight).toMatchObject({ taxable: 0, tax: 0 });
  });
  it('carries the SCU information, with the invoice number, dashes and a QR text', () => {
    expect(r.scu).toMatchObject({
      date: '25/01/2023',
      time: '11:07:35',
      scuId: 'KRACU0100000001',
      cuInvoiceNo: 'KRACU0100000001/152',
      receiptCounter: '152/160 NS',
      internalData: 'TE68-SLA2-34J5-EAV3-N569-88LJ-Q7',
      signature: 'V249-J39C-FJ48-HE2W',
      qr: '25012023#110735#KRACU0100000001#152#TE68SLA234J5EAV3N56988LJQ7#V249J39CFJ48HE2W',
    });
  });
  it('shows the till\'s own receipt number and time in Nairobi', () => {
    expect(r.tis).toEqual({ receiptNumber: 'S-152', date: '25/01/2023', time: '11:07:36' });
  });
  it('is not marked as a copy', () => {
    expect(r.copyNotice).toBeNull();
  });
});

describe('buildReceipt - a copy', () => {
  it('says COPY and that it is not an official receipt', () => {
    expect(buildReceipt(sale({ copy: true })).copyNotice).toEqual({ label: 'COPY', note: 'THIS IS NOT AN OFFICIAL RECEIPT' });
  });
});

describe('buildReceipt - a credit note', () => {
  const r = buildReceipt(
    sale({
      kind: 'CREDIT',
      originalCuInvoiceNo: 'KRACU0100000001/152',
      buyerPin: 'A000000000Z',
      lines: [{ itemNm: 'Gravel /t', qty: 5.354, prc: 9000, splyAmt: 48186, dcAmt: 12046.5, dcRt: 25, taxTyCd: 'B', taxAmt: 4985.0, totAmt: 36139.5 }],
    }),
  );
  it('is titled, points at the original, and has only negative amounts', () => {
    expect(r.title).toBe('CREDIT NOTE');
    expect(r.originalCuInvoiceNo).toBe('KRACU0100000001/152');
    expect(r.creditNote).toBe('CREDIT NOTE IS APPROVED ONLY FOR ORIGINAL SALES RECEIPT');
    expect(r.totals.total).toBe(-36139.5);
    expect(r.totals.vat).toBe(-4985);
    expect(r.lines[0].amount).toBe(-48186);
    expect(r.lines[0].total).toBe(-36139.5);
    expect(r.payment.amount).toBe(-36139.5);
    expect(r.taxTable.find((t) => t.letter === 'B')).toMatchObject({ taxable: -31154.5, tax: -4985 });
  });
  it('numbers the credit note with NC and shows the buyer PIN', () => {
    expect(r.scu.cuInvoiceNo).toBe('KRACU0100000001/152 NC');
    expect(r.scu.receiptCounter).toBe('152/160 NC');
    expect(r.buyerPin).toBe('A000000000Z');
  });
});
