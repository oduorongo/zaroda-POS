import { timingSafeEqual } from 'crypto';
import { sha256 } from './online-orders.util';

/**
 * A guest's order link carries "<organizationId>.<secret>". The organization id is not secret (it is in every callback
 * address); it lets the server find the right business without a sign-in. Only the secret's hash is stored on the order.
 */
export function parseGuestToken(token: string | null | undefined): { organizationId: string; secret: string } | null {
  const [organizationId, secret] = (token ?? '').split('.');
  return /^[0-9a-f-]{36}$/.test(organizationId ?? '') && secret ? { organizationId, secret } : null;
}

export function guestSecretMatches(storedHash: string | null | undefined, secret: string): boolean {
  if (!storedHash) return false;
  const expected = Buffer.from(storedHash);
  const actual = Buffer.from(sha256(secret));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
