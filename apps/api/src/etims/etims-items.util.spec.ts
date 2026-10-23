import {
  buildItemCode,
  buildSaveItemBody,
  inclusivePrice,
  itemFingerprint,
  itemName,
  itemState,
  mapTaxType,
  setupProblems,
} from './etims-items.util';

const codes = [
  { cd: 'A', rate: '0' },
  { cd: 'B', rate: '16' },
  { cd: 'C', rate: '0' },
  { cd: 'D', rate: '0' },
  { cd: 'E', rate: '8' },
];

describe('mapTaxType', () => {
  it('exempt is A, zero-rated is C, a product with no tax class is non-VAT (D)', () => {
    expect(mapTaxType({ rate: 0.16, isExempt: true }, codes)).toEqual({
      code: 'A',
      problem: null,
    });
    expect(mapTaxType({ rate: 0, isExempt: false }, codes)).toEqual({
      code: 'C',
      problem: null,
    });
    expect(mapTaxType(null, codes)).toEqual({ code: 'D', problem: null });
  });
  it('a rate above zero takes the tax type KRA lists with that percentage', () => {
    expect(mapTaxType({ rate: 0.16, isExempt: false }, codes).code).toBe('B');
    expect(mapTaxType({ rate: 0.08, isExempt: false }, codes).code).toBe('E');
  });
  it("follows KRA's list, not a fixed number: if KRA lists B at 18%, 18% is B and 16% has no match", () => {
    const eighteen = codes.map((c) =>
      c.cd === 'B' ? { ...c, rate: '18' } : c,
    );
    expect(mapTaxType({ rate: 0.18, isExempt: false }, eighteen).code).toBe(
      'B',
    );
    expect(mapTaxType({ rate: 0.16, isExempt: false }, eighteen)).toMatchObject(
      { code: null, problem: expect.stringMatching(/no tax type at 16%/) },
    );
  });
  it('a rate KRA has no type for is a problem, not a guess', () => {
    expect(mapTaxType({ rate: 0.125, isExempt: false }, codes)).toMatchObject({
      code: null,
      problem: expect.stringContaining('12.5%'),
    });
  });
  it("with KRA's lists not downloaded yet, says so", () => {
    expect(mapTaxType({ rate: 0.16, isExempt: false }, [])).toMatchObject({
      code: null,
      problem: expect.stringMatching(/Download KRA's lists/),
    });
  });
});

describe('buildItemCode', () => {
  it("follows KRA's pattern: KE + type + packaging + quantity + 7 digits", () => {
    expect(buildItemCode(12, '2', 'NT', 'BA')).toBe('KE2NTBA0000012');
    expect(buildItemCode(1, '3', 'NT', 'U')).toBe('KE3NTU0000001');
    expect(buildItemCode(1234567, '2', 'BG', 'KG')).toBe('KE2BGKG1234567');
  });
  it("is never longer than KRA's 20 characters", () => {
    expect(() => buildItemCode(1, '2', 'CTN', 'GRM')).not.toThrow();
    expect(() => buildItemCode(1, '2', 'LONGPACKAGING', 'LONGQTYUNIT')).toThrow(
      /20/,
    );
  });
});

describe('prices and names', () => {
  it('KRA is told the price with tax in it, to the cent', () => {
    expect(inclusivePrice(3500, 0.16)).toBe(4060);
    expect(inclusivePrice(99.99, 0.16)).toBe(115.99);
    expect(inclusivePrice(100, 0)).toBe(100);
  });
  it('an option with a name is "Product - option"', () => {
    expect(itemName('Bread', 'Large 800g')).toBe('Bread - Large 800g');
    expect(itemName(' Bread ', null)).toBe('Bread');
    expect(itemName('Bread', '  ')).toBe('Bread');
  });
});

const fields = {
  itemCd: 'KE2NTU0000001',
  itemClsCd: '5059690800',
  itemTyCd: '2',
  itemNm: 'Unga 2kg',
  bcd: '6161100012345',
  pkgUnitCd: 'NT',
  qtyUnitCd: 'U',
  taxTyCd: 'B',
  dftPrc: 4060,
  useYn: 'Y' as const,
};

describe('itemFingerprint', () => {
  const { itemCd: _c, ...rest } = fields;
  it('is the same for the same item and changes when anything KRA is told changes', () => {
    expect(itemFingerprint(rest)).toBe(itemFingerprint({ ...rest }));
    for (const change of [
      { itemNm: 'Unga 2 kg' },
      { dftPrc: 4100 },
      { taxTyCd: 'E' },
      { bcd: null },
      { itemClsCd: '5022110801' },
      { useYn: 'N' as const },
      { qtyUnitCd: 'KG' },
      { pkgUnitCd: 'BG' },
      { itemTyCd: '3' },
    ])
      expect(itemFingerprint({ ...rest, ...change })).not.toBe(
        itemFingerprint(rest),
      );
  });
});

describe('buildSaveItemBody', () => {
  const body = buildSaveItemBody(
    { tin: 'A123456789Z', bhfId: '00', cmcKey: 'k' },
    fields,
    { id: 'user-id-1', name: 'Wanjiru Kamau' },
  );
  it('carries every field the spec lists for /saveItem', () => {
    for (const k of [
      'tin',
      'bhfId',
      'cmcKey',
      'itemClsCd',
      'itemCd',
      'itemTyCd',
      'itemNm',
      'itemStdNm',
      'orgnNatCd',
      'pkgUnitCd',
      'qtyUnitCd',
      'taxTyCd',
      'btchNo',
      'bcd',
      'dftPrc',
      'grpPrcL1',
      'grpPrcL5',
      'addInfo',
      'sftyQty',
      'isrcAplcbYn',
      'useYn',
      'regrId',
      'regrNm',
      'modrId',
      'modrNm',
    ])
      expect(body).toHaveProperty(k);
  });
  it('fills what is known and sends null (not empty text) for the rest', () => {
    expect(body).toMatchObject({
      itemCd: 'KE2NTU0000001',
      itemClsCd: '5059690800',
      orgnNatCd: 'KE',
      taxTyCd: 'B',
      dftPrc: 4060,
      isrcAplcbYn: 'N',
      useYn: 'Y',
      bcd: '6161100012345',
      itemStdNm: null,
      btchNo: null,
      grpPrcL1: null,
    });
  });
  it("cuts text to KRA's lengths", () => {
    const long = buildSaveItemBody(
      { tin: 'A123456789Z', bhfId: '00', cmcKey: 'k' },
      { ...fields, itemNm: 'x'.repeat(300), bcd: '9'.repeat(40) },
      { id: 'u'.repeat(50), name: 'n'.repeat(100) },
    );
    expect((long.itemNm as string).length).toBe(200);
    expect((long.bcd as string).length).toBe(20);
    expect((long.regrId as string).length).toBe(20);
    expect((long.regrNm as string).length).toBe(60);
  });
  it('an item with no barcode sends null', () => {
    expect(
      buildSaveItemBody(
        { tin: 'A123456789Z', bhfId: '00', cmcKey: 'k' },
        { ...fields, bcd: null },
        { id: 'u', name: 'n' },
      ).bcd,
    ).toBeNull();
  });
});

describe('itemState', () => {
  const base = {
    itemClsCd: '5059690800',
    taxProblem: null,
    status: 'NOT_SENT' as const,
    sentHash: null,
    currentHash: 'h1',
  };
  it('needs setup until it has a classification and a usable tax type', () => {
    expect(itemState({ ...base, itemClsCd: null })).toBe('NEEDS_SETUP');
    expect(itemState({ ...base, taxProblem: 'x' })).toBe('NEEDS_SETUP');
  });
  it('ready to send, then registered, then needs an update when what KRA was told has changed', () => {
    expect(itemState(base)).toBe('READY');
    expect(itemState({ ...base, status: 'REGISTERED', sentHash: 'h1' })).toBe(
      'REGISTERED',
    );
    expect(itemState({ ...base, status: 'REGISTERED', sentHash: 'old' })).toBe(
      'NEEDS_UPDATE',
    );
  });
  it('a rejected item stays rejected until it is fixed and sent again', () => {
    expect(itemState({ ...base, status: 'REJECTED' })).toBe('REJECTED');
  });
});

describe('setupProblems', () => {
  it('lists what is missing, in words', () => {
    expect(
      setupProblems({
        itemClsCd: null,
        taxProblem: 'No tax type',
        name: 'Bread',
        price: 50,
      }),
    ).toEqual(["Choose KRA's product classification", 'No tax type']);
    expect(
      setupProblems({
        itemClsCd: 'x',
        taxProblem: null,
        name: 'Bread',
        price: 50,
      }),
    ).toEqual([]);
    expect(
      setupProblems({ itemClsCd: 'x', taxProblem: null, name: ' ', price: 50 }),
    ).toEqual(['The product has no name']);
  });
});
