import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'crypto';

/** 5 wrong PINs lock the account for 15 minutes - a 4-digit PIN is only safe because guesses are rationed. */
export const MAX_PIN_FAILURES = 5;
export const PIN_LOCK_MS = 15 * 60_000;

export const PIN_PATTERN = /^\d{4,6}$/;

/** A fresh 4-digit PIN to hand to a rider (never 0000-style repeats, which are the first guesses anyone makes). */
export function generatePin(): string {
  for (;;) {
    const pin = randomInt(0, 10_000).toString().padStart(4, '0');
    if (!/^(\d)\1{3}$/.test(pin) && pin !== '1234' && pin !== '4321') return pin;
  }
}

/** salt:hash, both hex. The pepper (a server secret) means a leaked table alone cannot be brute-forced offline. */
export function hashPin(pin: string, pepper: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pin, Buffer.concat([salt, Buffer.from(pepper)]), 32).toString('hex')}`;
}

export function verifyPin(pin: string, stored: string | null, pepper: string): boolean {
  if (!stored) return false;
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.concat([Buffer.from(saltHex, 'hex'), Buffer.from(pepper)]), 32);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
