import { Workbook } from 'exceljs';
import { ConRoleCode } from '@prisma/client';

export type ColType = 'text' | 'money' | 'number' | 'percent' | 'date';
export interface Column { key: string; label: string; type?: ColType }
export type Row = Record<string, string | number | null>;
export interface Report { key: ReportKey; title: string; subtitle: string; columns: Column[]; rows: Row[]; totals?: Row; notes?: string[] }

const MONEY_ROLES: ConRoleCode[] = ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROJECT_MGR'];

/** Each report: who may run it (Director always may; project roles see only their projects) and whether it needs the full_reports feature. */
export const REPORTS = {
  cost: { title: 'Project cost vs BQ budget', full: false, roles: MONEY_ROLES },
  cashflow: { title: 'Cash flow', full: true, roles: MONEY_ROLES },
  ipc: { title: 'IPC & retention summary', full: false, roles: MONEY_ROLES },
  materials: { title: 'Material reconciliation', full: false, roles: [...MONEY_ROLES, 'CON_PROCUREMENT', 'CON_SITE_ENGINEER'] as ConRoleCode[] },
  labour: { title: 'Labour cost per project', full: true, roles: ['CON_CONTRACTS_MGR', 'CON_ACCOUNTANT', 'CON_PROJECT_MGR'] as ConRoleCode[] },
  compliance: { title: 'Compliance expiries', full: false, roles: ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_PROCUREMENT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', 'CON_PROJECT_MGR'] as ConRoleCode[] },
  safety: { title: 'Safety statistics', full: false, roles: ['CON_CONTRACTS_MGR', 'CON_COMPLIANCE', 'CON_SHE_OFFICER', 'CON_PROJECT_MGR', 'CON_SITE_ENGINEER'] as ConRoleCode[] },
  nca: { title: 'NCA category utilisation', full: true, roles: ['CON_CONTRACTS_MGR', 'CON_QS', 'CON_ACCOUNTANT', 'CON_COMPLIANCE'] as ConRoleCode[] },
} as const;
export type ReportKey = keyof typeof REPORTS;
export const REPORT_KEYS = Object.keys(REPORTS) as ReportKey[];
export const REPORT_ROLES = [...new Set(REPORT_KEYS.flatMap((k) => REPORTS[k].roles))];

export const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? r2((part / whole) * 100) : null);

/** Costs to date against the budget (revised sum, else contract sum) and what has been certified. */
export function costRow(i: { budget: number; materials: number; labour: number; plant: number; subcontracts: number; certified: number }) {
  const cost = r2(i.materials + i.labour + i.plant + i.subcontracts);
  return { cost, budgetUsed: pct(cost, i.budget), remaining: r2(i.budget - cost), margin: r2(i.certified - cost), marginPct: pct(i.certified - cost, i.certified) };
}

/** "2026-10" in Nairobi time. */
export const monthKey = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 7);

export interface Flow { month: string; kind: 'IPC' | 'WAGES' | 'SUBCONTRACTS' | 'MATERIALS' | 'PLANT'; amount: number }
const OUT_KINDS = ['WAGES', 'SUBCONTRACTS', 'MATERIALS', 'PLANT'] as const;

/** Money in (IPC payments received) and out (wages, subcontractors, materials delivered, plant) per month, with the running balance. */
export function cashflowRows(flows: Flow[]) {
  const months = [...new Set(flows.map((f) => f.month))].sort();
  let running = 0;
  return months.map((month) => {
    const sum = (k: Flow['kind']) => r2(flows.filter((f) => f.month === month && f.kind === k).reduce((a, f) => a + f.amount, 0));
    const inflow = sum('IPC');
    const parts = Object.fromEntries(OUT_KINDS.map((k) => [k.toLowerCase(), sum(k)])) as Record<Lowercase<(typeof OUT_KINDS)[number]>, number>;
    const outflow = r2(OUT_KINDS.reduce((a, k) => a + sum(k), 0));
    running = r2(running + inflow - outflow);
    return { month, inflow, ...parts, outflow, net: r2(inflow - outflow), running };
  });
}

/** Lost-time injury frequency rate: lost-time and fatal incidents per million hours worked. */
export const ltifr = (lostTime: number, hours: number) => (hours > 0 ? r2((lostTime * 1_000_000) / hours) : null);

/** Per works class: the registered category's cap against the biggest open contract and tender. */
export function ncaRow(i: { cap: number | null; values: number[]; tenders: number[] }) {
  const largest = i.values.length ? Math.max(...i.values) : 0;
  const largestTender = i.tenders.length ? Math.max(...i.tenders) : 0;
  return {
    projects: i.values.length,
    activeValue: r2(i.values.reduce((a, v) => a + v, 0)),
    largest,
    used: i.cap === null ? null : pct(largest, i.cap),
    openTenders: i.tenders.length,
    largestTender,
    headroom: i.cap === null ? null : r2(i.cap - Math.max(largest, largestTender)),
  };
}

/** Totals row: sums the money/number columns named. */
export function totalsOf(rows: Row[], keys: string[], label: Row = {}): Row {
  return { ...label, ...Object.fromEntries(keys.map((k) => [k, r2(rows.reduce((a, r) => a + (typeof r[k] === 'number' ? (r[k] as number) : 0), 0))])) };
}

const SAFE_SHEET = /[\\/?*[\]:]/g;

/** One sheet, brand-coloured header, money as numbers with thousands separators. */
export async function reportXlsx(report: Report, company: string): Promise<Buffer> {
  const wb = new Workbook();
  const ws = wb.addWorksheet(report.title.replace(SAFE_SHEET, ' ').slice(0, 31));
  ws.addRow([company]).font = { bold: true, size: 14 };
  ws.addRow([report.title]).font = { bold: true, size: 12 };
  ws.addRow([report.subtitle]);
  ws.addRow([]);
  const head = ws.addRow(report.columns.map((c) => c.label));
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2E5A' } };
  });
  const add = (r: Row) => ws.addRow(report.columns.map((c) => r[c.key] ?? ''));
  report.rows.forEach(add);
  if (report.totals) add(report.totals).font = { bold: true };
  report.columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = Math.min(Math.max(c.label.length + 2, c.type === 'text' || !c.type ? 18 : 14), 48);
    if (c.type === 'money') col.numFmt = '#,##0.00';
    if (c.type === 'percent') col.numFmt = '0.0"%"';
  });
  for (const n of report.notes ?? []) ws.addRow([n]).font = { italic: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** How far through the contract period a date is, 0-100. null without both dates. */
export function elapsedPct(start: string | null, end: string | null, today: string): number | null {
  if (!start || !end) return null;
  const s = Date.parse(`${start}T00:00:00Z`);
  const total = Date.parse(`${end}T00:00:00Z`) - s;
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round(((Date.parse(`${today}T00:00:00Z`) - s) / total) * 100)));
}

/** Behind when the programme is more than 10 points behind the time used. */
export const scheduleState = (progress: number, elapsed: number | null) => (elapsed === null ? 'UNKNOWN' : progress + 10 < elapsed ? 'BEHIND' : 'ON_TRACK');
