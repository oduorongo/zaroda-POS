const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** The materials a job needs: each recipe line x the number of pieces. */
export function materialsFor(
  recipe: { variantId: string; quantity: number }[],
  pieces: number,
): { variantId: string; quantity: number }[] {
  return recipe.map((r) => ({ variantId: r.variantId, quantity: round3(r.quantity * pieces) }));
}

/** What the materials handed out cost in all (lines with no cost count as nothing, and are reported). */
export function materialsCost(lines: { quantity: number; unitCost: number | null }[]): { total: number; uncosted: number } {
  return {
    total: round2(lines.reduce((t, l) => t + (l.unitCost ?? 0) * l.quantity, 0)),
    uncosted: lines.filter((l) => l.unitCost === null).length,
  };
}

/** One good piece: its share of the materials plus the tailor's rate. */
export function pieceCost(job: { materialsCost: number; quantity: number; ratePerPiece: number }): number {
  return round2(job.materialsCost / job.quantity + job.ratePerPiece);
}

/** Checks a hand-in against what is still with the tailor; returns the problem, or null. */
export function handInProblem(
  job: { quantity: number; quantityGood: number; quantityRejected: number },
  goodQty: number,
  rejectedQty: number,
): string | null {
  if (goodQty + rejectedQty < 1) return 'Enter how many pieces were handed in';
  const left = job.quantity - job.quantityGood - job.quantityRejected;
  if (goodQty + rejectedQty > left) return `Only ${left} piece${left === 1 ? ' is' : 's are'} still with the tailor on this job`;
  return null;
}

/** A tailor's account: earned from hand-ins, paid (voided payments left out), and what is owed (negative = paid in advance). */
export function tailorBalance(
  handIns: { labourAmount: number }[],
  payments: { amount: number; voided: boolean }[],
): { earned: number; paid: number; owed: number } {
  const earned = round2(handIns.reduce((t, h) => t + h.labourAmount, 0));
  const paid = round2(payments.filter((p) => !p.voided).reduce((t, p) => t + p.amount, 0));
  return { earned, paid, owed: round2(earned - paid) };
}
