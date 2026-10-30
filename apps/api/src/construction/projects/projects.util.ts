import { ConPermitStatus, ConPermitType, ConProjectStatus, ConRuleMode } from '@prisma/client';

export const STATUS_FLOW: Record<ConProjectStatus, ConProjectStatus[]> = {
  PLANNING: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PRACTICAL_COMPLETION'],
  PRACTICAL_COMPLETION: ['DLP'],
  DLP: ['CLOSED'],
  CLOSED: [],
};

export const PERMIT_LABELS: Record<ConPermitType, string> = {
  NCA_PROJECT_REG: 'NCA project registration / compliance certificate',
  COUNTY_APPROVAL: 'County approved plans',
  BUILDING_PERMIT: 'Building permit',
  NEMA_EIA: 'NEMA EIA licence',
  DOSHS_REG: 'DOSHS workplace registration',
  OCCUPANCY: 'Occupancy certificate',
};
export const PERMIT_TYPES = Object.keys(PERMIT_LABELS) as ConPermitType[];

export interface StatusCheckInput {
  from: ConProjectStatus;
  to: ConProjectStatus;
  permits: Partial<Record<ConPermitType, ConPermitStatus>>;
  ncaProjectRegRule: ConRuleMode;
  wibaValid: boolean;
  bqTotal: number;
  contractSum: number;
  hasClient: boolean;
}

const done = (s?: ConPermitStatus) => s === 'APPROVED';
const settled = (s?: ConPermitStatus) => s === 'APPROVED' || s === 'NOT_REQUIRED';

/** What stops or should make someone think twice before a status change (docs/construction/04). */
export function statusChecks(i: StatusCheckInput): { blocks: string[]; warnings: string[] } {
  const blocks: string[] = [];
  const warnings: string[] = [];
  if (!STATUS_FLOW[i.from].includes(i.to)) {
    blocks.push(`A project cannot go from ${i.from} to ${i.to}. Next: ${STATUS_FLOW[i.from].join(' or ') || 'none - it is closed'}.`);
    return { blocks, warnings };
  }
  if (i.to === 'ACTIVE') {
    if (!done(i.permits.NCA_PROJECT_REG)) (i.ncaProjectRegRule === 'BLOCK' ? blocks : warnings).push('The NCA project registration is not recorded as approved.');
    if (!done(i.permits.COUNTY_APPROVAL)) warnings.push('County approved plans are not recorded.');
    if (!done(i.permits.BUILDING_PERMIT)) warnings.push('The building permit is not recorded.');
    if (!settled(i.permits.NEMA_EIA)) warnings.push('NEMA EIA licence is not recorded (mark it "not required" if it is not needed).');
    if (!settled(i.permits.DOSHS_REG)) warnings.push('DOSHS workplace registration for the site is not recorded.');
    if (!i.wibaValid) warnings.push('There is no valid WIBA insurance in the compliance vault.');
    if (!i.hasClient) warnings.push('No client is set on the project.');
    if (Math.abs(i.bqTotal - i.contractSum) >= 1) warnings.push(`The BQ totals KES ${fmt(i.bqTotal)} but the contract sum is KES ${fmt(i.contractSum)} (difference KES ${fmt(i.bqTotal - i.contractSum)}).`);
  }
  if (i.to === 'CLOSED' && i.from !== 'PLANNING' && !done(i.permits.OCCUPANCY)) warnings.push('The occupancy certificate is not recorded.');
  return { blocks, warnings };
}

const fmt = (n: number) => n.toLocaleString('en-KE', { maximumFractionDigits: 2 });

/** Programme progress: each milestone weighted by its length in days. */
export function programmeProgress(milestones: { startDate: Date; endDate: Date; percentComplete: number }[]): number {
  let days = 0;
  let doneDays = 0;
  for (const m of milestones) {
    const d = Math.max(1, Math.round((m.endDate.getTime() - m.startDate.getTime()) / 86_400_000) + 1);
    days += d;
    doneDays += (d * m.percentComplete) / 100;
  }
  return days ? Math.round((doneDays / days) * 100) : 0;
}

export const nextCode = (prefix: string, existing: string[]) => {
  const n = existing.map((c) => Number(new RegExp(`^${prefix}-(\\d+)$`).exec(c)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
  return `${prefix}-${String(n + 1).padStart(3, '0')}`;
};

// ── BQ import ──

export type Cell = string | number | null;
export interface BqItemRow { code: string | null; description: string; unit: string; qty: number; rate: number; amount: number; row: number }
export interface BqSectionRow { code: string | null; name: string; items: BqItemRow[] }
export interface BqParse { sections: BqSectionRow[]; errors: string[]; warnings: string[]; itemCount: number; total: number }

const MAX_ITEMS = 5000;
const SKIP_ROW = /^(grand\s+)?(total|sub[\s-]?total|carried|collection|brought|summary|page\s+total|to\s+collection)/i;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function toNumber(c: Cell): number | null {
  if (c === null || c === undefined) return null;
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = c.replace(/,/g, '').replace(/^ksh?s?\.?\s*/i, '').trim();
  if (!s || s === '-' || s === '—') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const text = (c: Cell) => (c === null || c === undefined ? '' : String(c).trim());

function findColumns(row: Cell[]) {
  const h = row.map((c) => text(c).toLowerCase());
  const at = (re: RegExp, from = 0) => {
    const i = h.findIndex((x, j) => j >= from && re.test(x));
    return i < 0 ? null : i;
  };
  const description = at(/desc/);
  const qty = at(/^(qty|quantity|quant)/);
  if (description === null || qty === null) return null;
  const rate = at(/^rate/);
  return {
    code: at(/^(item|ref|code|no\.?|s\/?\s?no\.?|#)$/),
    description,
    unit: at(/^unit/),
    qty,
    rate,
    amount: at(/^(amount|total|kshs?\.?|ksh\.?|sum)/, rate === null ? 0 : rate + 1),
  };
}

/**
 * Reads BQ sheets: finds the header row (Description + Qty), then every row is a section heading (text, no unit or figures)
 * or an item (description + unit, with qty and rate - or just an amount for a lump-sum "Item"). Totals and carried-forward
 * rows are skipped. Amount is always qty x rate; a sheet amount that differs is reported.
 */
export function parseBq(sheets: { name: string; rows: Cell[][] }[]): BqParse {
  const sections: BqSectionRow[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  let itemCount = 0;
  let headerFound = false;

  for (const sheet of sheets) {
    const headerAt = sheet.rows.findIndex((r) => findColumns(r) !== null);
    if (headerAt < 0) continue;
    headerFound = true;
    const col = findColumns(sheet.rows[headerAt])!;
    let current: BqSectionRow | null = null;
    const where = (i: number) => `${sheets.length > 1 ? `${sheet.name} ` : ''}row ${i + 1}`;

    for (let i = headerAt + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i];
      const get = (k: number | null) => (k === null ? null : r[k] ?? null);
      const description = text(get(col.description));
      const unit = text(get(col.unit));
      const qty = toNumber(get(col.qty));
      const rate = toNumber(get(col.rate));
      const amountCell = toNumber(get(col.amount));
      const code = text(get(col.code)) || null;
      if (!description && !unit && qty === null && rate === null && amountCell === null) continue;
      if (!description) {
        if (qty !== null || rate !== null) errors.push(`${where(i)}: has figures but no description.`);
        continue;
      }
      if (!unit && qty === null && rate === null) {
        if (SKIP_ROW.test(description)) continue;
        current = { code, name: description.slice(0, 200), items: [] };
        sections.push(current);
        continue;
      }
      if (!unit) {
        errors.push(`${where(i)}: "${description.slice(0, 40)}" needs a unit.`);
        continue;
      }
      let q = qty;
      let rt = rate;
      if (q === null && rt === null && amountCell !== null) {
        q = 1;
        rt = amountCell;
      }
      if (q === null || rt === null) {
        errors.push(`${where(i)}: "${description.slice(0, 40)}" needs a quantity and a rate.`);
        continue;
      }
      if (q < 0 || rt < 0) {
        errors.push(`${where(i)}: quantity and rate cannot be negative.`);
        continue;
      }
      const amount = round2(q * rt);
      if (amountCell !== null && Math.abs(amountCell - amount) > 1) warnings.push(`${where(i)}: the sheet says ${amountCell} but ${q} x ${rt} = ${amount}; ${amount} is used.`);
      if (!current) {
        current = { code: null, name: sheet.name || 'General', items: [] };
        sections.push(current);
      }
      current.items.push({ code, description: description.slice(0, 1000), unit: unit.slice(0, 20), qty: q, rate: rt, amount, row: i + 1 });
      itemCount++;
    }
  }

  if (!headerFound) errors.push('No header row found. The sheet needs columns named Description and Qty (and Unit, Rate, Amount).');
  if (itemCount > MAX_ITEMS) errors.push(`The BQ has ${itemCount} items; the most one import takes is ${MAX_ITEMS}.`);
  const kept = sections.filter((s) => s.items.length > 0);
  if (headerFound && itemCount === 0) errors.push('No BQ items were found under the header row.');
  return { sections: kept, errors, warnings, itemCount, total: round2(kept.reduce((a, s) => a + s.items.reduce((b, it) => b + it.amount, 0), 0)) };
}

/** A small CSV reader (quotes, commas inside quotes, CRLF) for BQs saved from Excel as CSV. */
export function parseCsv(input: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => (c === '' ? null : c)));
}
