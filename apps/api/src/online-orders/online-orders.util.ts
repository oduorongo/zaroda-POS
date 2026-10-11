import { createHash, randomBytes, randomInt } from 'crypto';

/**
 * Normalizes a Kenyan mobile number to 2547XXXXXXXX / 2541XXXXXXXX (the
 * format M-Pesa and SMS gateways expect), or returns null. Accepts the
 * ways people actually type it: 0712..., 712..., +254712..., 254712...,
 * with spaces or dashes.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-()]/g, '').replace(/^\+/, '');
  const match = /^(?:254|0)?([17]\d{8})$/.exec(digits);
  return match ? `254${match[1]}` : null;
}

// No 0/O/1/I - order numbers get read out over the phone.
const ORDER_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateOrderNumber(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += ORDER_ALPHABET[randomInt(ORDER_ALPHABET.length)];
  return `ZR-${code}`;
}

export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Random URL-safe secret plus its hash - the secret goes in a URL, only the hash is stored. */
export function generateCallbackToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Rounds a money amount to cents. */
export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
