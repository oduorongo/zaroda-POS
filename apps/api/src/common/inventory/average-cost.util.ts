// The cost of a product as stock keeps arriving at different prices. Market prices move, so each delivery is blended into the
// cost already held in stock (a weighted average) instead of someone retyping the cost by hand. The profit report then prices
// what was sold at that cost.

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The new cost after receiving `receivedQty` at `unitCost` on top of `onHand` already in stock at `oldCost`.
 *
 *   10 kg in stock at KES 80, receive 20 kg at KES 110  ->  (10 x 80 + 20 x 110) / 30 = KES 100
 *
 * - Stock that is zero (or somehow negative) carries no weight: the new price simply becomes the cost.
 * - If the stock already held has no known cost, there is nothing to blend with: the new price becomes the cost.
 * - Stored in whole cents, like every cost in the system.
 */
export function averageCost(input: { onHand: number; oldCost: number | null; receivedQty: number; unitCost: number }): number {
  const { oldCost, receivedQty, unitCost } = input;
  if (!(receivedQty > 0)) return oldCost ?? round2(unitCost);
  const onHand = Math.max(0, input.onHand);
  if (oldCost === null || onHand === 0) return round2(unitCost);
  return round2((onHand * oldCost + receivedQty * unitCost) / (onHand + receivedQty));
}
