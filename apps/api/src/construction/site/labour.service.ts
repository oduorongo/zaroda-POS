import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConMusterStatus, ConRoleCode, ConWorker } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx, hasRole } from '../common/con-access';
import { daysLeft, expiryState, todayKey } from '../compliance/compliance.util';
import { MusterDto, WorkerDto } from '../dto/site.dto';
import { ConPlansService } from '../plans/con-plans.service';
import { maskId, maskPhone, musterTotals, validIdNo } from './site.util';

/** Who may see a worker's full ID number and phone (docs/construction/02 + Data Protection Act 2019). */
export const FULL_ID_ROLES: ConRoleCode[] = ['CON_ACCOUNTANT', 'CON_COMPLIANCE'];
const ALL_WORKERS: ConRoleCode[] = ['CON_DIRECTOR', 'CON_CONTRACTS_MGR', 'CON_ACCOUNTANT', 'CON_COMPLIANCE', 'CON_SHE_OFFICER'];
const SITE_LABOUR: ConRoleCode[] = ['CON_PROJECT_MGR', 'CON_SITE_ENGINEER', 'CON_SITE_SUPERVISOR', 'CON_TIMEKEEPER'];
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);

/** Site workers (they do not sign in) and the daily muster roll. */
@Injectable()
export class LabourService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly plans: ConPlansService,
  ) {}

  /** Company-wide labour roles see every worker; anyone else only the workers on projects where they do site work. */
  private seesAll(con: ConContext) {
    return con.isOwner || ALL_WORKERS.some((r) => con.companyRoles.includes(r));
  }

  private myProjects(con: ConContext) {
    return [...new Set(con.projectRoles.filter((r) => SITE_LABOUR.includes(r.role)).map((r) => r.projectId))];
  }

  private view(w: ConWorker & { project?: { id: string; code: string; name: string } | null }, full: boolean, today = todayKey()) {
    const exp = day(w.ncaExpiresAt);
    return {
      id: w.id,
      name: w.name,
      idNo: full ? w.idNo : maskId(w.idNo),
      phone: full ? w.phone : maskPhone(w.phone),
      trade: w.trade,
      ncaCardNo: w.ncaCardNo,
      ncaExpiresAt: exp,
      ncaState: exp ? expiryState(exp, today) : null,
      dailyRate: Number(w.dailyRate),
      isSupervisor: w.isSupervisor,
      isActive: w.isActive,
      project: w.project ?? null,
    };
  }

  /** Lists always mask ID numbers and phones. Project-only staff see the workers on their projects. */
  async list(con: ConContext, projectId?: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.conWorker.findMany({
        where: { ...(projectId ? { projectId } : {}), ...(this.seesAll(con) ? {} : { projectId: { in: this.myProjects(con) } }) },
        include: { project: { select: { id: true, code: true, name: true } } },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
    );
    return rows.map((w) => this.view(w, false));
  }

  async get(con: ConContext, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const w = await this.load(tx, con, id);
      return this.view(w, hasRole(con, FULL_ID_ROLES));
    });
  }

  private async load(tx: Tx, con: ConContext, id: string) {
    const w = await tx.conWorker.findUnique({ where: { id }, include: { project: { select: { id: true, code: true, name: true } } } });
    if (!w) throw new NotFoundException('Worker not found');
    if (!this.seesAll(con) && (!w.projectId || !this.myProjects(con).includes(w.projectId))) throw new ForbiddenException('This worker is not on your project.');
    return w;
  }

  /** A worker marked as site supervisor must hold a valid NCA accreditation card (warned within 30 days of expiry). */
  private cardCheck(dto: WorkerDto): string | null {
    if (!dto.isSupervisor) return null;
    if (!dto.ncaCardNo?.trim() || !dto.ncaExpiresAt) throw new BadRequestException('A site supervisor needs an NCA accreditation card number and expiry date.');
    const left = daysLeft(dto.ncaExpiresAt, todayKey());
    if (left < 0) throw new BadRequestException(`That NCA card expired on ${dto.ncaExpiresAt}. A supervisor needs a valid card.`);
    return left <= 30 ? `The NCA card expires in ${left} days.` : null;
  }

  private async checkProject(tx: Tx, con: ConContext, projectId?: string | null) {
    if (!projectId) {
      if (!this.seesAll(con)) throw new BadRequestException('Choose the project this worker is on.');
      return;
    }
    const p = await tx.conProject.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Project not found');
    if (!this.seesAll(con) && !this.myProjects(con).includes(projectId)) throw new ForbiddenException('You are not on that project.');
  }

  private data(dto: WorkerDto) {
    const idNo = dto.idNo?.replace(/\s+/g, '').toUpperCase() || null;
    if (idNo && !validIdNo(idNo)) throw new BadRequestException('Enter a national ID (digits) or passport number.');
    return {
      name: dto.name.trim(),
      idNo,
      phone: dto.phone?.replace(/\s+/g, '') || null,
      trade: dto.trade.trim(),
      ncaCardNo: dto.ncaCardNo?.trim().toUpperCase() || null,
      ncaExpiresAt: dto.ncaExpiresAt ? date(dto.ncaExpiresAt) : null,
      dailyRate: dto.dailyRate,
      isSupervisor: dto.isSupervisor ?? false,
      projectId: dto.projectId ?? null,
    };
  }

  async create(con: ConContext, dto: WorkerDto) {
    const warning = this.cardCheck(dto);
    return this.tenantPrisma.run(async (tx) => {
      await this.checkProject(tx, con, dto.projectId);
      await this.plans.assertCanAdd(tx, con.organizationId, 'workers', await tx.conWorker.count({ where: { isActive: true } }));
      const data = this.data(dto);
      if (data.idNo && (await tx.conWorker.findFirst({ where: { idNo: data.idNo } }))) throw new ConflictException('A worker with that ID number is already registered.');
      const w = await tx.conWorker.create({ data: { organizationId: con.organizationId, createdBy: con.orgUserId, ...data } });
      await this.audit.logInTx(tx, { action: 'con_worker.created', entityType: 'ConWorker', entityId: w.id, after: { ...w, idNo: maskId(w.idNo), phone: maskPhone(w.phone) } });
      return { ...this.view(w, hasRole(con, FULL_ID_ROLES)), warning };
    });
  }

  async update(con: ConContext, id: string, dto: WorkerDto) {
    const warning = this.cardCheck(dto);
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.load(tx, con, id);
      if (dto.projectId !== undefined && dto.projectId !== before.projectId) await this.checkProject(tx, con, dto.projectId);
      if (dto.isActive && !before.isActive) await this.plans.assertCanAdd(tx, con.organizationId, 'workers', await tx.conWorker.count({ where: { isActive: true } }));
      const data = this.data({ ...dto, projectId: dto.projectId === undefined ? before.projectId ?? undefined : dto.projectId });
      if (data.idNo && data.idNo !== before.idNo && (await tx.conWorker.findFirst({ where: { idNo: data.idNo } }))) throw new ConflictException('A worker with that ID number is already registered.');
      const after = await tx.conWorker.update({ where: { id }, data: { ...data, isActive: dto.isActive ?? before.isActive } });
      const safe = (w: ConWorker) => ({ ...w, idNo: maskId(w.idNo), phone: maskPhone(w.phone) });
      await this.audit.logInTx(tx, { action: 'con_worker.updated', entityType: 'ConWorker', entityId: id, before: safe(before), after: safe(after) });
      return { ...this.view(after, hasRole(con, FULL_ID_ROLES)), warning };
    });
  }

  // ── Muster roll ──

  /** The day's sheet: every active worker on the project, their mark (if any) and whether their NCA card has expired. */
  async musterDay(projectId: string, dayKey: string) {
    const today = todayKey();
    return this.tenantPrisma.run(async (tx) => {
      const [workers, marks] = await Promise.all([
        tx.conWorker.findMany({ where: { projectId, isActive: true }, orderBy: [{ isSupervisor: 'desc' }, { name: 'asc' }] }),
        tx.conMuster.findMany({ where: { projectId, date: date(dayKey) } }),
      ]);
      const byWorker = new Map(marks.map((m) => [m.workerId, m]));
      const extra = marks.filter((m) => !workers.some((w) => w.id === m.workerId)).map((m) => m.workerId);
      const others = extra.length ? await tx.conWorker.findMany({ where: { id: { in: extra } } }) : [];
      const rows = [...workers, ...others].map((w) => {
        const m = byWorker.get(w.id);
        const exp = day(w.ncaExpiresAt);
        return { workerId: w.id, name: w.name, trade: w.trade, isSupervisor: w.isSupervisor, ncaState: exp ? expiryState(exp, today) : null, status: m?.status ?? null, hours: m?.hours ? Number(m.hours) : null };
      });
      return { date: dayKey, rows, totals: musterTotals(marks.map((m) => m.status)) };
    });
  }

  /** Saves marks; safe to send again (phones retry when the signal comes back). No marks for future days. */
  async saveMuster(con: ConContext, projectId: string, dto: MusterDto) {
    if (dto.date > todayKey()) throw new BadRequestException('The muster roll cannot be marked for a future day.');
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.conProject.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Project not found');
      const ids = [...new Set(dto.entries.map((e) => e.workerId))];
      const workers = await tx.conWorker.findMany({ where: { id: { in: ids } }, select: { id: true, projectId: true } });
      const wrong = ids.filter((id) => !workers.some((w) => w.id === id && w.projectId === projectId));
      if (wrong.length) throw new BadRequestException(`${wrong.length} of these workers are not on this project.`);
      const d = date(dto.date);
      let saved = 0;
      for (const e of dto.entries) {
        const hours = e.hours ?? (e.status === 'PRESENT' ? 8 : e.status === 'HALF' ? 4 : 0);
        await tx.conMuster.upsert({
          where: { projectId_workerId_date: { projectId, workerId: e.workerId, date: d } },
          create: { organizationId: con.organizationId, projectId, workerId: e.workerId, date: d, status: e.status, hours, markedBy: con.orgUserId, clientRef: e.clientRef ?? null },
          update: { status: e.status, hours, markedBy: con.orgUserId, clientRef: e.clientRef ?? null },
        });
        saved++;
      }
      await this.audit.logInTx(tx, { action: 'con_muster.saved', entityType: 'ConProject', entityId: projectId, after: { date: dto.date, entries: dto.entries.map((e) => ({ workerId: e.workerId, status: e.status })) } });
      const marks = await tx.conMuster.findMany({ where: { projectId, date: d }, select: { status: true } });
      return { saved, totals: musterTotals(marks.map((m) => m.status)) };
    });
  }

  /** Days worked per worker over a period, for payroll (C6) and the labour report. */
  async musterSummary(projectId: string, from: string, to: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.conMuster.findMany({ where: { projectId, date: { gte: date(from), lte: date(to) } }, include: { worker: { select: { name: true, trade: true, dailyRate: true } } } });
      const by = new Map<string, { workerId: string; name: string; trade: string; dailyRate: number; statuses: ConMusterStatus[] }>();
      for (const r of rows) {
        const e = by.get(r.workerId) ?? { workerId: r.workerId, name: r.worker.name, trade: r.worker.trade, dailyRate: Number(r.worker.dailyRate), statuses: [] };
        e.statuses.push(r.status);
        by.set(r.workerId, e);
      }
      return [...by.values()].map(({ statuses, ...w }) => ({ ...w, ...musterTotals(statuses) })).sort((a, b) => a.name.localeCompare(b.name));
    });
  }
}
