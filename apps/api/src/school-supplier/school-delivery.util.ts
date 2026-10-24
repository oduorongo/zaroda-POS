// Delivering an order in more than one drop: what is left on each line, what a delivery may carry, and where the order stands after it.
// Plain functions, tested without a database.

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export interface DeliverableLine {
  id: string;
  title: string;
  /** What the supplier agreed to supply (the quantity confirmed, or the quantity ordered if there was no change). */
  agreed: number;
  /** Everything delivered so far, over all earlier deliveries. */
  delivered: number;
}

/** What is still to come on a line. */
export const balanceOf = (
  l: Pick<DeliverableLine, 'agreed' | 'delivered'>,
): number => r3(Math.max(0, l.agreed - l.delivered));

/**
 * What a delivery will carry. A line the supplier does not mention takes its whole balance (so "deliver" with nothing typed
 * delivers everything that is left); a line given a quantity takes that, which may not be more than the balance.
 */
export function planDelivery(
  lines: DeliverableLine[],
  chosen: Map<string, number>,
): { quantities: Map<string, number>; problem: string | null } {
  const quantities = new Map<string, number>();
  for (const l of lines) {
    const balance = balanceOf(l);
    const wanted = chosen.has(l.id) ? r3(chosen.get(l.id)!) : balance;
    if (wanted > balance)
      return {
        quantities,
        problem: `${l.title}: only ${balance} left to deliver (you entered ${wanted})`,
      };
    quantities.set(l.id, wanted);
  }
  if (![...quantities.values()].some((q) => q > 0))
    return { quantities, problem: 'Nothing to deliver' };
  return { quantities, problem: null };
}

/** After a delivery: finished when no line has anything left, otherwise still partly delivered. */
export function statusAfterDelivery(
  lines: Pick<DeliverableLine, 'agreed' | 'delivered'>[],
): 'DELIVERED' | 'PARTIALLY_DELIVERED' {
  return lines.every((l) => balanceOf(l) === 0)
    ? 'DELIVERED'
    : 'PARTIALLY_DELIVERED';
}

/** What a delivery note shows for one order line: ordered, delivered before, delivered now, and what is still to come. */
export function noteLine(input: {
  ordered: number;
  agreed: number;
  before: number;
  now: number;
}) {
  return {
    ordered: input.ordered,
    before: r3(input.before),
    now: r3(input.now),
    balance: r3(Math.max(0, input.agreed - input.before - input.now)),
  };
}
