import { normalizeKenyanPhone } from '../online-orders/online-orders.util';

/** "A1234567" -> "****4567": lists never show a whole ID or passport number. */
export function maskId(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length <= 4
    ? '****'
    : `${'*'.repeat(Math.min(v.length - 4, 8))}${v.slice(-4)}`;
}

/** A guest's phone as typed: a Kenyan mobile is normalised to 2547..., anything else (a visitor's number) is kept as digits with a plus. */
export function guestPhone(input: string): string | null {
  const kenyan = normalizeKenyanPhone(input);
  if (kenyan) return kenyan;
  const cleaned = input.replace(/[^\d+]/g, '');
  return /^\+?\d{6,18}$/.test(cleaned) ? cleaned : null;
}
