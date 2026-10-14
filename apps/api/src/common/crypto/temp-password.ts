import { randomInt } from 'crypto';

// No 0/O, 1/l/I - a temporary password gets read out over a call or typed from a message.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

/** A random one-time password to hand to a new account; the person must replace it at first sign-in. */
export function generateTempPassword(length = 12): string {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}
