// Quotations to schools: when one runs out, how long a new one is open, and joining lines that name the same product.
// Plain functions, tested without a database.

import { addDays } from './school-money.util';

/** How many days a new quotation stays open when no date is given. */
export const DEFAULT_VALID_DAYS = 30;

/** Has the valid-until date passed? A quotation with no date never runs out. */
export const quoteExpired = (
  validUntil: string | null,
  today: string,
): boolean => validUntil !== null && validUntil < today;

export const defaultValidUntil = (today: string): string =>
  addDays(today, DEFAULT_VALID_DAYS);

export interface QuoteLineInput {
  variantId: string;
  quantity: number;
  unitPrice?: number;
}

/**
 * The same product listed twice is one line: quantities add up. Two entries with different prices are kept apart, because the
 * school would be quoted two prices for the same thing - that is refused.
 */
export function mergeQuoteLines(lines: QuoteLineInput[]): {
  problem: string | null;
  lines: QuoteLineInput[];
} {
  const out = new Map<string, QuoteLineInput>();
  for (const l of lines) {
    const seen = out.get(l.variantId);
    if (!seen) {
      out.set(l.variantId, { ...l });
      continue;
    }
    if (
      seen.unitPrice !== undefined &&
      l.unitPrice !== undefined &&
      seen.unitPrice !== l.unitPrice
    )
      return {
        problem: 'The same product is listed twice with different prices',
        lines: [],
      };
    seen.quantity = Math.round((seen.quantity + l.quantity) * 1000) / 1000;
    seen.unitPrice = seen.unitPrice ?? l.unitPrice;
  }
  return { problem: null, lines: [...out.values()] };
}
