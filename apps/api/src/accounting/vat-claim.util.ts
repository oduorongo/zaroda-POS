// Which VAT paid on a purchase can be claimed back from KRA. KRA only allows input VAT backed by the supplier's eTIMS invoice to the
// business's PIN, so the supplier's PIN and the invoice number are needed; VAT without them is a cost.

/** A KRA PIN: A (person) or P (company), nine digits, a letter. */
export const KRA_PIN = /^[AP]\d{9}[A-Z]$/;

/**
 * KRA: linked to the invoice KRA holds (checked). DECLARED: PIN and invoice number entered by hand (check it shows on iTax).
 * MISSING: VAT entered without them (not claimable). NONE: no VAT.
 */
export type VatClaim = 'KRA' | 'DECLARED' | 'MISSING' | 'NONE';

export function vatClaim(p: { taxCents: number; pin: string | null | undefined; invoiceNo: string | null | undefined; linked: boolean }): VatClaim {
  if (p.taxCents <= 0) return 'NONE';
  if (p.linked) return 'KRA';
  return p.pin && KRA_PIN.test(p.pin) && p.invoiceNo?.trim() ? 'DECLARED' : 'MISSING';
}

export const claimableCents = (p: Parameters<typeof vatClaim>[0]) => (['KRA', 'DECLARED'].includes(vatClaim(p)) ? p.taxCents : 0);

/** A PIN as typed: trimmed and in capitals, or null. */
export const cleanPin = (pin: string | null | undefined) => pin?.trim().toUpperCase() || null;
