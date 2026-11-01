import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConProject, ConRoleCode, Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx, isDirector, upgradeError } from '../common/con-access';
import { DOC_LABELS, WORKS_CLASS_LABELS, daysLeft, expiryState, todayKey } from '../compliance/compliance.util';
import { ReportQueryDto } from '../dto/query.dto';
import { plantCost } from '../materials/materials.util';
import { MaterialsService } from '../materials/materials.service';
import { PERMIT_LABELS } from '../projects/projects.util';
import { dayValue } from '../site/site.util';
import { Column, Flow, REPORTS, REPORT_KEYS, Report, ReportKey, Row, cashflowRows, costRow, ltifr, monthKey, ncaRow, r2, totalsOf } from './reports.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const DONE = ['CERTIFIED', 'PAID'] as const;
const STATUS: Record<string, string> = { PLANNING: 'Planning', ACTIVE: 'Active', PRACTICAL_COMPLETION: 'Practical completion', DLP: 'Defects period', CLOSED: 'Closed' };
const HOURS_PER_DAY = 8;

type P = Pick<ConProject, 'id' | 'code' | 'name' | 'status' | 'contractSum' | 'revisedSum' | 'branchId' | 'worksClass'>;
const budgetOf = (p: P) => n(p.revisedSum ?? p.contractSum);
const label = (p: P) => ({ code: p.code, project: p.name });
const PROJECT_COLS: Column[] = [{ key: 'code', label: 'Code' }, { key: 'project', label: 'Project' }];

/** Reports (docs/construction/01 s10): each one is a table, shown on screen, printed to PDF or downloaded as Excel. */
@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly materials: MaterialsService,
  ) {}

  /** Which reports this person may run, and which their plan locks. */
  catalog(con: ConContext) {
    return REPORT_KEYS.filter((k) => this.allowed(con, k)).map((k) => ({ key: k, title: REPORTS[k].title, locked: REPORTS[k].full && !con.plan.features.includes('full_reports') }));
  }

  private allowed(con: ConContext, key: ReportKey) {
    const roles = REPORTS[key].roles as readonly ConRoleCode[];
    return isDirector(con) || con.companyRoles.some((r) => roles.includes(r)) || con.projectRoles.some((p) => roles.includes(p.role));
  }

  /** Company-wide holders of the report's roles see every project; project roles see only theirs. */
  private scope(con: ConContext, key: ReportKey): string[] | 'ALL' {
    const roles = REPORTS[key].roles as readonly ConRoleCode[];
    if (isDirector(con) || con.companyRoles.some((r) => roles.includes(r))) return 'ALL';
    return [...new Set(con.projectRoles.filter((p) => roles.includes(p.role)).map((p) => p.projectId))];
  }

  async run(con: ConContext, key: ReportKey, q: ReportQueryDto, exporting = false): Promise<Report> {
    if (!REPORT_KEYS.includes(key)) throw new NotFoundException('No such report');
    if (!this.allowed(con, key)) throw new ForbiddenException('Your construction role does not allow this report.');
    const full = con.plan.features.includes('full_reports');
    if ((REPORTS[key].full || exporting) && !full) {
      throw upgradeError(`${exporting ? 'Exporting reports' : `The ${REPORTS[key].title} report`} is not on your ${con.plan.name} plan. Upgrade to Contractor for full reports and Excel/PDF export.`, { feature: 'full_reports', requiredPlan: 'CON_CONTRACTOR' });
    }
    const scope = this.scope(con, key);
    if (q.projectId && scope !== 'ALL' && !scope.includes(q.projectId)) throw new ForbiddenException('You are not on this project.');
    return this.tenantPrisma.run(async (tx) => {
      const projects = await tx.conProject.findMany({
        where: { ...(q.projectId ? { id: q.projectId } : {}), ...(scope === 'ALL' ? {} : { id: { in: q.projectId ? [q.projectId] : scope } }) },
        orderBy: { code: 'asc' },
      });
      if (q.projectId && !projects.length) throw new NotFoundException('Project not found');
      const build = { cost: this.costReport, cashflow: this.cashflowReport, ipc: this.ipcReport, materials: this.materialsReport, labour: this.labourReport, compliance: this.complianceReport, safety: this.safetyReport, nca: this.ncaReport }[key];
      return build.call(this, tx, projects, q, scope);
    });
  }

  private range(q: ReportQueryDto) {
    return { gte: q.from ? date(q.from) : undefined, lte: q.to ? date(q.to) : undefined };
  }

  private subtitle(projects: P[], q: ReportQueryDto, fallback = 'To date') {
    const who = projects.length === 1 ? `${projects[0].code} ${projects[0].name}` : `${projects.length} projects`;
    const when = q.from || q.to ? `${q.from ?? 'start'} to ${q.to ?? todayKey()}` : fallback;
    return `${who} · ${when} · printed ${todayKey()}`;
  }

  // ── Building blocks shared with the dashboards ──

  async materialsCost(tx: Tx, projects: P[], range?: { gte?: Date; lte?: Date }) {
    const branches = new Map(projects.filter((p) => p.branchId).map((p) => [p.branchId!, p.id]));
    const receipts = branches.size ? await tx.goodsReceipt.findMany({ where: { branchId: { in: [...branches.keys()] }, ...(range ? { createdAt: range } : {}) }, include: { lines: true } }) : [];
    const out = new Map<string, number>();
    const flows: { projectId: string; at: Date; amount: number }[] = [];
    for (const g of receipts) {
      const amount = g.lines.reduce((a, l) => a + n(l.quantityAccepted) * n(l.unitCost), 0);
      const projectId = branches.get(g.branchId)!;
      out.set(projectId, r2((out.get(projectId) ?? 0) + amount));
      flows.push({ projectId, at: g.createdAt, amount });
    }
    return { byProject: out, flows };
  }

  async plantCosts(tx: Tx, projectIds: string[], range?: { gte?: Date; lte?: Date }) {
    const logs = await tx.conPlantLog.findMany({ where: { projectId: { in: projectIds }, ...(range ? { date: range } : {}) }, include: { plant: true } });
    const out = new Map<string, number>();
    const flows: { projectId: string; at: Date; amount: number }[] = [];
    for (const l of logs) {
      const amount = plantCost({ ownership: l.plant.ownership, hireRate: l.plant.hireRate === null ? null : n(l.plant.hireRate), rateUnit: l.plant.rateUnit }, [{ hours: n(l.hours), fuelLitres: l.fuelLitres === null ? null : n(l.fuelLitres), fuelCost: l.fuelCost === null ? null : n(l.fuelCost) }]).total;
      out.set(l.projectId, r2((out.get(l.projectId) ?? 0) + amount));
      flows.push({ projectId: l.projectId, at: l.date, amount });
    }
    return { byProject: out, flows };
  }

  /** Labour per project: approved/paid payroll for the days it covers, plus the muster at day rates for days no run covers yet. */
  async labour(tx: Tx, projectIds: string[], range?: { gte?: Date; lte?: Date }) {
    const [muster, runs] = await Promise.all([
      tx.conMuster.findMany({ where: { projectId: { in: projectIds }, status: { not: 'ABSENT' }, ...(range ? { date: range } : {}) }, select: { projectId: true, workerId: true, date: true, status: true, hours: true, worker: { select: { dailyRate: true } } } }),
      tx.conPayrollRun.findMany({ where: { projectId: { in: projectIds }, ...(range ? { periodEnd: range } : {}) }, include: { lines: { select: { gross: true, deductions: true, net: true, status: true } } } }),
    ]);
    const out = new Map<string, { days: number; hours: number; workers: Set<string>; uncovered: number; gross: number; deductions: number; paid: number; unpaid: number }>();
    const get = (id: string) => out.get(id) ?? out.set(id, { days: 0, hours: 0, workers: new Set(), uncovered: 0, gross: 0, deductions: 0, paid: 0, unpaid: 0 }).get(id)!;
    const counted = runs.filter((r) => r.status !== 'DRAFT');
    for (const m of muster) {
      const s = get(m.projectId);
      const v = dayValue(m.status);
      s.days += v;
      s.hours += m.hours === null ? v * HOURS_PER_DAY : n(m.hours);
      s.workers.add(m.workerId);
      if (!counted.some((r) => r.projectId === m.projectId && r.periodStart <= m.date && r.periodEnd >= m.date)) s.uncovered += v * n(m.worker.dailyRate);
    }
    for (const r of runs) {
      const s = get(r.projectId);
      for (const l of r.lines) {
        if (r.status !== 'DRAFT') {
          s.gross += n(l.gross);
          s.deductions += n(l.deductions);
        }
        if (l.status === 'PAID') s.paid += n(l.net);
        else s.unpaid += n(l.net);
      }
    }
    return new Map([...out].map(([id, s]) => [id, { days: s.days, hours: r2(s.hours), workers: s.workers.size, uncovered: r2(s.uncovered), gross: r2(s.gross), deductions: r2(s.deductions), paid: r2(s.paid), unpaid: r2(s.unpaid), cost: r2(s.gross + s.uncovered) }]));
  }

  async subcontractCost(tx: Tx, projectIds: string[]) {
    const subs = await tx.conSubcontract.findMany({ where: { projectId: { in: projectIds } }, include: { valuations: { where: { status: { in: ['APPROVED', 'PAID'] } }, orderBy: { number: 'desc' }, take: 1 } } });
    const out = new Map<string, number>();
    for (const s of subs) out.set(s.projectId, r2((out.get(s.projectId) ?? 0) + n(s.valuations[0]?.grossToDate)));
    return out;
  }

  /** Gross certified on the latest standing certificate, and the net certified across all of them (reversals included). */
  async certified(tx: Tx, projectIds: string[]) {
    const vals = await tx.conValuation.findMany({ where: { projectId: { in: projectIds }, status: { in: [...DONE] } }, orderBy: { number: 'asc' } });
    const out = new Map<string, { gross: number; net: number; count: number }>();
    for (const id of projectIds) {
      const mine = vals.filter((v) => v.projectId === id);
      const last = mine.filter((v) => v.kind === 'VALUATION' && !v.reversed).pop();
      out.set(id, { gross: n(last?.grossToDate), net: r2(mine.reduce((a, v) => a + n(v.netDue), 0)), count: mine.filter((v) => v.kind === 'VALUATION').length });
    }
    return out;
  }

  async costs(tx: Tx, projects: P[]) {
    const ids = projects.map((p) => p.id);
    const [materials, plant, labour, subs, certified, bq] = await Promise.all([
      this.materialsCost(tx, projects),
      this.plantCosts(tx, ids),
      this.labour(tx, ids),
      this.subcontractCost(tx, ids),
      this.certified(tx, ids),
      tx.conBqItem.groupBy({ by: ['projectId'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
    ]);
    return new Map(projects.map((p) => {
      const parts = { materials: materials.byProject.get(p.id) ?? 0, labour: labour.get(p.id)?.cost ?? 0, plant: plant.byProject.get(p.id) ?? 0, subcontracts: subs.get(p.id) ?? 0 };
      const cert = certified.get(p.id)!;
      return [p.id, { budget: budgetOf(p), bqTotal: n(bq.find((b) => b.projectId === p.id)?._sum.amount), ...parts, certified: cert.gross, ...costRow({ budget: budgetOf(p), ...parts, certified: cert.gross }) }];
    }));
  }

  // ── The reports ──

  private async costReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const costs = await this.costs(tx, projects);
    const rows = projects.map((p) => ({ ...label(p), status: STATUS[p.status], ...costs.get(p.id)! }));
    const money = ['budget', 'bqTotal', 'materials', 'labour', 'plant', 'subcontracts', 'cost', 'remaining', 'certified', 'margin'];
    return {
      key: 'cost', title: REPORTS.cost.title, subtitle: this.subtitle(projects, q),
      columns: [...PROJECT_COLS, { key: 'status', label: 'Status' }, { key: 'budget', label: 'Budget (revised sum)', type: 'money' }, { key: 'bqTotal', label: 'BQ total', type: 'money' }, { key: 'materials', label: 'Materials delivered', type: 'money' }, { key: 'labour', label: 'Labour', type: 'money' }, { key: 'plant', label: 'Plant & fuel', type: 'money' }, { key: 'subcontracts', label: 'Subcontracts', type: 'money' }, { key: 'cost', label: 'Cost to date', type: 'money' }, { key: 'budgetUsed', label: 'Budget used', type: 'percent' }, { key: 'remaining', label: 'Budget left', type: 'money' }, { key: 'certified', label: 'Certified to date', type: 'money' }, { key: 'margin', label: 'Margin', type: 'money' }, { key: 'marginPct', label: 'Margin %', type: 'percent' }],
      rows, totals: rows.length > 1 ? totalsOf(rows, money, { code: 'Total' }) : undefined,
      notes: ['Materials at delivered cost; labour from approved pay runs plus the muster at day rates for days not yet on a pay run; subcontracts at the latest approved valuation.'],
    };
  }

  private async cashflowReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const ids = projects.map((p) => p.id);
    const from = q.from ?? `${monthKey(new Date(Date.now() - 335 * 86_400_000))}-01`;
    const range = { gte: date(from), lte: q.to ? new Date(date(q.to).getTime() + 86_399_999) : undefined };
    const [receipts, wages, subs, materials, plant] = await Promise.all([
      tx.conValuationReceipt.findMany({ where: { kind: 'PAYMENT', receivedAt: range, valuation: { projectId: { in: ids } } } }),
      tx.conPayrollLine.findMany({ where: { status: 'PAID', paidAt: range, run: { projectId: { in: ids } } }, select: { net: true, paidAt: true } }),
      tx.conSubValuation.findMany({ where: { status: 'PAID', paidAt: range, subcontract: { projectId: { in: ids } } }, select: { netDue: true, paidAt: true } }),
      this.materialsCost(tx, projects, range),
      this.plantCosts(tx, ids, range),
    ]);
    const flows: Flow[] = [
      ...receipts.map((r) => ({ month: monthKey(r.receivedAt), kind: 'IPC' as const, amount: n(r.amount) })),
      ...wages.map((w) => ({ month: monthKey(w.paidAt!), kind: 'WAGES' as const, amount: n(w.net) })),
      ...subs.map((s) => ({ month: monthKey(s.paidAt!), kind: 'SUBCONTRACTS' as const, amount: n(s.netDue) })),
      ...materials.flows.map((m) => ({ month: monthKey(m.at), kind: 'MATERIALS' as const, amount: m.amount })),
      ...plant.flows.map((p) => ({ month: monthKey(p.at), kind: 'PLANT' as const, amount: p.amount })),
    ];
    const rows = cashflowRows(flows);
    const outstanding = await tx.conValuation.findMany({ where: { projectId: { in: ids }, status: 'CERTIFIED', invoiceTotal: { not: null } }, include: { receipts: true } });
    const owed = r2(outstanding.reduce((a, v) => a + n(v.invoiceTotal) - v.receipts.reduce((s, r) => s + n(r.amount), 0), 0));
    return {
      key: 'cashflow', title: REPORTS.cashflow.title, subtitle: this.subtitle(projects, { ...q, from }),
      columns: [{ key: 'month', label: 'Month' }, { key: 'inflow', label: 'IPC payments in', type: 'money' }, { key: 'wages', label: 'Wages paid', type: 'money' }, { key: 'subcontracts', label: 'Subcontractors paid', type: 'money' }, { key: 'materials', label: 'Materials delivered', type: 'money' }, { key: 'plant', label: 'Plant & fuel', type: 'money' }, { key: 'outflow', label: 'Total out', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }, { key: 'running', label: 'Running balance', type: 'money' }],
      rows, totals: rows.length ? totalsOf(rows, ['inflow', 'wages', 'subcontracts', 'materials', 'plant', 'outflow', 'net'], { month: 'Total' }) : undefined,
      notes: [`Still to come in on invoiced IPCs (after withholding certificates): KES ${owed.toLocaleString('en-KE')}.`, 'Materials are counted when delivered, not when the supplier is paid.'],
    };
  }

  private async ipcReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const ids = projects.map((p) => p.id);
    const [vals, retention, vos] = await Promise.all([
      tx.conValuation.findMany({ where: { projectId: { in: ids } }, include: { receipts: true }, orderBy: { number: 'asc' } }),
      tx.conRetentionEntry.groupBy({ by: ['projectId', 'type'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
      tx.conVariation.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: 'APPROVED' }, _sum: { amount: true } }),
    ]);
    const rows = projects.map((p) => {
      const mine = vals.filter((v) => v.projectId === p.id);
      const done = mine.filter((v) => (DONE as readonly string[]).includes(v.status));
      const last = done.filter((v) => v.kind === 'VALUATION' && !v.reversed).pop();
      const rec = (k: string) => r2(mine.flatMap((v) => v.receipts).filter((r) => r.kind === k).reduce((a, r) => a + n(r.amount), 0));
      const invoiced = r2(mine.reduce((a, v) => a + n(v.invoiceTotal), 0));
      const ret = (t: 'DEDUCT' | 'RELEASE') => n(retention.find((r) => r.projectId === p.id && r.type === t)?._sum.amount);
      const received = rec('PAYMENT');
      const wht = r2(rec('WHT') + rec('WHT_VAT'));
      return {
        ...label(p), contractSum: n(p.contractSum), variations: n(vos.find((v) => v.projectId === p.id)?._sum.amount), revisedSum: budgetOf(p),
        ipcs: done.filter((v) => v.kind === 'VALUATION').length, pending: mine.filter((v) => v.status === 'SUBMITTED' || v.status === 'DRAFT').length,
        grossCertified: n(last?.grossToDate), netCertified: r2(done.reduce((a, v) => a + n(v.netDue), 0)), invoiced, received, wht, outstanding: r2(invoiced - received - wht),
        retentionHeld: r2(ret('DEDUCT') - ret('RELEASE')), retentionReleased: ret('RELEASE'), lastIpc: day(last?.certifiedAt),
      };
    });
    const money = ['contractSum', 'variations', 'revisedSum', 'grossCertified', 'netCertified', 'invoiced', 'received', 'wht', 'outstanding', 'retentionHeld', 'retentionReleased'];
    return {
      key: 'ipc', title: REPORTS.ipc.title, subtitle: this.subtitle(projects, q),
      columns: [...PROJECT_COLS, { key: 'contractSum', label: 'Contract sum', type: 'money' }, { key: 'variations', label: 'Approved variations', type: 'money' }, { key: 'revisedSum', label: 'Revised sum', type: 'money' }, { key: 'ipcs', label: 'IPCs certified', type: 'number' }, { key: 'pending', label: 'Awaiting', type: 'number' }, { key: 'grossCertified', label: 'Gross certified', type: 'money' }, { key: 'netCertified', label: 'Net certified', type: 'money' }, { key: 'invoiced', label: 'Invoiced (with VAT)', type: 'money' }, { key: 'received', label: 'Received', type: 'money' }, { key: 'wht', label: 'Withholding certs', type: 'money' }, { key: 'outstanding', label: 'Outstanding', type: 'money' }, { key: 'retentionHeld', label: 'Retention held', type: 'money' }, { key: 'retentionReleased', label: 'Retention released', type: 'money' }, { key: 'lastIpc', label: 'Last certified', type: 'date' }],
      rows, totals: rows.length > 1 ? totalsOf(rows, [...money, 'ipcs', 'pending'], { code: 'Total' }) : undefined,
    };
  }

  private async materialsReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const rows: Row[] = [];
    for (const p of projects) {
      if (!p.branchId && !(await tx.conMaterialBudget.count({ where: { projectId: p.id } }))) continue;
      for (const r of await this.materials.reconciliationIn(tx, p.id)) {
        rows.push({ ...label(p), material: r.name, unit: r.unit, budget: r.budget, ordered: r.ordered, delivered: r.delivered, used: r.used, wasted: r.wasted, onHand: r.onHand, wastagePct: r.wastagePercent, unaccounted: r.unaccounted });
      }
    }
    return {
      key: 'materials', title: REPORTS.materials.title, subtitle: this.subtitle(projects, q),
      columns: [...PROJECT_COLS, { key: 'material', label: 'Material' }, { key: 'unit', label: 'Unit' }, { key: 'budget', label: 'BQ allowance', type: 'number' }, { key: 'ordered', label: 'Ordered', type: 'number' }, { key: 'delivered', label: 'Delivered', type: 'number' }, { key: 'used', label: 'Used', type: 'number' }, { key: 'wasted', label: 'Wasted', type: 'number' }, { key: 'onHand', label: 'On site', type: 'number' }, { key: 'wastagePct', label: 'Wastage', type: 'percent' }, { key: 'unaccounted', label: 'Unaccounted', type: 'number' }],
      rows,
      notes: ['Unaccounted = delivered - used - wasted - on site. Anything above zero needs explaining.'],
    };
  }

  private async labourReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const labour = await this.labour(tx, projects.map((p) => p.id), q.from || q.to ? this.range(q) : undefined);
    const rows = projects.filter((p) => labour.has(p.id)).map((p) => {
      const l = labour.get(p.id)!;
      return { ...label(p), workers: l.workers, days: l.days, cost: l.cost, gross: l.gross, deductions: l.deductions, paid: l.paid, unpaid: l.unpaid, uncovered: l.uncovered, perDay: l.days ? r2(l.cost / l.days) : null };
    });
    return {
      key: 'labour', title: REPORTS.labour.title, subtitle: this.subtitle(projects, q),
      columns: [...PROJECT_COLS, { key: 'workers', label: 'Workers', type: 'number' }, { key: 'days', label: 'Worker-days', type: 'number' }, { key: 'cost', label: 'Labour cost', type: 'money' }, { key: 'perDay', label: 'Cost per worker-day', type: 'money' }, { key: 'gross', label: 'On pay runs (gross)', type: 'money' }, { key: 'deductions', label: 'Statutory deductions', type: 'money' }, { key: 'paid', label: 'Net paid', type: 'money' }, { key: 'unpaid', label: 'Net not yet paid', type: 'money' }, { key: 'uncovered', label: 'Muster not yet on a pay run', type: 'money' }],
      rows, totals: rows.length > 1 ? totalsOf(rows, ['workers', 'days', 'cost', 'gross', 'deductions', 'paid', 'unpaid', 'uncovered'], { code: 'Total' }) : undefined,
      notes: ['Worker names, ID numbers and phones are not part of this report.'],
    };
  }

  private async complianceReport(tx: Tx, projects: P[], q: ReportQueryDto, scope: string[] | 'ALL'): Promise<Report> {
    const today = todayKey();
    const ids = projects.map((p) => p.id);
    const company = scope === 'ALL' && !q.projectId;
    const [docs, regs, permits, cards, workers] = await Promise.all([
      tx.conComplianceDoc.findMany({ where: company ? {} : { projectId: { in: ids } } }),
      company ? tx.conCompanyRegistration.findMany() : Promise.resolve([]),
      tx.conProjectPermit.findMany({ where: { projectId: { in: ids }, expiresAt: { not: null } }, include: { project: { select: { code: true } } } }),
      company ? tx.conStaffAccreditation.findMany({ where: { orgUser: { isActive: true } }, include: { orgUser: { select: { user: { select: { fullName: true } } } } } }) : Promise.resolve([]),
      tx.conWorker.findMany({ where: { isActive: true, ncaExpiresAt: { not: null }, ...(company ? {} : { projectId: { in: ids } }) }, select: { name: true, ncaExpiresAt: true, project: { select: { code: true } } } }),
    ]);
    const items = [
      ...docs.map((d) => ({ area: 'Company document', item: `${DOC_LABELS[d.type]}${d.title && d.title !== DOC_LABELS[d.type] ? ` - ${d.title}` : ''}`, ref: d.refNo, project: null as string | null, expires: day(d.expiresAt) })),
      ...regs.map((r) => ({ area: 'NCA licence', item: `NCA${r.ncaCategory} ${WORKS_CLASS_LABELS[r.worksClass]}`, ref: r.regNo, project: null, expires: day(r.licenceExpiresAt) })),
      ...permits.map((p) => ({ area: 'Project permit', item: PERMIT_LABELS[p.type], ref: p.refNo, project: p.project.code, expires: day(p.expiresAt) })),
      ...cards.map((c) => ({ area: 'Staff NCA card', item: c.orgUser.user.fullName, ref: c.cardNo, project: null, expires: day(c.expiresAt) })),
      ...workers.map((w) => ({ area: 'Worker NCA card', item: w.name, ref: null, project: w.project?.code ?? null, expires: day(w.ncaExpiresAt) })),
    ];
    const STATE = { EXPIRED: 'Expired', EXPIRING: 'Expiring', OK: 'Valid', NO_EXPIRY: 'No expiry' } as const;
    const rows = items
      .map((i) => ({ ...i, state: STATE[expiryState(i.expires, today)], daysLeft: i.expires ? daysLeft(i.expires, today) : null }))
      .filter((i) => !q.from && !q.to ? true : !!i.expires && (!q.from || i.expires >= q.from) && (!q.to || i.expires <= q.to))
      .sort((a, b) => (a.daysLeft ?? 99_999) - (b.daysLeft ?? 99_999));
    return {
      key: 'compliance', title: REPORTS.compliance.title, subtitle: this.subtitle(projects, q, 'Everything on file'),
      columns: [{ key: 'state', label: 'State' }, { key: 'daysLeft', label: 'Days left', type: 'number' }, { key: 'expires', label: 'Expires', type: 'date' }, { key: 'area', label: 'Kind' }, { key: 'item', label: 'Item' }, { key: 'ref', label: 'Ref no.' }, { key: 'project', label: 'Project' }],
      rows,
      notes: company ? ['Alerts go out 60, 30 and 7 days before each expiry date.'] : ['Showing permits and worker cards for your projects only.'],
    };
  }

  private async safetyReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const ids = projects.map((p) => p.id);
    const r = this.range(q);
    const dayRange = q.from || q.to ? r : undefined;
    const atRange = q.from || q.to ? { gte: r.gte, lte: r.lte ? new Date(r.lte.getTime() + 86_399_999) : undefined } : undefined;
    const [incidents, talks, ppe, permits, labour] = await Promise.all([
      tx.conIncident.findMany({ where: { projectId: { in: ids }, ...(atRange ? { occurredAt: atRange } : {}) }, select: { projectId: true, severity: true, occurredAt: true, reportedToDoshs: true, reportDueAt: true } }),
      tx.conToolboxTalk.findMany({ where: { projectId: { in: ids }, ...(dayRange ? { date: dayRange } : {}) }, select: { projectId: true, attendeeIds: true } }),
      tx.conPpeIssue.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, ...(dayRange ? { issuedAt: dayRange } : {}) }, _sum: { qty: true } }),
      tx.conPermitToWork.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, ...(atRange ? { validFrom: atRange } : {}) }, _count: { _all: true } }),
      this.labour(tx, ids, dayRange),
    ]);
    const now = new Date();
    const rows = projects.map((p) => {
      const inc = incidents.filter((i) => i.projectId === p.id);
      const count = (s: string) => inc.filter((i) => i.severity === s).length;
      const lti = count('LOST_TIME') + count('FATAL');
      const lastLti = inc.filter((i) => i.severity === 'LOST_TIME' || i.severity === 'FATAL').sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
      const t = talks.filter((x) => x.projectId === p.id);
      const hours = labour.get(p.id)?.hours ?? 0;
      return {
        ...label(p), nearMiss: count('NEAR_MISS'), minor: count('MINOR'), lostTime: count('LOST_TIME'), fatal: count('FATAL'),
        doshsOverdue: inc.filter((i) => !i.reportedToDoshs && i.reportDueAt && i.reportDueAt < now).length,
        daysSinceLti: lastLti ? Math.floor((now.getTime() - lastLti.occurredAt.getTime()) / 86_400_000) : null,
        talks: t.length, attendance: t.reduce((a, x) => a + (Array.isArray(x.attendeeIds) ? x.attendeeIds.length : 0), 0),
        ppe: n(ppe.find((x) => x.projectId === p.id)?._sum.qty), permits: permits.find((x) => x.projectId === p.id)?._count._all ?? 0,
        hours, ltifr: ltifr(lti, hours),
      };
    });
    return {
      key: 'safety', title: REPORTS.safety.title, subtitle: this.subtitle(projects, q),
      columns: [...PROJECT_COLS, { key: 'nearMiss', label: 'Near misses', type: 'number' }, { key: 'minor', label: 'Minor', type: 'number' }, { key: 'lostTime', label: 'Lost time', type: 'number' }, { key: 'fatal', label: 'Fatal', type: 'number' }, { key: 'doshsOverdue', label: 'DOSHS overdue', type: 'number' }, { key: 'daysSinceLti', label: 'Days since lost-time', type: 'number' }, { key: 'talks', label: 'Toolbox talks', type: 'number' }, { key: 'attendance', label: 'Talk attendance', type: 'number' }, { key: 'ppe', label: 'PPE items issued', type: 'number' }, { key: 'permits', label: 'Permits to work', type: 'number' }, { key: 'hours', label: 'Hours worked', type: 'number' }, { key: 'ltifr', label: 'LTIFR', type: 'number' }],
      rows, totals: rows.length > 1 ? totalsOf(rows, ['nearMiss', 'minor', 'lostTime', 'fatal', 'doshsOverdue', 'talks', 'attendance', 'ppe', 'permits', 'hours'], { code: 'Total' }) : undefined,
      notes: [`LTIFR = lost-time and fatal incidents per 1,000,000 hours worked (hours from the muster; ${HOURS_PER_DAY} a day where none were entered).`],
    };
  }

  private async ncaReport(tx: Tx, projects: P[], q: ReportQueryDto): Promise<Report> {
    const [regs, limits, tenders] = await Promise.all([
      tx.conCompanyRegistration.findMany(),
      tx.conCategoryLimit.findMany(),
      tx.conTender.findMany({ where: { status: { in: ['PREPARING', 'SUBMITTED'] } }, select: { worksClass: true, estValue: true } }),
    ]);
    const open = projects.filter((p) => p.status !== 'CLOSED');
    const rows = regs.map((reg) => {
      const cap = limits.find((l) => l.worksClass === reg.worksClass && l.ncaCategory === reg.ncaCategory);
      const capValue = cap?.maxValue === null || cap?.maxValue === undefined ? null : n(cap.maxValue);
      return {
        worksClass: WORKS_CLASS_LABELS[reg.worksClass], category: `NCA${reg.ncaCategory}`, cap: capValue,
        ...ncaRow({ cap: capValue, values: open.filter((p) => p.worksClass === reg.worksClass).map(budgetOf), tenders: tenders.filter((t) => t.worksClass === reg.worksClass).map((t) => n(t.estValue)) }),
        licenceExpires: day(reg.licenceExpiresAt),
      };
    });
    return {
      key: 'nca', title: REPORTS.nca.title, subtitle: this.subtitle(projects, q, 'Open projects and tenders'),
      columns: [{ key: 'worksClass', label: 'Works class' }, { key: 'category', label: 'Category' }, { key: 'cap', label: 'Cap per contract', type: 'money' }, { key: 'projects', label: 'Open projects', type: 'number' }, { key: 'activeValue', label: 'Open contract value', type: 'money' }, { key: 'largest', label: 'Largest contract', type: 'money' }, { key: 'used', label: 'Largest as % of cap', type: 'percent' }, { key: 'openTenders', label: 'Open tenders', type: 'number' }, { key: 'largestTender', label: 'Largest tender', type: 'money' }, { key: 'headroom', label: 'Headroom', type: 'money' }, { key: 'licenceExpires', label: 'Licence expires', type: 'date' }],
      rows,
      notes: ['NCA caps limit the value of each single contract. A blank cap means unlimited (NCA1). Check the caps against the current NCA schedule under Compliance.'],
    };
  }

}
