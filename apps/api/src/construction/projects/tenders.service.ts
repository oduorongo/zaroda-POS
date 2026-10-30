import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConTender } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx } from '../common/con-access';
import { ComplianceService } from '../compliance/compliance.service';
import { WORKS_CLASS_LABELS, todayKey } from '../compliance/compliance.util';
import { TenderDto, TenderOutcomeDto } from '../dto/projects.dto';
import { ProjectsService, enforceCap } from './projects.service';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

const FLOW: Record<ConTender['status'], ConTender['status'][]> = {
  PREPARING: ['SUBMITTED', 'WITHDRAWN'],
  SUBMITTED: ['WON', 'LOST', 'WITHDRAWN'],
  WON: [],
  LOST: [],
  WITHDRAWN: [],
};

/** The tender register: Preparing -> Submitted -> Won/Lost. A won tender becomes a project. */
@Injectable()
export class TendersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly compliance: ComplianceService,
    private readonly projects: ProjectsService,
  ) {}

  private view(t: ConTender & { project?: { id: string; code: string } | null }) {
    return {
      id: t.id,
      ref: t.ref,
      title: t.title,
      procuringEntity: t.procuringEntity,
      isPublic: t.isPublic,
      agpoReserved: t.agpoReserved,
      worksClass: t.worksClass,
      worksClassLabel: WORKS_CLASS_LABELS[t.worksClass],
      estValue: Number(t.estValue),
      closingAt: t.closingAt,
      bidBond: t.bidBond === null ? null : Number(t.bidBond),
      bidBondExpiresAt: day(t.bidBondExpiresAt),
      status: t.status,
      capOverrideReason: t.capOverrideReason,
      outcomeNote: t.outcomeNote,
      notes: t.notes,
      project: t.project ?? null,
      closed: !!t.closingAt && t.closingAt < new Date(),
    };
  }

  async list() {
    const rows = await this.tenantPrisma.run((tx) => tx.conTender.findMany({ orderBy: [{ status: 'asc' }, { closingAt: 'asc' }], include: { project: { select: { id: true, code: true } } } }));
    return rows.map((t) => this.view(t));
  }

  private data(dto: TenderDto) {
    return {
      ref: dto.ref?.trim() || null,
      title: dto.title.trim(),
      procuringEntity: dto.procuringEntity.trim(),
      isPublic: dto.isPublic ?? true,
      agpoReserved: dto.agpoReserved ?? false,
      worksClass: dto.worksClass,
      estValue: dto.estValue,
      closingAt: dto.closingAt ? new Date(dto.closingAt) : null,
      bidBond: dto.bidBond ?? null,
      bidBondExpiresAt: dto.bidBondExpiresAt ? new Date(`${dto.bidBondExpiresAt}T00:00:00Z`) : null,
      notes: dto.notes?.trim() || null,
    };
  }

  async save(con: ConContext, dto: TenderDto, id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = id ? await tx.conTender.findUnique({ where: { id } }) : null;
      if (id && !before) throw new NotFoundException('Tender not found');
      if (before && before.status !== 'PREPARING') throw new ConflictException(`This tender is ${before.status.toLowerCase()} and can no longer be edited.`);
      const valueChanged = !before || Number(before.estValue) !== dto.estValue || before.worksClass !== dto.worksClass;
      const cap = valueChanged ? await enforceCap(tx, this.compliance, con, dto.worksClass, dto.estValue, dto.overrideReason) : {};
      const after = before
        ? await tx.conTender.update({ where: { id: before.id }, data: { ...this.data(dto), ...cap } })
        : await tx.conTender.create({ data: { organizationId: con.organizationId, createdBy: con.orgUserId, ...this.data(dto), ...cap } });
      await this.audit.logInTx(tx, { action: before ? 'con_tender.updated' : 'con_tender.created', entityType: 'ConTender', entityId: after.id, before: before ?? undefined, after });
      return this.view(after);
    });
  }

  /** Bidding needs a valid KRA tax compliance certificate and NCA licence for the works class (warned, as a tender may still go in). */
  private async submitWarnings(tx: Tx, con: ConContext, t: ConTender) {
    const today = new Date(`${todayKey()}T00:00:00Z`);
    const warnings: string[] = [];
    const tcc = await tx.conComplianceDoc.findFirst({ where: { type: 'KRA_TCC', OR: [{ expiresAt: null }, { expiresAt: { gte: today } }] } });
    if (!tcc) warnings.push('There is no valid KRA tax compliance certificate in the vault.');
    const reg = await tx.conCompanyRegistration.findUnique({ where: { organizationId_worksClass: { organizationId: con.organizationId, worksClass: t.worksClass } } });
    if (reg?.licenceExpiresAt && reg.licenceExpiresAt < today) warnings.push(`The NCA${reg.ncaCategory} practising licence for ${WORKS_CLASS_LABELS[t.worksClass]} has expired.`);
    if (t.closingAt && t.closingAt < new Date()) warnings.push('The closing date has passed.');
    if (t.bidBondExpiresAt && t.bidBondExpiresAt < today) warnings.push('The bid bond has expired.');
    return warnings;
  }

  async outcome(con: ConContext, id: string, dto: TenderOutcomeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const t = await tx.conTender.findUnique({ where: { id } });
      if (!t) throw new NotFoundException('Tender not found');
      if (!FLOW[t.status].includes(dto.status)) throw new BadRequestException(`A ${t.status.toLowerCase()} tender cannot be marked ${dto.status.toLowerCase()}.`);
      if (dto.status === 'SUBMITTED') {
        const capNow = await this.compliance.capCheckIn(tx, con.organizationId, t.worksClass, Number(t.estValue));
        if (!capNow.ok && !t.capOverrideReason) throw new BadRequestException(capNow.reason);
        const warnings = await this.submitWarnings(tx, con, t);
        if (warnings.length && !dto.confirm) throw new ConflictException({ statusCode: 409, message: 'Check these before submitting.', warnings, needsConfirm: true });
      }
      let project: { id: string; code: string } | null = null;
      if (dto.status === 'WON') {
        const client =
          (await tx.conParty.findFirst({ where: { kind: 'CLIENT', name: { equals: t.procuringEntity, mode: 'insensitive' } } })) ??
          (await tx.conParty.create({ data: { organizationId: con.organizationId, kind: 'CLIENT', name: t.procuringEntity, createdBy: con.orgUserId } }));
        const sum = dto.awardedSum ?? Number(t.estValue);
        const sameValue = sum === Number(t.estValue);
        const p = await this.projects.createIn(tx, con, {
          name: t.title,
          clientId: client.id,
          worksClass: t.worksClass,
          contractSum: sum,
          formOfContract: t.isPublic ? 'PPADA' : 'JBC',
          tenderId: t.id,
          ...(sameValue ? { capOverride: { capOverrideReason: t.capOverrideReason, capOverrideBy: t.capOverrideBy } } : {}),
          overrideReason: dto.note,
        });
        project = { id: p.id, code: p.code };
      }
      const after = await tx.conTender.update({ where: { id }, data: { status: dto.status, outcomeNote: dto.note?.trim() || t.outcomeNote } });
      await this.audit.logInTx(tx, { action: 'con_tender.status_changed', entityType: 'ConTender', entityId: id, before: { status: t.status }, after: { status: after.status, note: dto.note ?? null, projectId: project?.id ?? null } });
      return this.view({ ...after, project });
    });
  }
}
