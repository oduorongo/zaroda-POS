const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Ingredient costs of a batch, its total and its cost per kg of feed made. Items with no cost count as free (said in the screen). */
export function batchCost<T extends { quantity: number; unitCost: number | null }>(items: T[], kgProduced: number) {
  const lines = items.map((i) => ({ ...i, cost: r2(i.quantity * (i.unitCost ?? 0)) }));
  const cost = r2(lines.reduce((s, l) => s + l.cost, 0));
  return { lines, cost, costPerKg: kgProduced > 0 ? r2(cost / kgProduced) : 0, missingCost: items.some((i) => i.unitCost === null) };
}

/** A ration scaled to a number of batches: each ingredient times the batches. */
export const scaleRation = (items: { variantId: string; quantity: number }[], batches: number) => items.map((i) => ({ variantId: i.variantId, quantity: r3(i.quantity * batches) }));

/** Batch number for the day: FB-20270117-1, -2 ... */
export const batchNo = (day: string, nth: number) => `FB-${day.replace(/-/g, '')}-${nth}`;

/** Days of feed left at the average daily use; null when the feed has not been fed lately. */
export function daysLeft(onHand: number, kgFedInWindow: number, windowDays: number): number | null {
  const perDay = kgFedInWindow / windowDays;
  return perDay > 0 ? Math.floor(Math.max(0, onHand) / perDay) : null;
}

export const LOW_FEED_DAYS = 7;

/** Feed cost per litre of milk and per egg over the same days; null when there is nothing to divide by. */
export function feedCostPer(cost: number, produced: number): number | null {
  return produced > 0 && cost > 0 ? r2(cost / produced) : null;
}
