import { FarmFeatureKey } from './farm-plans.util';

export type ColType = 'text' | 'money' | 'number' | 'date';
export interface Column { key: string; label: string; type?: ColType }
export type Row = Record<string, string | number | null>;
export interface FarmReport { key: FarmReportKey; title: string; subtitle: string; columns: Column[]; rows: Row[]; totals?: Row; notes?: string[] }

/** The farm reports, the plan feature each needs, and whether it covers a period. */
export const FARM_REPORTS = {
  enterprises: { title: 'Profit per enterprise', feature: 'reports_full', period: true },
  'unit-costs': { title: 'Cost per litre, egg, kg and acre', feature: 'reports_full', period: true },
  herd: { title: 'Herd register', feature: 'reports_basic', period: false },
  breeding: { title: 'Breeding calendar', feature: 'reports_basic', period: false },
  health: { title: 'Health and withdrawal register', feature: 'reports_basic', period: true },
  crops: { title: 'Crop report', feature: 'reports_basic', period: true },
  wages: { title: 'Wages by worker', feature: 'reports_full', period: true },
  debtors: { title: 'Buyers who owe the farm', feature: 'reports_full', period: false },
  valuation: { title: 'Animal valuation and suggested prices', feature: 'reports_basic', period: false },
} as const satisfies Record<string, { title: string; feature: FarmFeatureKey; period: boolean }>;
export type FarmReportKey = keyof typeof FARM_REPORTS;
export const FARM_REPORT_KEYS = Object.keys(FARM_REPORTS) as FarmReportKey[];

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Totals of the numeric columns, with a label in the first column. */
export function totalsOf(rows: Row[], columns: Column[], label = 'Total'): Row {
  const out: Row = { [columns[0].key]: label };
  for (const c of columns.slice(1)) {
    if (c.type !== 'money' && c.type !== 'number') continue;
    out[c.key] = r2(rows.reduce((a, r) => a + (typeof r[c.key] === 'number' ? (r[c.key] as number) : 0), 0));
  }
  return out;
}

export interface EnterpriseMoney {
  income: number;
  feed: number;
  vet: number;
  labour: number;
  field: number;
  stock: number;
}
export const emptyMoney = (): EnterpriseMoney => ({ income: 0, feed: 0, vet: 0, labour: 0, field: 0, stock: 0 });
export const costOf = (m: EnterpriseMoney) => r2(m.feed + m.vet + m.labour + m.field + m.stock);
export const profitOf = (m: EnterpriseMoney) => r2(m.income - costOf(m));

/** Cost (or income) per unit made; null when nothing was made. */
export const perUnit = (amount: number, made: number): number | null => (made > 0 ? r2(amount / made) : null);
