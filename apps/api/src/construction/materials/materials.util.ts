const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const round = (n: number, dp = 3) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * Who may approve an order: never the person who raised it (segregation of duties), and only up to their approval limit.
 * limit null = unlimited (Director). When the plan has no approval limits, only the first rule applies.
 */
export function approvalProblem(i: { total: number; createdBy: string; approverId: string; limit: number | null; limitsOn: boolean }): string | null {
  if (i.createdBy === i.approverId) return 'You raised this, so someone else must approve it.';
  if (i.limitsOn && i.limit !== null && i.total > i.limit) {
    return `${kes(i.total)} is above your approval limit of ${kes(i.limit)}. A Contracts Manager or the Director must approve it.`;
  }
  return null;
}

export interface ReconInput { budget: number | null; ordered: number; delivered: number; used: number; wasted: number; onHand: number }

/** One material on one project: BQ allowance against what was ordered, delivered, used, wasted and is left on site. */
export function reconcile(r: ReconInput) {
  const issued = r.used + r.wasted;
  return {
    ...r,
    issued: round(issued),
    toDeliver: round(Math.max(r.ordered - r.delivered, 0)),
    budgetLeft: r.budget === null ? null : round(r.budget - issued),
    wastagePercent: issued > 0 ? Math.round((r.wasted / issued) * 1000) / 10 : 0,
    overBudget: r.budget !== null && (r.ordered > r.budget || issued > r.budget),
    unaccounted: round(r.delivered - issued - r.onHand),
  };
}

export interface PlantLogLike { hours: number; fuelLitres: number | null; fuelCost: number | null }

/** Cost of a piece of plant over its logs: hire (per hour or per day worked) plus fuel. Owned plant costs only its fuel. */
export function plantCost(plant: { ownership: 'OWNED' | 'HIRED'; hireRate: number | null; rateUnit: 'HOUR' | 'DAY' }, logs: PlantLogLike[]) {
  const hours = logs.reduce((a, l) => a + l.hours, 0);
  const days = logs.filter((l) => l.hours > 0).length;
  const fuelLitres = logs.reduce((a, l) => a + (l.fuelLitres ?? 0), 0);
  const fuelCost = logs.reduce((a, l) => a + (l.fuelCost ?? 0), 0);
  const rate = plant.ownership === 'HIRED' ? plant.hireRate ?? 0 : 0;
  const hireCost = Math.round((plant.rateUnit === 'HOUR' ? hours : days) * rate * 100) / 100;
  return { hours: round(hours, 1), days, fuelLitres: round(fuelLitres, 2), fuelCost: round(fuelCost, 2), hireCost, total: Math.round((hireCost + fuelCost) * 100) / 100 };
}
