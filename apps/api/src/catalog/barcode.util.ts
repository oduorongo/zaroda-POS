import { randomInt } from 'crypto';

// Barcodes on products. Shop-bought goods already carry a printed code (usually EAN-13); things made or packed in the shop
// (bread, a plate of food, a repacked bag) get one of ours - an EAN-13 starting with "2", the range GS1 sets aside for codes
// a business makes for itself, so it can never clash with a manufacturer's.

const ALLOWED = /^[A-Za-z0-9._/-]{3,60}$/;

/** A typed or scanned barcode tidied up; null for blank (meaning "no barcode"). Throws a plain sentence when it is not usable. */
export function normalizeBarcode(input: string | null | undefined): string | null {
  if (input === undefined || input === null) return null;
  const code = input.replace(/\s+/g, '').trim();
  if (code === '') return null;
  if (!ALLOWED.test(code)) {
    throw new Error('A barcode is 3 to 60 letters, numbers or - . _ / with no spaces');
  }
  return code;
}

/** The 13th digit of an EAN-13, from its first 12. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** A fresh in-store EAN-13: "2" + 11 random digits + the check digit. Uniqueness is the caller's job (it asks the database). */
export function generateInternalEan13(random: () => number = () => randomInt(0, 100_000_000_000)): string {
  const body = `2${String(random()).padStart(11, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}
