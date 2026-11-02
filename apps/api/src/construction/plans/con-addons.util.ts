export interface FeeBand { upTo: number | null; darajaCost: number; markup: number }

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ZARODA's fee for one M-Pesa wage payout: Safaricom's cost for the amount's band plus the markup. Bands sorted by upTo, null last. */
export function payoutFee(bands: FeeBand[], amount: number) {
  const sorted = [...bands].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  const band = sorted.find((b) => b.upTo === null || amount <= b.upTo) ?? sorted[sorted.length - 1];
  if (!band) return { darajaCost: 0, markup: 0, amount: 0 };
  return { darajaCost: band.darajaCost, markup: band.markup, amount: r2(band.darajaCost + band.markup) };
}

/** Extra project slots bought mid-period: the monthly price for the days left until the plan renews (at least one day). */
export function proratedSlots(count: number, monthlyPrice: number, periodEnd: Date, now: Date = new Date()) {
  const days = Math.max(1, Math.ceil((periodEnd.getTime() - now.getTime()) / 86_400_000));
  return { days, amount: Math.round((count * monthlyPrice * days) / 30) };
}

/** Credits a text uses: one per 160 characters, or per 153 once it runs to more than one part. */
export const smsParts = (text: string) => (text.length <= 160 ? 1 : Math.ceil(text.length / 153));
