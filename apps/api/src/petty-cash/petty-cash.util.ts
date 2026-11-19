const round2 = (n: number) => Math.round(n * 100) / 100;

export interface CashMove {
  kind: 'PAYMENT' | 'TOP_UP' | 'COUNT';
  amount: number;
  voided: boolean;
}

/** What should be in the box: top-ups in, payments out, count differences either way. Voided entries do not count. */
export function boxBalance(moves: CashMove[]): number {
  return round2(
    moves
      .filter((m) => !m.voided)
      .reduce((t, m) => t + (m.kind === 'PAYMENT' ? -m.amount : m.amount), 0),
  );
}

/** A top-up brings the box back to its float; nothing is needed when it is already there. */
export function topUpNeeded(floatAmount: number, balance: number): number {
  return round2(Math.max(0, floatAmount - balance));
}

/** One line of the petty cash book: what came in, what went out, and the balance after it (oldest first). */
export function withBalance<T extends CashMove>(opening: number, moves: T[]): (T & { moneyIn: number; moneyOut: number; balance: number })[] {
  let bal = opening;
  return moves.map((m) => {
    const delta = m.voided ? 0 : m.kind === 'PAYMENT' ? -m.amount : m.amount;
    bal = round2(bal + delta);
    return { ...m, moneyIn: delta > 0 ? delta : 0, moneyOut: delta < 0 ? -delta : 0, balance: bal };
  });
}
