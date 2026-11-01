import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, hasRole } from '../common/con-access';
import { ComplianceService } from '../compliance/compliance.service';
import { todayKey } from '../compliance/compliance.util';
import { MaterialsService } from '../materials/materials.service';
import { programmeProgress } from '../projects/projects.util';
import { dayValue } from '../site/site.util';
import { ReportsService } from './reports.service';
import { REPORTS, elapsedPct, r2, scheduleState } from './reports.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const DONE = ['CERTIFIED', 'PAID'] as const;

/** The Director's view across every open project, and the Project Manager's view of one project. */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly reports: ReportsService,
    private readonly compliance: ComplianceService,
    private readonly materials: MaterialsService,
  ) {}

  async director() {
    const today = todayKey();
    const health = await this.compliance.health();
    return this.tenantPrisma.run(async (tx) => {
      const projects = await tx.conProject.findMany({ where: { status: { not: 'CLOSED' } }, orderBy: { code: 'asc' }, include: { milestones: true } });
      const ids = projects.map((p) => p.id);
      const [costs, vals, retention, muster, incidents, reqs, lpos, submitted, variations, payroll, diaries] = await Promise.all([
        this.reports.costs(tx, projects),
        tx.conValuation.findMany({ where: { projectId: { in: ids } }, include: { receipts: true } }),
        tx.conRetentionEntry.groupBy({ by: ['projectId', 'type'], where: { projectId: { in: ids } }, _sum: { amount: true } }),
        tx.conMuster.findMany({ where: { projectId: { in: ids }, date: new Date(`${today}T00:00:00Z`) }, select: { projectId: true, status: true } }),
        tx.conIncident.findMany({ where: { projectId: { in: ids }, OR: [{ occurredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } }, { reportedToDoshs: false, reportDueAt: { not: null } }] }, select: { projectId: true, severity: true, reportedToDoshs: true, reportDueAt: true, occurredAt: true } }),
        tx.conRequisition.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: 'SUBMITTED' }, _count: { _all: true } }),
        tx.conLpo.findMany({ where: { projectId: { in: ids }, status: 'AWAITING_APPROVAL' }, select: { projectId: true, total: true } }),
        tx.conValuation.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: 'DRAFT' }, _count: { _all: true } }),
        tx.conVariation.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: { in: ['PROPOSED', 'PRICED'] } }, _count: { _all: true } }),
        tx.conPayrollRun.findMany({ where: { projectId: { in: ids }, status: 'DRAFT' }, select: { projectId: true, net: true } }),
        tx.conSiteDiary.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, status: 'SUBMITTED' }, _count: { _all: true } }),
      ]);
      const now = new Date();
      const count = (rows: { projectId: string; _count: { _all: number } }[], id: string) => rows.find((r) => r.projectId === id)?._count._all ?? 0;
      const rows = projects.map((p) => {
        const progress = programmeProgress(p.milestones);
        const elapsed = elapsedPct(day(p.startDate), day(p.completionDate), today);
        const c = costs.get(p.id)!;
        const mine = vals.filter((v) => v.projectId === p.id);
        const received = r2(mine.flatMap((v) => v.receipts).reduce((a, r) => a + n(r.amount), 0));
        const invoiced = r2(mine.reduce((a, v) => a + n(v.invoiceTotal), 0));
        const ret = (t: 'DEDUCT' | 'RELEASE') => n(retention.find((r) => r.projectId === p.id && r.type === t)?._sum.amount);
        const inc = incidents.filter((i) => i.projectId === p.id);
        return {
          id: p.id, code: p.code, name: p.name, status: p.status, progress, elapsed, schedule: scheduleState(progress, elapsed),
          budget: c.budget, certified: c.certified, certifiedPct: c.budget ? r2((c.certified / c.budget) * 100) : null, cost: c.cost, margin: c.margin, budgetUsed: c.budgetUsed,
          invoiced, received, outstanding: r2(invoiced - received), retentionHeld: r2(ret('DEDUCT') - ret('RELEASE')),
          workersToday: muster.filter((m) => m.projectId === p.id).reduce((a, m) => a + dayValue(m.status), 0),
          incidents30: inc.filter((i) => i.occurredAt >= new Date(Date.now() - 30 * 86_400_000)).length,
          doshsOverdue: inc.filter((i) => !i.reportedToDoshs && i.reportDueAt && i.reportDueAt < now).length,
          waiting: {
            requisitions: count(reqs, p.id), lpos: lpos.filter((l) => l.projectId === p.id).length, valuations: count(submitted, p.id),
            variations: count(variations, p.id), payroll: payroll.filter((r) => r.projectId === p.id).length, diaries: count(diaries, p.id),
          },
        };
      });
      const sum = (k: 'budget' | 'certified' | 'cost' | 'margin' | 'invoiced' | 'received' | 'outstanding' | 'retentionHeld') => r2(rows.reduce((a, r) => a + r[k], 0));
      return {
        totals: { projects: rows.length, budget: sum('budget'), certified: sum('certified'), cost: sum('cost'), margin: sum('margin'), invoiced: sum('invoiced'), received: sum('received'), outstanding: sum('outstanding'), retentionHeld: sum('retentionHeld'), workersToday: rows.reduce((a, r) => a + r.workersToday, 0), behind: rows.filter((r) => r.schedule === 'BEHIND').length, doshsOverdue: rows.reduce((a, r) => a + r.doshsOverdue, 0) },
        approvals: {
          lpos: lpos.length, lpoValue: r2(lpos.reduce((a, l) => a + n(l.total), 0)), requisitions: rows.reduce((a, r) => a + r.waiting.requisitions, 0), valuations: rows.reduce((a, r) => a + r.waiting.valuations, 0),
          variations: rows.reduce((a, r) => a + r.waiting.variations, 0), payroll: payroll.length, payrollValue: r2(payroll.reduce((a, r) => a + n(r.net), 0)), diaries: rows.reduce((a, r) => a + r.waiting.diaries, 0),
        },
        compliance: { health: health.health, expired: health.counts.expired, expiring: health.counts.expiring, missing: health.missing },
        projects: rows,
      };
    });
  }

  async project(con: ConContext, projectId: string) {
    const today = todayKey();
    const at = new Date(`${today}T00:00:00Z`);
    const money = hasRole(con, [...REPORTS.cost.roles], projectId);
    return this.tenantPrisma.run(async (tx) => {
      const p = await tx.conProject.findUnique({ where: { id: projectId }, include: { milestones: { orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }] } } });
      if (!p) throw new NotFoundException('Project not found');
      const [muster, diary, photos, reqs, lpos, variations, payroll, valuations, incidents, permits, recon] = await Promise.all([
        tx.conMuster.findMany({ where: { projectId, date: at }, select: { status: true } }),
        tx.conSiteDiary.findFirst({ where: { projectId, date: at }, select: { status: true } }),
        tx.conSitePhoto.count({ where: { projectId, createdAt: { gte: new Date(at.getTime() - 3 * 3600_000) } } }),
        tx.conRequisition.count({ where: { projectId, status: 'SUBMITTED' } }),
        tx.conLpo.count({ where: { projectId, status: 'AWAITING_APPROVAL' } }),
        tx.conVariation.count({ where: { projectId, status: { in: ['PROPOSED', 'PRICED'] } } }),
        tx.conPayrollRun.count({ where: { projectId, status: 'DRAFT' } }),
        tx.conValuation.findMany({ where: { projectId }, orderBy: { number: 'desc' }, take: 1, select: { number: true, status: true, kind: true, netDue: true, certifiedAt: true } }),
        tx.conIncident.findMany({ where: { projectId }, select: { severity: true, occurredAt: true, reportedToDoshs: true, reportDueAt: true } }),
        tx.conPermitToWork.count({ where: { projectId, status: 'OPEN' } }),
        this.materials.reconciliationIn(tx, projectId),
      ]);
      const progress = programmeProgress(p.milestones);
      const elapsed = elapsedPct(day(p.startDate), day(p.completionDate), today);
      const lti = incidents.filter((i) => i.severity === 'LOST_TIME' || i.severity === 'FATAL').sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
      const now = new Date();
      const cost = money ? (await this.reports.costs(tx, [p])).get(p.id)! : null;
      return {
        project: { id: p.id, code: p.code, name: p.name, status: p.status, startDate: day(p.startDate), completionDate: day(p.completionDate) },
        programme: {
          progress, elapsed, schedule: scheduleState(progress, elapsed),
          overdue: p.milestones.filter((m) => day(m.endDate)! < today && m.percentComplete < 100).map((m) => ({ id: m.id, name: m.name, endDate: day(m.endDate), percentComplete: m.percentComplete })),
          next: p.milestones.filter((m) => m.percentComplete < 100 && day(m.endDate)! >= today).slice(0, 3).map((m) => ({ id: m.id, name: m.name, endDate: day(m.endDate), percentComplete: m.percentComplete })),
        },
        today: { present: muster.filter((m) => m.status === 'PRESENT').length, half: muster.filter((m) => m.status === 'HALF').length, absent: muster.filter((m) => m.status === 'ABSENT').length, diary: diary?.status ?? null, photos },
        waiting: { requisitions: reqs, lpos, variations, payroll },
        safety: {
          incidents30: incidents.filter((i) => i.occurredAt >= new Date(Date.now() - 30 * 86_400_000)).length,
          doshsOverdue: incidents.filter((i) => !i.reportedToDoshs && i.reportDueAt && i.reportDueAt < now).length,
          daysSinceLti: lti ? Math.floor((now.getTime() - lti.occurredAt.getTime()) / 86_400_000) : null, openPermits: permits,
        },
        materials: { overBudget: recon.filter((r) => r.overBudget).map((r) => r.name), unaccounted: recon.filter((r) => r.unaccounted > 0).map((r) => ({ name: r.name, unit: r.unit, qty: r.unaccounted })) },
        money: cost && {
          budget: cost.budget, cost: cost.cost, budgetUsed: cost.budgetUsed, certified: cost.certified, margin: cost.margin, materials: cost.materials, labour: cost.labour, plant: cost.plant, subcontracts: cost.subcontracts,
          lastValuation: valuations[0] ? { number: valuations[0].number, status: valuations[0].status, kind: valuations[0].kind, netDue: n(valuations[0].netDue), certifiedAt: day(valuations[0].certifiedAt), done: (DONE as readonly string[]).includes(valuations[0].status) } : null,
        },
      };
    });
  }
}
