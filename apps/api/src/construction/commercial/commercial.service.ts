import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConValuation, Prisma } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { ConContext, Tx } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { CertifyDto, ReceiptDto, RetentionReleaseDto, ValuationDto, VariationDecisionDto, VariationDto } from '../dto/commercial.dto';
import { nextCode } from '../projects/projects.util';
import { creditIpcSale, recordIpcSale } from './ipc-sale';
import { expectedWithholding, ipcBalance, previousCertified, r2, retentionRelease, revisedSum, valuation } from './valuation.util';

const n = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const DONE = ['CERTIFIED', 'PAID'] as const;

/**
 * Commercial (docs/construction/01 s7): variations, interim valuations certified by the client's QS (the IPC), retention,
 * invoicing the IPC through eTIMS, and money received with withholding certificates. Certified valuations never change: a
 * mistake is put right with a REVERSAL, then a fresh valuation.
 */
@Injectable()
export class CommercialService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
  ) {}

  private async project(tx: Tx, projectId: string) {
    const p = await tx.conProject.findUnique({ where: { id: projectId }, include: { client: true } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  private async rate(tx: Tx, key: string, at: Date) {
    const row = await tx.conTaxSetting.findFirst({ where: { key, active: true, effectiveFrom: { lte: at } }, orderBy: { effectiveFrom: 'desc' } });
    return row ? Number(row.rate) : 0;
  }

  // ── Variations ──

  async listVariations(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conVariation.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }));
    const instr = await this.tenantPrisma.run((tx) => tx.conSiteInstruction.findMany({ where: { projectId, id: { in: rows.map((r) => r.instructionId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }));
    return rows.map((v) => ({ id: v.id, ref: v.ref, description: v.description, amount: n(v.amount), status: v.status, instruction: instr.find((i) => i.id === v.instructionId) ?? null, createdBy: v.createdBy, approvedByName: v.approvedByName, approvedAt: v.approvedAt, rejectedReason: v.rejectedReason }));
  }

  async saveVariation(con: ConContext, projectId: string, dto: VariationDto, id?: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      if (dto.instructionId) {
        const si = await tx.conSiteInstruction.findFirst({ where: { id: dto.instructionId, projectId } });
        if (!si) throw new NotFoundException('Site instruction not found on this project');
        const taken = await tx.conVariation.findFirst({ where: { instructionId: dto.instructionId, ...(id ? { id: { not: id } } : {}) } });
        if (taken) throw new ConflictException(`${si.number} already has variation ${taken.ref}.`);
      }
      const data = { description: dto.description.trim(), amount: dto.amount, instructionId: dto.instructionId ?? null, status: dto.amount !== 0 ? ('PRICED' as const) : ('PROPOSED' as const) };
      let after;
      if (!id) {
        const refs = (await tx.conVariation.findMany({ where: { projectId }, select: { ref: true } })).map((r) => r.ref);
        after = await tx.conVariation.create({ data: { organizationId: con.organizationId, projectId, ref: nextCode('VO', refs), createdBy: con.orgUserId, ...data } });
        await this.audit.logInTx(tx, { action: 'con_variation.created', entityType: 'ConVariation', entityId: after.id, after });
      } else {
        const before = await tx.conVariation.findFirst({ where: { id, projectId } });
        if (!before) throw new NotFoundException('Variation not found');
        if (before.status === 'APPROVED' || before.status === 'REJECTED') throw new ConflictException(`${before.ref} is ${before.status.toLowerCase()} and can no longer change.`);
        after = await tx.conVariation.update({ where: { id }, data });
        await this.audit.logInTx(tx, { action: 'con_variation.updated', entityType: 'ConVariation', entityId: id, before, after });
      }
      if (dto.instructionId) await tx.conSiteInstruction.update({ where: { id: dto.instructionId }, data: { variationId: after.id } });
      return after;
    });
  }

  /** Approved variations change the revised contract sum. Never approved by whoever raised them. */
  async decideVariation(con: ConContext, projectId: string, id: string, dto: VariationDecisionDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conVariation.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Variation not found');
      if (before.status !== 'PRICED') throw new ConflictException(before.status === 'PROPOSED' ? 'Price the variation before deciding it.' : `${before.ref} is already ${before.status.toLowerCase()}.`);
      if (before.createdBy === con.orgUserId) throw new ForbiddenException('You raised this variation, so someone else must decide it.');
      const approve = dto.decision === 'APPROVE';
      const after = await tx.conVariation.update({
        where: { id },
        data: approve ? { status: 'APPROVED', approvedBy: con.orgUserId, approvedByName: dto.approvedByName?.trim() || null, approvedAt: new Date() } : { status: 'REJECTED', approvedBy: con.orgUserId, approvedAt: new Date(), rejectedReason: dto.reason?.trim() || null },
      });
      if (approve) {
        const p = await this.project(tx, projectId);
        const approved = await tx.conVariation.findMany({ where: { projectId, status: 'APPROVED' }, select: { amount: true } });
        const revised = revisedSum(n(p.contractSum), approved.map((a) => n(a.amount)));
        await tx.conProject.update({ where: { id: projectId }, data: { revisedSum: revised } });
        await this.audit.logInTx(tx, { action: 'con_project.revised_sum_changed', entityType: 'ConProject', entityId: projectId, before: { revisedSum: p.revisedSum }, after: { revisedSum: revised, variation: before.ref } });
      }
      await this.audit.logInTx(tx, { action: approve ? 'con_variation.approved' : 'con_variation.rejected', entityType: 'ConVariation', entityId: id, before: { status: before.status }, after: { status: after.status, approvedByName: after.approvedByName, reason: dto.reason ?? null } });
      return after;
    });
  }

  // ── Valuations ──

  private async certifiedBefore(tx: Tx, projectId: string, excludeId?: string) {
    return tx.conValuation.findMany({ where: { projectId, status: { in: [...DONE] }, ...(excludeId ? { id: { not: excludeId } } : {}) }, orderBy: { number: 'asc' } });
  }

  private async released(tx: Tx, projectId: string) {
    return r2((await tx.conRetentionEntry.findMany({ where: { projectId, type: 'RELEASE' } })).reduce((a, e) => a + n(e.amount), 0));
  }

  /** Works the figures out from the lines, the BQ rates, approved variations, releases so far and everything certified before. */
  private async compute(tx: Tx, projectId: string, dto: ValuationDto, excludeId?: string) {
    const p = await this.project(tx, projectId);
    const bqIds = dto.lines.filter((l) => l.bqItemId).map((l) => l.bqItemId!);
    const voIds = dto.lines.filter((l) => l.variationId).map((l) => l.variationId!);
    if (new Set(bqIds).size !== bqIds.length || new Set(voIds).size !== voIds.length) throw new BadRequestException('Each BQ item or variation can appear once.');
    if (dto.lines.some((l) => !!l.bqItemId === !!l.variationId)) throw new BadRequestException('Each line is either a BQ item or a variation.');
    const [items, vos] = await Promise.all([
      tx.conBqItem.findMany({ where: { id: { in: bqIds }, projectId } }),
      tx.conVariation.findMany({ where: { id: { in: voIds }, projectId } }),
    ]);
    if (items.length !== bqIds.length) throw new BadRequestException('A BQ item is not on this project.');
    if (vos.length !== voIds.length) throw new BadRequestException('A variation is not on this project.');
    const notApproved = vos.find((v) => v.status !== 'APPROVED');
    if (notApproved) throw new BadRequestException(`${notApproved.ref} is not approved, so it cannot be valued.`);
    const lines = dto.lines.map((l) => {
      if (l.bqItemId) {
        const it = items.find((x) => x.id === l.bqItemId)!;
        const qty = l.qtyToDate ?? 0;
        return { bqItemId: it.id, variationId: null, qtyToDate: qty, amountToDate: r2(qty * n(it.rate)), rate: n(it.rate), qty: n(it.qty) };
      }
      const v = vos.find((x) => x.id === l.variationId)!;
      return { bqItemId: null, variationId: v.id, qtyToDate: null, amountToDate: r2(l.amountToDate ?? 0), approvedAmount: n(v.amount) };
    });
    const before = await this.certifiedBefore(tx, projectId, excludeId);
    try {
      const result = valuation({
        bq: lines.filter((l) => l.bqItemId).map((l) => ({ qtyToDate: l.qtyToDate!, rate: (l as { rate: number }).rate, qty: (l as { qty: number }).qty })),
        variations: lines.filter((l) => l.variationId).map((l) => ({ amountToDate: l.amountToDate, approvedAmount: (l as { approvedAmount: number }).approvedAmount })),
        materialsOnSite: dto.materialsOnSite ?? 0,
        retentionRate: n(p.retentionRate),
        retentionLimitPercent: n(p.retentionLimit),
        contractSum: n(p.contractSum),
        retentionReleasedToDate: await this.released(tx, projectId),
        advanceRecoveryToDate: dto.advanceRecovery ?? 0,
        previousCertified: previousCertified(before.map((b) => ({ netDue: n(b.netDue) }))),
      });
      return { p, lines, result };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  private figures(result: ReturnType<typeof valuation>, rate: number) {
    return {
      workToDate: result.workToDate, variationsToDate: result.variationsToDate, materialsOnSite: result.materialsOnSite, grossToDate: result.grossToDate, retentionRate: rate,
      retentionDeducted: result.retentionDeducted, retentionReleased: result.retentionReleased, retentionHeld: result.retentionHeld, advanceRecovery: result.advanceRecovery, previousCertified: result.previousCertified, netDue: result.netDue,
    };
  }

  private async open(tx: Tx, projectId: string) {
    return tx.conValuation.findFirst({ where: { projectId, status: { in: ['DRAFT', 'SUBMITTED'] } } });
  }

  async createValuation(con: ConContext, projectId: string, dto: ValuationDto) {
    if (dto.periodEnd > todayKey()) throw new BadRequestException('The valuation date cannot be in the future.');
    return this.tenantPrisma.run(async (tx) => {
      const pending = await this.open(tx, projectId);
      if (pending) throw new ConflictException(`Valuation ${pending.number} is still being worked on - finish or certify it first.`);
      const { p, lines, result } = await this.compute(tx, projectId, dto);
      if (!['ACTIVE', 'PRACTICAL_COMPLETION', 'DLP'].includes(p.status)) throw new ConflictException('Valuations are for active projects.');
      const number = ((await tx.conValuation.aggregate({ where: { projectId }, _max: { number: true } }))._max.number ?? 0) + 1;
      const v = await tx.conValuation.create({
        data: {
          organizationId: con.organizationId, projectId, number, periodEnd: date(dto.periodEnd), notes: dto.notes?.trim() || null, createdBy: con.orgUserId, ...this.figures(result, n(p.retentionRate)),
          lines: { create: lines.map((l) => ({ organizationId: con.organizationId, bqItemId: l.bqItemId, variationId: l.variationId, qtyToDate: l.qtyToDate, amountToDate: l.amountToDate })) },
        },
      });
      await this.audit.logInTx(tx, { action: 'con_valuation.created', entityType: 'ConValuation', entityId: v.id, after: { ...v, warnings: result.warnings } });
      return { ...(await this.view(tx, v.id)), warnings: result.warnings };
    });
  }

  async updateValuation(con: ConContext, projectId: string, id: string, dto: ValuationDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await this.load(tx, projectId, id);
      if (before.status !== 'DRAFT' || before.kind !== 'VALUATION') throw new ConflictException('Only a draft valuation can be changed.');
      const { p, lines, result } = await this.compute(tx, projectId, dto, id);
      await tx.conValuationLine.deleteMany({ where: { valuationId: id } });
      const after = await tx.conValuation.update({
        where: { id },
        data: {
          periodEnd: date(dto.periodEnd), notes: dto.notes?.trim() || null, ...this.figures(result, n(p.retentionRate)),
          lines: { create: lines.map((l) => ({ organizationId: con.organizationId, bqItemId: l.bqItemId, variationId: l.variationId, qtyToDate: l.qtyToDate, amountToDate: l.amountToDate })) },
        },
      });
      await this.audit.logInTx(tx, { action: 'con_valuation.updated', entityType: 'ConValuation', entityId: id, before, after });
      return { ...(await this.view(tx, id)), warnings: result.warnings };
    });
  }

  private async load(tx: Tx, projectId: string, id: string) {
    const v = await tx.conValuation.findFirst({ where: { id, projectId } });
    if (!v) throw new NotFoundException('Valuation not found');
    return v;
  }

  /** Approved inside the business and sent to the client's QS. Not by whoever prepared it. */
  async submit(con: ConContext, projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const v = await this.load(tx, projectId, id);
      if (v.status !== 'DRAFT') throw new ConflictException(`Valuation ${v.number} is already ${v.status.toLowerCase()}.`);
      if (v.createdBy === con.orgUserId) throw new ForbiddenException('You prepared this valuation, so someone else must approve it.');
      const after = await tx.conValuation.update({ where: { id }, data: { status: 'SUBMITTED', submittedBy: con.orgUserId, submittedAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_valuation.submitted', entityType: 'ConValuation', entityId: id, before: { status: v.status }, after: { status: after.status } });
      return this.view(tx, id);
    });
  }

  /** The client's QS has certified it: it becomes the IPC and is locked. Retention deducted on it goes to the ledger. */
  async certify(con: ConContext, projectId: string, id: string, dto: CertifyDto) {
    if (dto.certifiedAt > todayKey()) throw new BadRequestException('The certificate date cannot be in the future.');
    return this.tenantPrisma.run(async (tx) => {
      const v = await this.load(tx, projectId, id);
      if (v.status !== 'SUBMITTED') throw new ConflictException(v.status === 'DRAFT' ? 'Approve and send the valuation to the client\'s QS first.' : `Valuation ${v.number} is already ${v.status.toLowerCase()}.`);
      const before = await this.certifiedBefore(tx, projectId, id);
      const prevDeducted = before.length ? n(before[before.length - 1].retentionDeducted) : 0;
      const after = await tx.conValuation.update({ where: { id }, data: { status: 'CERTIFIED', certifiedByName: dto.certifiedByName.trim(), certifiedRef: dto.certifiedRef?.trim() || null, certifiedAt: date(dto.certifiedAt), certifiedRecordedBy: con.orgUserId } });
      const deducted = r2(n(v.retentionDeducted) - prevDeducted);
      if (deducted !== 0) await tx.conRetentionEntry.create({ data: { organizationId: con.organizationId, projectId, valuationId: id, type: 'DEDUCT', amount: deducted, reason: `${v.kind === 'REVERSAL' ? 'Reversal ' : ''}IPC ${v.number}`, createdBy: con.orgUserId } });
      if (v.kind === 'REVERSAL' && v.reversesId) {
        const original = await tx.conValuation.findUniqueOrThrow({ where: { id: v.reversesId } });
        if (original.saleId && original.invoiceTotal) await creditIpcSale(tx, { saleId: original.saleId, amount: n(original.invoiceTotal), orgUserId: con.orgUserId, reversalId: id, reason: `IPC ${original.number} reversed by IPC ${v.number}` });
      }
      await this.audit.logInTx(tx, { action: 'con_valuation.certified', entityType: 'ConValuation', entityId: id, before: { status: v.status }, after: { status: after.status, netDue: n(v.netDue), certifiedByName: after.certifiedByName, certifiedRef: after.certifiedRef } });
      return this.view(tx, id);
    });
  }

  /** The only way to correct a certified IPC: a new certificate that cancels it (sent to the client's QS like any other). */
  async reverse(con: ConContext, projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const v = await this.load(tx, projectId, id);
      if (v.kind !== 'VALUATION' || !DONE.includes(v.status as (typeof DONE)[number])) throw new ConflictException('Only a certified valuation can be reversed.');
      if (v.reversed) throw new ConflictException(`IPC ${v.number} has already been reversed.`);
      const pending = await this.open(tx, projectId);
      if (pending) throw new ConflictException(`Valuation ${pending.number} is still being worked on - finish it first.`);
      const later = await tx.conValuation.findFirst({ where: { projectId, number: { gt: v.number }, status: { in: [...DONE] }, kind: 'VALUATION', reversed: false } });
      if (later) throw new ConflictException(`IPC ${later.number} came after it - reverse the latest certificate first.`);
      const before = await this.certifiedBefore(tx, projectId);
      const prior = before.filter((b) => b.number < v.number && b.kind === 'VALUATION' && !b.reversed).pop();
      const number = ((await tx.conValuation.aggregate({ where: { projectId }, _max: { number: true } }))._max.number ?? 0) + 1;
      const back = (k: keyof ConValuation) => (prior ? n(prior[k] as Prisma.Decimal) : 0);
      const reversal = await tx.conValuation.create({
        data: {
          organizationId: con.organizationId, projectId, number, kind: 'REVERSAL', reversesId: v.id, periodEnd: date(todayKey()), status: 'SUBMITTED', createdBy: con.orgUserId, submittedBy: con.orgUserId, submittedAt: new Date(),
          notes: `Reverses IPC ${v.number}`, retentionRate: v.retentionRate,
          workToDate: back('workToDate'), variationsToDate: back('variationsToDate'), materialsOnSite: back('materialsOnSite'), grossToDate: back('grossToDate'),
          retentionDeducted: back('retentionDeducted'), retentionReleased: back('retentionReleased'), retentionHeld: back('retentionHeld'), advanceRecovery: back('advanceRecovery'),
          previousCertified: previousCertified(before.map((b) => ({ netDue: n(b.netDue) }))), netDue: -n(v.netDue),
        },
      });
      await tx.conValuation.update({ where: { id: v.id }, data: { reversed: true } });
      await this.audit.logInTx(tx, { action: 'con_valuation.reversal_raised', entityType: 'ConValuation', entityId: reversal.id, after: { reverses: v.number, netDue: -n(v.netDue) } });
      return this.view(tx, reversal.id);
    });
  }

  /** A certified IPC is invoiced to the client through the business's normal eTIMS sales (VAT at the rate in force on the certificate date). */
  async invoice(con: ConContext, projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const v = await this.load(tx, projectId, id);
      if (v.status !== 'CERTIFIED' || v.kind !== 'VALUATION' || v.reversed) throw new ConflictException('Only a certified IPC that has not been reversed can be invoiced.');
      if (v.saleId) throw new ConflictException(`IPC ${v.number} is already invoiced.`);
      if (n(v.netDue) <= 0) throw new ConflictException('There is nothing to invoice on this certificate.');
      const p = await this.project(tx, projectId);
      const vatRate = await this.rate(tx, 'VAT', v.certifiedAt ?? new Date());
      const vatAmount = r2((n(v.netDue) * vatRate) / 100);
      const saleId = await recordIpcSale(tx, { organizationId: con.organizationId, orgUserId: con.orgUserId, valuationId: id, netAmount: n(v.netDue), vatRate, vatAmount, client: p.client ? { name: p.client.name, kraPin: p.client.kraPin, phone: p.client.phone } : null });
      const after = await tx.conValuation.update({ where: { id }, data: { saleId, invoicedAt: new Date(), vatRate, vatAmount, invoiceTotal: r2(n(v.netDue) + vatAmount) } });
      await this.audit.logInTx(tx, { action: 'con_valuation.invoiced', entityType: 'ConValuation', entityId: id, after: { saleId, vatRate, vatAmount, invoiceTotal: n(after.invoiceTotal) } });
      return this.view(tx, id);
    });
  }

  async addReceipt(con: ConContext, projectId: string, id: string, dto: ReceiptDto) {
    if (dto.receivedAt > todayKey()) throw new BadRequestException('A receipt cannot be dated in the future.');
    if (dto.kind === 'PAYMENT' && !dto.method) throw new BadRequestException('Say how it was paid (M-Pesa, bank, cheque).');
    if (dto.kind !== 'PAYMENT' && !dto.certificateNo?.trim()) throw new BadRequestException('Enter the withholding certificate number.');
    return this.tenantPrisma.run(async (tx) => {
      const v = await this.load(tx, projectId, id);
      if (!v.invoiceTotal) throw new ConflictException('Invoice the IPC before recording money against it.');
      if (v.status === 'PAID') throw new ConflictException(`IPC ${v.number} is already fully paid.`);
      const receipts = await tx.conValuationReceipt.findMany({ where: { valuationId: id } });
      const sum = (k: string) => receipts.filter((r) => r.kind === k).reduce((a, r) => a + n(r.amount), 0) + (dto.kind === k ? dto.amount : 0);
      const bal = ipcBalance(n(v.invoiceTotal), { payment: sum('PAYMENT'), wht: sum('WHT'), whtVat: sum('WHT_VAT') });
      if (bal.outstanding < -0.005) throw new BadRequestException(`That is ${(-bal.outstanding).toLocaleString('en-KE')} more than is owed on IPC ${v.number}.`);
      const receipt = await tx.conValuationReceipt.create({ data: { organizationId: con.organizationId, valuationId: id, kind: dto.kind, amount: dto.amount, method: dto.method ?? null, reference: dto.reference?.trim() || null, certificateNo: dto.certificateNo?.trim() || null, receivedAt: date(dto.receivedAt), createdBy: con.orgUserId } });
      if (bal.settled) await tx.conValuation.update({ where: { id }, data: { status: 'PAID', paidAt: new Date() } });
      await this.audit.logInTx(tx, { action: 'con_valuation.receipt_recorded', entityType: 'ConValuationReceipt', entityId: receipt.id, after: { ...receipt, settled: bal.settled } });
      return this.view(tx, id);
    });
  }

  async listValuations(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conValuation.findMany({ where: { projectId }, orderBy: { number: 'desc' }, include: { receipts: true } }));
    return rows.map((v) => ({
      id: v.id, number: v.number, kind: v.kind, status: v.status, reversed: v.reversed, periodEnd: day(v.periodEnd), grossToDate: n(v.grossToDate), retentionHeld: n(v.retentionHeld), netDue: n(v.netDue),
      certifiedAt: day(v.certifiedAt), invoiceTotal: v.invoiceTotal === null ? null : n(v.invoiceTotal), invoiced: !!v.saleId, received: r2(v.receipts.reduce((a, r) => a + n(r.amount), 0)),
    }));
  }

  /** Everything needed to show, edit or print one valuation. */
  private async view(tx: Tx, id: string) {
    const v = await tx.conValuation.findUniqueOrThrow({ where: { id }, include: { lines: { include: { bqItem: { include: { section: true } }, variation: true } }, receipts: { orderBy: { receivedAt: 'asc' } }, reverses: { select: { number: true } }, reversedBy: { select: { number: true, status: true } } } });
    const p = await this.project(tx, v.projectId);
    const sum = (k: string) => v.receipts.filter((r) => r.kind === k).reduce((a, r) => a + n(r.amount), 0);
    const [whtRate, whtVatRate] = await Promise.all([this.rate(tx, 'WHT_CONTRACTOR', v.certifiedAt ?? new Date()), this.rate(tx, 'WHT_VAT', v.certifiedAt ?? new Date())]);
    return {
      id: v.id, number: v.number, kind: v.kind, status: v.status, reversed: v.reversed, reverses: v.reverses?.number ?? null, reversedBy: v.reversedBy, periodEnd: day(v.periodEnd), notes: v.notes,
      createdBy: v.createdBy, submittedAt: v.submittedAt, certifiedByName: v.certifiedByName, certifiedRef: v.certifiedRef, certifiedAt: day(v.certifiedAt),
      workToDate: n(v.workToDate), variationsToDate: n(v.variationsToDate), materialsOnSite: n(v.materialsOnSite), grossToDate: n(v.grossToDate), retentionRate: n(v.retentionRate),
      retentionDeducted: n(v.retentionDeducted), retentionReleased: n(v.retentionReleased), retentionHeld: n(v.retentionHeld), advanceRecovery: n(v.advanceRecovery), previousCertified: n(v.previousCertified), netDue: n(v.netDue),
      vatRate: v.vatRate === null ? null : n(v.vatRate), vatAmount: v.vatAmount === null ? null : n(v.vatAmount), invoiceTotal: v.invoiceTotal === null ? null : n(v.invoiceTotal), invoiced: !!v.saleId, invoicedAt: v.invoicedAt, paidAt: v.paidAt,
      expectedWithholding: expectedWithholding(n(v.netDue), whtRate, whtVatRate),
      balance: v.invoiceTotal === null ? null : ipcBalance(n(v.invoiceTotal), { payment: sum('PAYMENT'), wht: sum('WHT'), whtVat: sum('WHT_VAT') }),
      receipts: v.receipts.map((r) => ({ id: r.id, kind: r.kind, amount: n(r.amount), method: r.method, reference: r.reference, certificateNo: r.certificateNo, receivedAt: day(r.receivedAt) })),
      lines: v.lines.map((l) => (l.bqItem
        ? { id: l.id, bqItemId: l.bqItemId, section: l.bqItem.section.name, code: l.bqItem.code, description: l.bqItem.description, unit: l.bqItem.unit, qty: n(l.bqItem.qty), rate: n(l.bqItem.rate), qtyToDate: n(l.qtyToDate), amountToDate: n(l.amountToDate) }
        : { id: l.id, variationId: l.variationId, ref: l.variation!.ref, description: l.variation!.description, approvedAmount: n(l.variation!.amount), amountToDate: n(l.amountToDate) })),
      project: { id: p.id, code: p.code, name: p.name, contractSum: n(p.contractSum), revisedSum: p.revisedSum === null ? null : n(p.revisedSum), retentionLimit: n(p.retentionLimit), client: p.client ? { name: p.client.name, kraPin: p.client.kraPin } : null },
    };
  }

  async getValuation(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      await this.load(tx, projectId, id);
      const v = await this.view(tx, id);
      const org = await tx.organization.findFirst({ select: { name: true, phone: true, email: true, kraPin: true } });
      return { ...v, company: org };
    });
  }

  /** What to start a new valuation from: every BQ item and approved variation, with the last certified figures to date. */
  async template(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      const last = (await this.certifiedBefore(tx, projectId)).filter((v) => v.kind === 'VALUATION' && !v.reversed).pop();
      const lastLines = last ? await tx.conValuationLine.findMany({ where: { valuationId: last.id } }) : [];
      const [sections, vos] = await Promise.all([
        tx.conBqSection.findMany({ where: { projectId }, orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { sortOrder: 'asc' } } } }),
        tx.conVariation.findMany({ where: { projectId, status: 'APPROVED' }, orderBy: { createdAt: 'asc' } }),
      ]);
      return {
        project: { contractSum: n(p.contractSum), revisedSum: p.revisedSum === null ? null : n(p.revisedSum), retentionRate: n(p.retentionRate), retentionLimit: n(p.retentionLimit) },
        last: last ? { number: last.number, materialsOnSite: n(last.materialsOnSite), advanceRecovery: n(last.advanceRecovery) } : null,
        sections: sections.map((s) => ({ name: s.name, items: s.items.map((i) => ({ bqItemId: i.id, code: i.code, description: i.description, unit: i.unit, qty: n(i.qty), rate: n(i.rate), amount: n(i.amount), lastQtyToDate: n(lastLines.find((l) => l.bqItemId === i.id)?.qtyToDate) })) })),
        variations: vos.map((v) => ({ variationId: v.id, ref: v.ref, description: v.description, amount: n(v.amount), lastAmountToDate: n(lastLines.find((l) => l.variationId === v.id)?.amountToDate) })),
      };
    });
  }

  // ── Retention ──

  async retention(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      const entries = await tx.conRetentionEntry.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
      const deducted = r2(entries.filter((e) => e.type === 'DEDUCT').reduce((a, e) => a + n(e.amount), 0));
      const released = r2(entries.filter((e) => e.type === 'RELEASE').reduce((a, e) => a + n(e.amount), 0));
      return {
        rate: n(p.retentionRate), limitPercent: n(p.retentionLimit), cap: r2((n(p.contractSum) * n(p.retentionLimit)) / 100), deducted, released, held: r2(deducted - released), projectStatus: p.status,
        entries: entries.map((e) => ({ id: e.id, type: e.type, amount: n(e.amount), reason: e.reason, createdAt: e.createdAt })),
      };
    });
  }

  /** Half (or any share) at practical completion; the rest once the defects period is over. Paid through the next certificate. */
  async releaseRetention(con: ConContext, projectId: string, dto: RetentionReleaseDto) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      if (dto.stage === 'PRACTICAL_COMPLETION' && !['PRACTICAL_COMPLETION', 'DLP', 'CLOSED'].includes(p.status)) throw new ConflictException('Release at practical completion once the project has reached it.');
      if (dto.stage === 'END_OF_DLP' && !['DLP', 'CLOSED'].includes(p.status)) throw new ConflictException('The final release comes at the end of the defects liability period.');
      const entries = await tx.conRetentionEntry.findMany({ where: { projectId } });
      const held = r2(entries.reduce((a, e) => a + (e.type === 'DEDUCT' ? n(e.amount) : -n(e.amount)), 0));
      if (held <= 0) throw new ConflictException('No retention is held on this project.');
      const amount = retentionRelease(held, dto.percent);
      const entry = await tx.conRetentionEntry.create({ data: { organizationId: con.organizationId, projectId, type: 'RELEASE', amount, reason: `${dto.percent}% at ${dto.stage === 'PRACTICAL_COMPLETION' ? 'practical completion' : 'end of defects period'}`, createdBy: con.orgUserId } });
      await this.audit.logInTx(tx, { action: 'con_retention.released', entityType: 'ConRetentionEntry', entityId: entry.id, before: { held }, after: { released: amount, held: r2(held - amount), stage: dto.stage } });
      return { released: amount, held: r2(held - amount) };
    });
  }
}
