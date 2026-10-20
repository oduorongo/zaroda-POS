import { generatePin, hashPin, PIN_PATTERN, verifyPin } from './rider-pin.util';

describe('rider PIN', () => {
  it('accepts the right PIN and rejects a wrong one', () => {
    const stored = hashPin('4821', 'pepper');
    expect(verifyPin('4821', stored, 'pepper')).toBe(true);
    expect(verifyPin('4822', stored, 'pepper')).toBe(false);
  });

  it('is tied to the server secret', () => {
    expect(verifyPin('4821', hashPin('4821', 'pepper'), 'other')).toBe(false);
  });

  it('salts every hash', () => {
    expect(hashPin('4821', 'p')).not.toEqual(hashPin('4821', 'p'));
  });

  it('rejects a missing or malformed stored value', () => {
    expect(verifyPin('4821', null, 'p')).toBe(false);
    expect(verifyPin('4821', 'garbage', 'p')).toBe(false);
  });

  it('generates 4-digit PINs that are not trivially guessable', () => {
    for (let i = 0; i < 300; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{4}$/);
      expect(pin).not.toMatch(/^(\d)\1{3}$/);
    }
  });

  it('only allows 4 to 6 digits', () => {
    expect(PIN_PATTERN.test('1234')).toBe(true);
    expect(PIN_PATTERN.test('123456')).toBe(true);
    expect(PIN_PATTERN.test('123')).toBe(false);
    expect(PIN_PATTERN.test('12a4')).toBe(false);
  });
});
