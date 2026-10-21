import { ean13CheckDigit, generateInternalEan13, isValidEan13, normalizeBarcode } from './barcode.util';

describe('normalizeBarcode', () => {
  it('trims and removes spaces (a scanner or a paste can add them)', () => {
    expect(normalizeBarcode(' 6161 1100 00123 ')).toBe('6161110000123');
  });

  it('treats blank as no barcode', () => {
    expect(normalizeBarcode('')).toBeNull();
    expect(normalizeBarcode('   ')).toBeNull();
    expect(normalizeBarcode(undefined)).toBeNull();
    expect(normalizeBarcode(null)).toBeNull();
  });

  it('keeps letters (Code 128 labels can have them) and refuses odd characters', () => {
    expect(normalizeBarcode('BR-400G/1')).toBe('BR-400G/1');
    expect(() => normalizeBarcode('12$34')).toThrow(/letters, numbers/);
    expect(() => normalizeBarcode('12')).toThrow();
    expect(() => normalizeBarcode('x'.repeat(61))).toThrow();
  });
});

describe('EAN-13', () => {
  it('knows the check digit of real codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931 (a Stabilo pen)
    expect(isValidEan13('4006381333931')).toBe(true);
    expect(isValidEan13('5901234123457')).toBe(true); // the GS1 sample code
  });

  it('rejects a wrong check digit or wrong length', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339a1')).toBe(false);
  });

  it('makes in-store codes: 13 digits, start with 2, correct check digit', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInternalEan13();
      expect(code).toMatch(/^2\d{12}$/);
      expect(isValidEan13(code)).toBe(true);
    }
  });

  it('pads a small random number so the code is always 13 digits', () => {
    const code = generateInternalEan13(() => 7);
    expect(code).toHaveLength(13);
    expect(code.startsWith('20000000000')).toBe(true);
    expect(isValidEan13(code)).toBe(true);
  });
});
