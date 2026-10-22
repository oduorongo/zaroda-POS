// Taxes and levies on room nights: percentages the business sets (not hard-coded), added on top of the room price. Each tax is shown
// by name on the folio, and together they are the single rate the room product carries into the settlement sale.

export interface TaxLine {
  name: string;
  /** e.g. 16 for 16%. */
  percent: number;
}

const cents = (n: number) => Math.round(n * 100);
const money = (c: number) => c / 100;

/** All the taxes added together, as a fraction (16 + 2 = 0.18). */
export const combinedRate = (taxes: TaxLine[]): number =>
  Math.round(taxes.reduce((s, t) => s + t.percent, 0) * 100) / 10_000;

/**
 * A tax amount (in cents) split between the taxes in proportion to their percentages, adding back up exactly. The odd cents go
 * to the first taxes in the list.
 */
export function splitTaxCents(
  totalCents: number,
  taxes: TaxLine[],
): { name: string; cents: number }[] {
  const weights = taxes.map((t) => Math.round(t.percent * 100));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (taxes.length === 0 || sum <= 0 || totalCents === 0)
    return taxes.map((t) => ({ name: t.name, cents: 0 }));
  const shares = weights.map((w) => Math.floor((totalCents * w) / sum));
  let left = totalCents - shares.reduce((a, b) => a + b, 0);
  for (let i = 0; left > 0; i = (i + 1) % shares.length, left--) shares[i] += 1;
  return taxes.map((t, i) => ({ name: t.name, cents: shares[i] }));
}

export interface NightPosting {
  /** The night's price including tax. */
  amount: number;
  /** The tax inside it. */
  taxAmount: number;
  /** That tax by name. */
  breakdown: Record<string, number>;
}

/**
 * The folio entries for a stay's nights from each night's price WITHOUT tax. Tax is worked out once on the whole stay (the same
 * way the sale made at check-out works it, rounded once), and the odd cents are put on the last night, so the entries add up to
 * exactly what that sale will total - it refuses to complete if its payments do not match its own total.
 */
export function nightPostings(
  netPerNight: number[],
  taxes: TaxLine[],
): NightPosting[] {
  if (netPerNight.length === 0) return [];
  const rate = combinedRate(taxes);
  const netCents = netPerNight.map(cents);
  const totalNet = netCents.reduce((a, b) => a + b, 0);
  const totalTax = Math.round(totalNet * rate);

  // each night's tax in proportion to its price, the last night taking what is left
  const taxCents: number[] = [];
  let used = 0;
  netCents.forEach((c, i) => {
    const t =
      i === netCents.length - 1
        ? totalTax - used
        : totalNet === 0
          ? 0
          : Math.floor((totalTax * c) / totalNet);
    taxCents.push(t);
    used += t;
  });
  return netCents.map((c, i) => {
    const parts = splitTaxCents(taxCents[i], taxes);
    return {
      amount: money(c + taxCents[i]),
      taxAmount: money(taxCents[i]),
      breakdown: Object.fromEntries(parts.map((p) => [p.name, money(p.cents)])),
    };
  });
}
