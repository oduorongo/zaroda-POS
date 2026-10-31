import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx } from '../common/con-access';
import { SubValuationDto, SubcontractDto } from '../dto/commercial.dto';
import { nextCode } from '../projects/projects.util';
import { r2, subValuation } from './valuation.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));

/** Subcontracts on a project, each with its own valuations, retention and payments. */
@Injectable()
export class SubcontractsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conSubcontract.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' }, include: { party: { select: { id: true, name: true, phone: true } }, valuations: { orderBy: { number: 'asc' } } } }));
    return rows.map((s) => {
      const done = s.valuations.filter((v) => v.status !== 'DRAFT');
      const last = done[done.length - 1];
      return {
        id: s.id, ref: s.ref, scope: s.scope, sum: n(s.sum), retentionRate: n(s.retentionRate), retentionLimit: n(s.retentionLimit), isActive: s.isActive, party: s.party,
        workToDate: last ? n(last.grossToDate) : 0, retentionHeld: last ? n(last.retention) : 0,
        paid: r2(s.valuations.filter((v) => v.status === 'PAID').reduce((a, v) => a + n(v.netDue), 0)),
        approvedUnpaid: r2(s.valuations.filter((v) => v.status === 'APPROVED').reduce((a, v) => a + n(v.netDue), 0)),
        valuations: s.valuations.map((v) => ({ id: v.id, number: v.number, grossToDate: n(v.grossToDate), retention: n(v.retention), previousPaid: n(v.previousPaid), netDue: n(v.netDue), status: v.status, createdBy: v.createdBy, paymentRef: v.paymentRef, paidAt: v.paidAt, notes: v.notes })),
      };
    });
  }

  async create(con: ConContext, projectId: string, dto: SubcontractDto) {
    return this.tenantPrisma.run(async (tx) => {
      if (!(await tx.conProject.findUnique({ where: { id: projectId } }))) throw new NotFoundException('Project not found');
      const party = await tx.conParty.findUnique({ where: { id: dto.partyId } });
      if (!party) throw new NotFoundException('Subcontractor not found');
      if (party.kind !== 'SUBCONTRACTOR') throw new BadRequestException(`${party.name} is not set up as a subcontractor.`);
      const refs = (await tx.conSubcontract.findMany({ where: { projectId }, select: { ref: true } })).map((r) => r.ref);
      const s = await tx.conSubcontract.create({ data: { organizationId: con.organizationId, projectId, partyId: party.id, ref: nextCode('SC', refs), scope: dto.scope.trim(), sum: dto.sum, retentionRate: dto.retentionRate ?? 10, retentionLimit: dto.retentionLimit ?? 5, createdBy: con.orgUserId } });
      await tx.conProjectParty.upsert({ where: { projectId_partyId_role: { projectId, partyId: party.id, role: 'SUBCONTRACTOR' } }, create: { organizationId: con.organizationId, projectId, partyId: party.id, role: 'SUBCONTRACTOR' }, update: {} });
      await this.audit.logInTx(tx, { action: 'con_subcontract.created', entityType: 'ConSubcontract', entityId: s.id, after: s });
      return s;
    });
  }

  private async subcontract(tx: Tx, projectId: string, id: string) {
    const s = await tx.conSubcontract.findFirst({ where: { id, projectId } });
    if (!s) throw new NotFoundException('Subcontract not found');
    return s;
  }

  async addValuation(con: ConContext, projectId: string, id: string, dto: SubValuationDto) {
    return this.tenantPrisma.run(async (tx) => {
      const s = await this.subcontract(tx, projectId, id);
      const all = await tx.conSubValuation.findMany({ where: { subcontractId: id }, orderBy: { number: 'asc' } });
      if (all.some((v) => v.status === 'DRAFT')) throw new ConflictException('Approve or remove the draft valuation first.');
      const previousPaid = r2(all.reduce((a, v) => a + n(v.netDue), 0));
      let figures;
      try {
        figures = subValuation({ grossToDate: dto.grossToDate, retentionRate: n(s.retentionRate), retentionLimitPercent: n(s.retentionLimit), subcontractSum: n(s.sum), previousPaid });
      } catch (e) {
        throw new BadRequestException((e as Error).message);
      }
      const v = await tx.conSubValuation.create({ data: { organizationId: con.organizationId, subcontractId: id, number: (all[all.length - 1]?.number ?? 0) + 1, grossToDate: dto.grossToDate, retention: figures.retention, previousPaid, netDue: figures.netDue, notes: dto.notes?.trim() || null, createdBy: con.orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_sub_valuation.created', entityType: 'ConSubValuation', entityId: v.id, after: v });
      return v;
    });
  }

  async approve(con: ConContext, projectId: string, id: string, valuationId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.subcontract(tx, projectId, id);
      const v = await tx.conSubValuation.findFirst({ where: { id: valuationId, subcontractId: id } });
      if (!v) throw new NotFoundException('Valuation not found');
      if (v.status !== 'DRAFT') throw new ConflictException('This valuation is already approved.');
      if (v.createdBy === con.orgUserId) throw new ForbiddenException('You prepared this valuation, so someone else must approve it.');
      const after = await tx.conSubValuation.update({ where: { id: valuationId }, data: { status: 'APPROVED', approvedBy: con.orgUserId, approvedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_sub_valuation.approved', entityType: 'ConSubValuation', entityId: valuationId, before: { status: v.status }, after: { status: after.status, netDue: n(v.netDue) } });
      return after;
    });
  }

  async markPaid(con: ConContext, projectId: string, id: string, valuationId: string, paymentRef: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.subcontract(tx, projectId, id);
      const v = await tx.conSubValuation.findFirst({ where: { id: valuationId, subcontractId: id } });
      if (!v) throw new NotFoundException('Valuation not found');
      if (v.status !== 'APPROVED') throw new ConflictException(v.status === 'PAID' ? 'Already paid.' : 'Approve the valuation before paying it.');
      const after = await tx.conSubValuation.update({ where: { id: valuationId }, data: { status: 'PAID', paidAt: new Date(), paymentRef: paymentRef.trim() } });
      await this.audit.logInTx(tx, { action: 'con_sub_valuation.paid', entityType: 'ConSubValuation', entityId: valuationId, before: { status: v.status }, after: { status: after.status, paymentRef: after.paymentRef, amount: n(v.netDue) } });
      return after;
    });
  }

  async removeDraft(projectId: string, id: string, valuationId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.subcontract(tx, projectId, id);
      const v = await tx.conSubValuation.findFirst({ where: { id: valuationId, subcontractId: id } });
      if (!v) throw new NotFoundException('Valuation not found');
      if (v.status !== 'DRAFT') throw new ConflictException('Only a draft can be removed; an approved valuation stays on record.');
      await tx.conSubValuation.delete({ where: { id: valuationId } });
      await this.audit.logInTx(tx, { action: 'con_sub_valuation.deleted', entityType: 'ConSubValuation', entityId: valuationId, before: v });
      return { ok: true };
    });
  }
}
