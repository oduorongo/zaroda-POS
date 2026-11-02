import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { DoshsReportDto, IncidentDto, PpeIssueDto, ToolboxTalkDto, WorkPermitDto } from '../dto/site.dto';
import { nextCode } from '../projects/projects.util';
import { doshsDueAt, needsDoshs } from './site.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);

/** OSHA 2007 / WIBA registers: toolbox talks, PPE issued, permits-to-work and incidents (with the DOSHS reporting deadline). */
@Injectable()
export class SafetyService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private async project(tx: Tx, projectId: string) {
    if (!(await tx.conProject.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Project not found');
  }

  private async workersOnProject(tx: Tx, projectId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await tx.conWorker.count({ where: { id: { in: ids }, projectId } });
    if (found !== new Set(ids).size) throw new BadRequestException('Some of those workers are not on this project.');
  }

  async registers(projectId: string) {
    const now = new Date();
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const [talks, ppe, permits, incidents] = await Promise.all([
        tx.conToolboxTalk.findMany({ where: { projectId }, orderBy: { date: 'desc' }, take: 50 }),
        tx.conPpeIssue.findMany({ where: { projectId }, orderBy: { issuedAt: 'desc' }, take: 100, include: { worker: { select: { name: true } } } }),
        tx.conPermitToWork.findMany({ where: { projectId }, orderBy: { validFrom: 'desc' }, take: 50 }),
        tx.conIncident.findMany({ where: { projectId }, orderBy: { occurredAt: 'desc' }, take: 50, include: { worker: { select: { name: true } } } }),
      ]);
      return {
        talks: talks.map((t) => ({ id: t.id, date: day(t.date), topic: t.topic, notes: t.notes, attendees: Array.isArray(t.attendeeIds) ? t.attendeeIds.length : 0 })),
        ppe: ppe.map((p) => ({ id: p.id, worker: p.worker.name, item: p.item, qty: p.qty, issuedAt: day(p.issuedAt) })),
        permits: permits.map((p) => ({ id: p.id, number: p.number, type: p.type, location: p.location, precautions: p.precautions, validFrom: p.validFrom, validTo: p.validTo, status: p.status === 'OPEN' && p.validTo < now ? ('EXPIRED' as const) : p.status })),
        incidents: incidents.map((i) => ({
          id: i.id, occurredAt: i.occurredAt, severity: i.severity, description: i.description, actionTaken: i.actionTaken, worker: i.worker?.name ?? null,
          mustReport: needsDoshs(i.severity), reportDueAt: i.reportDueAt, reportedToDoshs: i.reportedToDoshs, reportedAt: i.reportedAt, doshsRef: i.doshsRef,
          overdue: needsDoshs(i.severity) && !i.reportedToDoshs && !!i.reportDueAt && i.reportDueAt < now,
        })),
      };
    });
  }

  async addTalk(con: ConContext, projectId: string, dto: ToolboxTalkDto) {
    if (dto.date > todayKey()) throw new BadRequestException('A toolbox talk cannot be dated in the future.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.workersOnProject(tx, projectId, dto.attendeeIds);
      const after = await tx.conToolboxTalk.create({ data: { organizationId: con.organizationId, projectId, date: date(dto.date), topic: dto.topic.trim(), notes: dto.notes?.trim() || null, attendeeIds: [...new Set(dto.attendeeIds)], heldBy: con.orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_toolbox_talk.created', entityType: 'ConToolboxTalk', entityId: after.id, after });
      return after;
    });
  }

  async issuePpe(con: ConContext, projectId: string, dto: PpeIssueDto) {
    if (dto.issuedAt > todayKey()) throw new BadRequestException('PPE cannot be issued in the future.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.workersOnProject(tx, projectId, [dto.workerId]);
      const after = await tx.conPpeIssue.create({ data: { organizationId: con.organizationId, projectId, workerId: dto.workerId, item: dto.item.trim(), qty: dto.qty ?? 1, issuedAt: date(dto.issuedAt), issuedBy: con.orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_ppe.issued', entityType: 'ConPpeIssue', entityId: after.id, after });
      return after;
    });
  }

  async addPermit(con: ConContext, projectId: string, dto: WorkPermitDto) {
    const from = new Date(dto.validFrom);
    const to = new Date(dto.validTo);
    if (to <= from) throw new BadRequestException('A permit must end after it starts.');
    if (to.getTime() - from.getTime() > 7 * 86_400_000) throw new BadRequestException('A permit-to-work covers at most 7 days; issue a new one after that.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      const numbers = (await tx.conPermitToWork.findMany({ where: { projectId }, select: { number: true } })).map((n) => n.number);
      const after = await tx.conPermitToWork.create({ data: { organizationId: con.organizationId, projectId, number: nextCode('PTW', numbers), type: dto.type, location: dto.location.trim(), precautions: dto.precautions?.trim() || null, validFrom: from, validTo: to, issuedBy: con.orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_work_permit.issued', entityType: 'ConPermitToWork', entityId: after.id, after });
      return after;
    });
  }

  async closePermit(con: ConContext, projectId: string, id: string, cancel: boolean) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conPermitToWork.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Permit not found');
      if (before.status !== 'OPEN') throw new ConflictException(`This permit is already ${before.status.toLowerCase()}.`);
      const after = await tx.conPermitToWork.update({ where: { id }, data: { status: cancel ? 'CANCELLED' : 'CLOSED', closedBy: con.orgUserId, closedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_work_permit.closed', entityType: 'ConPermitToWork', entityId: id, before: { status: before.status }, after: { status: after.status } });
      return after;
    });
  }

  async addIncident(con: ConContext, projectId: string, dto: IncidentDto) {
    const occurredAt = new Date(dto.occurredAt);
    if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new BadRequestException('An incident cannot be in the future.');
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      if (dto.workerId) await this.workersOnProject(tx, projectId, [dto.workerId]);
      const after = await tx.conIncident.create({
        data: { organizationId: con.organizationId, projectId, occurredAt, severity: dto.severity, description: dto.description.trim(), actionTaken: dto.actionTaken?.trim() || null, workerId: dto.workerId ?? null, reportDueAt: doshsDueAt(dto.severity, occurredAt), createdBy: con.orgUserId },
      });
      await this.audit.logInTx(tx, { action: 'con_incident.created', entityType: 'ConIncident', entityId: after.id, after });
      return { ...after, mustReport: needsDoshs(after.severity) };
    });
  }

  async reportDoshs(projectId: string, id: string, dto: DoshsReportDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conIncident.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Incident not found');
      if (before.reportedToDoshs) throw new ConflictException('This incident is already recorded as reported to DOSHS.');
      const after = await tx.conIncident.update({ where: { id }, data: { reportedToDoshs: true, reportedAt: dto.reportedAt ? new Date(dto.reportedAt) : new Date(), doshsRef: dto.doshsRef.trim() } });
      await this.audit.logInTx(tx, { action: 'con_incident.reported_to_doshs', entityType: 'ConIncident', entityId: id, before: { reportedToDoshs: false }, after: { reportedToDoshs: true, doshsRef: after.doshsRef, reportedAt: after.reportedAt } });
      return after;
    });
  }
}
