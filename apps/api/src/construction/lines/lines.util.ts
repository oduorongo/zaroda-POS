// Power-line work (docs/construction/07): plain functions for client-material balances and section progress.

export type MoveKind = 'RECEIVED' | 'ISSUED' | 'RETURNED' | 'DAMAGED';

/** Per item: what came from the client, went to the works, went back, was damaged, and is left on hand (in thousandths to avoid drift). */
export function clientBalances(moves: { itemId: string; kind: MoveKind; quantity: number }[]) {
  const out = new Map<string, Record<MoveKind | 'onHand', number>>();
  for (const m of moves) {
    const b = out.get(m.itemId) ?? { RECEIVED: 0, ISSUED: 0, RETURNED: 0, DAMAGED: 0, onHand: 0 };
    const q = Math.round(m.quantity * 1000);
    b[m.kind] += q;
    b.onHand += m.kind === 'RECEIVED' ? q : -q;
    out.set(m.itemId, b);
  }
  const back = (v: number) => v / 1000;
  return new Map([...out].map(([k, b]) => [k, { received: back(b.RECEIVED), issued: back(b.ISSUED), returned: back(b.RETURNED), damaged: back(b.DAMAGED), onHand: back(b.onHand) }]));
}

/** Whether a move can be made: issuing, returning or writing off more than is on hand is refused. */
export function moveProblem(kind: MoveKind, quantity: number, onHand: number): string | null {
  if (kind === 'RECEIVED') return null;
  return Math.round(quantity * 1000) > Math.round(onHand * 1000) ? `Only ${onHand} on hand - you cannot ${kind === 'ISSUED' ? 'issue' : kind === 'RETURNED' ? 'return' : 'write off'} ${quantity}.` : null;
}

export const MEASURES = ['poles', 'stays', 'conductorKm', 'transformers', 'services'] as const;
export type Measure = (typeof MEASURES)[number];
export const MEASURE_LABELS: Record<Measure, string> = { poles: 'Poles erected', stays: 'Stays', conductorKm: 'Conductor strung (km)', transformers: 'Transformers', services: 'Service connections' };
const TARGET: Record<Measure, string> = { poles: 'targetPoles', stays: 'targetStays', conductorKm: 'targetConductorKm', transformers: 'targetTransformers', services: 'targetServices' };

/** Done against target for each measure, and the overall % (the average over measures that have a target). */
export function sectionProgress(section: Record<string, unknown>, entries: Partial<Record<Measure, number>>[]) {
  const measures = MEASURES.map((m) => {
    const target = Number(section[TARGET[m]] ?? 0);
    const done = Math.round(entries.reduce((t, e) => t + Number(e[m] ?? 0), 0) * 1000) / 1000;
    return { measure: m, label: MEASURE_LABELS[m], target, done, percent: target > 0 ? Math.min(100, Math.round((done / target) * 100)) : null };
  });
  const withTarget = measures.filter((m) => m.percent !== null);
  return { measures, percent: withTarget.length ? Math.round(withTarget.reduce((t, m) => t + m.percent!, 0) / withTarget.length) : null };
}
