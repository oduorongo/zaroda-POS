import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTxnType, Prisma, TailorJobStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { averageCost } from '../common/inventory/average-cost.util';
import { TenantScopedPrismaService, TenantTx } from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { normalizeKenyanPhone } from '../online-orders/online-orders.util';
import { DocumentNumbersService } from '../school-supplier/document-numbers.service';
import { todayKey } from '../school-supplier/school-money.util';
import {
  CloseJobDto,
  CreateTailorJobDto,
  HandInDto,
  JobsQueryDto,
  MaterialsQueryDto,
  SaveTailorDto,
  TailorPaymentDto,
  VoidPaymentDto,
} from './dto/tailoring.dto';
import { handInProblem, materialsCost, materialsFor, pieceCost, tailorBalance } from './tailoring.util';

const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d));
const itemName = (v: { name: string | null; sku: string; product: { name: string } }) => [v.product.name, v.name ?? v.sku].join(' - ');
const VARIANT = { include: { product: { select: { name: true } } } } as const;

/**
 * Uniform makers' tailoring: tailors, the jobs given to them (materials leave stock when a job is given out), the finished
 * pieces they hand in (into stock at materials + rate per piece, earning the tailor the rate), and what they are paid.
 * Hand-ins and payments are never edited: a payment is voided, and a job that will not finish is closed with a reason.
 */
@Injectable()
export class TailoringService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventory: InventoryTransactionsService,
    private readonly numbers: DocumentNumbersService,
    private readonly auditLog: AuditLogService,
  ) {}

  private async myName(tx: TenantTx) {
    const { orgUserId } = getTenantStore();
    const u = await tx.orgUser.findUnique({ where: { id: orgUserId }, select: { user: { select: { fullName: true } } } });
    return u?.user.fullName ?? null;
  }

  private phone(raw?: string) {
    if (!raw?.trim()) return null;
    const phone = normalizeKenyanPhone(raw);
    if (!phone) throw new BadRequestException('Enter a valid Kenyan phone number, e.g. 0712 345 678');
    return phone;
  }

  // ── Tailors ──────────────────────────────────────────────────────────────

  async listTailors() {
    return this.tenantPrisma.run(async (tx) => {
      const tailors = await tx.tailor.findMany({
        orderBy: [{ active: 'desc' }, { name: 'asc' }],
        include: {
          jobs: { select: { status: true, quantity: true, quantityGood: true, quantityRejected: true, handIns: { select: { labourAmount: true } } } },
          payments: { select: { amount: true, voidedAt: true } },
        },
      });
      return tailors.map(({ jobs, payments, ...t }) => ({
        ...t,
        openJobs: jobs.filter((j) => j.status === TailorJobStatus.OPEN).length,
        piecesWithTailor: jobs
          .filter((j) => j.status === TailorJobStatus.OPEN)
          .reduce((n, j) => n + j.quantity - j.quantityGood - j.quantityRejected, 0),
        piecesMade: jobs.reduce((n, j) => n + j.quantityGood, 0),
        ...tailorBalance(
          jobs.flatMap((j) => j.handIns.map((h) => ({ labourAmount: Number(h.labourAmount) }))),
          payments.map((p) => ({ amount: Number(p.amount), voided: !!p.voidedAt })),
        ),
      }));
    });
  }

  async createTailor(dto: SaveTailorDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tailor = await tx.tailor.create({
        data: {
          organizationId,
          name: dto.name.trim(),
          phone: this.phone(dto.phone),
          idNumber: dto.idNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          active: dto.active ?? true,
        },
      });
      await this.auditLog.logInTx(tx, { action: 'tailor.created', entityType: 'Tailor', entityId: tailor.id, after: tailor });
      return tailor;
    });
  }

  async updateTailor(id: string, dto: SaveTailorDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.tailor.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Tailor not found');
      const tailor = await tx.tailor.update({
        where: { id },
        data: {
          name: dto.name.trim(),
          phone: this.phone(dto.phone),
          idNumber: dto.idNumber?.trim() || null,
          notes: dto.notes?.trim() || null,
          active: dto.active ?? before.active,
        },
      });
      await this.auditLog.logInTx(tx, { action: 'tailor.updated', entityType: 'Tailor', entityId: id, before, after: tailor });
      return tailor;
    });
  }

  /** A tailor's account, oldest first: every hand-in (earned) and payment (paid), with the running balance owed. */
  async statement(tailorId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const tailor = await tx.tailor.findUnique({ where: { id: tailorId } });
      if (!tailor) throw new NotFoundException('Tailor not found');
      const [handIns, payments] = await Promise.all([
        tx.tailorHandIn.findMany({
          where: { job: { tailorId } },
          include: { job: { select: { jobNumber: true, ratePerPiece: true, variant: VARIANT } } },
        }),
        tx.tailorPayment.findMany({ where: { tailorId } }),
      ]);
      const rows = [
        ...handIns.map((h) => ({
          kind: 'HAND_IN' as const,
          id: h.id,
          date: h.createdAt,
          detail: `${h.job.jobNumber}: ${h.goodQty} x ${itemName(h.job.variant)} at ${Number(h.job.ratePerPiece)}${h.rejectedQty ? ` (${h.rejectedQty} rejected)` : ''}`,
          earned: Number(h.labourAmount),
          paid: 0,
          voided: false,
        })),
        ...payments.map((p) => ({
          kind: 'PAYMENT' as const,
          id: p.id,
          date: p.paidOn,
          detail: `${p.method === 'MPESA' ? 'M-Pesa' : p.method === 'BANK' ? 'Bank' : 'Cash'}${p.reference ? ` ${p.reference}` : ''}${p.voidedAt ? ` - voided: ${p.voidReason ?? ''}` : ''}`,
          earned: 0,
          paid: p.voidedAt ? 0 : Number(p.amount),
          amount: Number(p.amount),
          voided: !!p.voidedAt,
        })),
      ].sort((a, b) => a.date.getTime() - b.date.getTime());
      let owed = 0;
      const lines = rows.map((r) => {
        owed = Math.round((owed + r.earned - r.paid) * 100) / 100;
        return { ...r, owed };
      });
      return { tailor, lines, ...tailorBalance(handIns.map((h) => ({ labourAmount: Number(h.labourAmount) })), payments.map((p) => ({ amount: Number(p.amount), voided: !!p.voidedAt }))) };
    });
  }

  // ── Jobs ─────────────────────────────────────────────────────────────────

  /** What a job of this size would take from the branch's stock, and whether there is enough. */
  async materials(q: MaterialsQueryDto) {
    return this.tenantPrisma.run((tx) => this.plan(tx, q.branchId, q.variantId, q.quantity));
  }

  private async plan(tx: TenantTx, branchId: string, variantId: string, quantity: number) {
    const variant = await tx.productVariant.findUnique({ where: { id: variantId }, ...VARIANT });
    if (!variant) throw new NotFoundException('Item not found');
    const recipe = await tx.recipeIngredient.findMany({ where: { variantId }, include: { ingredientVariant: VARIANT } });
    const needs = materialsFor(recipe.map((r) => ({ variantId: r.ingredientVariantId, quantity: Number(r.quantity) })), quantity);
    const stock = await tx.inventoryItem.findMany({ where: { branchId, variantId: { in: needs.map((n) => n.variantId) } } });
    const lines = needs.map((n) => {
      const r = recipe.find((x) => x.ingredientVariantId === n.variantId)!;
      const inStock = Number(stock.find((s) => s.variantId === n.variantId)?.quantity ?? 0);
      return { variantId: n.variantId, name: itemName(r.ingredientVariant), quantity: n.quantity, inStock, short: Math.max(0, Math.round((n.quantity - inStock) * 1000) / 1000), unitCost: num(r.ingredientVariant.cost) };
    });
    return { variant: { id: variant.id, name: itemName(variant), tailorRate: num(variant.tailorRate) }, lines, cost: materialsCost(lines), enough: lines.every((l) => l.short === 0) };
  }

  async listJobs(q: JobsQueryDto) {
    return this.tenantPrisma.run((tx) =>
      tx.tailorJob.findMany({
        where: { status: q.status, tailorId: q.tailorId },
        include: { tailor: { select: { id: true, name: true } }, variant: VARIANT, handIns: { orderBy: { createdAt: 'asc' } } },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        take: 300,
      }),
    );
  }

  async getJob(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const job = await tx.tailorJob.findUnique({
        where: { id },
        include: { tailor: true, variant: VARIANT, materials: { include: { variant: VARIANT } }, handIns: { orderBy: { createdAt: 'asc' } } },
      });
      if (!job) throw new NotFoundException('Job not found');
      return job;
    });
  }

  /** Gives a job to a tailor: the materials leave the branch's stock now, at their current cost. */
  async createJob(dto: CreateTailorJobDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tailor = await tx.tailor.findUnique({ where: { id: dto.tailorId } });
      if (!tailor) throw new NotFoundException('Tailor not found');
      if (!tailor.active) throw new BadRequestException(`${tailor.name} is marked as not working - switch them back on first`);
      const branch = await tx.branch.findUnique({ where: { id: dto.branchId } });
      if (!branch) throw new NotFoundException('Branch not found');
      const plan = await this.plan(tx, dto.branchId, dto.variantId, dto.quantity);
      if (plan.lines.length === 0)
        throw new BadRequestException(`${plan.variant.name} has no list of materials yet. Open it under Products and add what one piece uses (fabric, buttons...).`);
      const short = plan.lines.filter((l) => l.short > 0);
      if (short.length)
        throw new BadRequestException(`Not enough materials in ${branch.name}: ${short.map((l) => `${l.name} (need ${l.quantity}, have ${l.inStock})`).join('; ')}`);
      const rate = dto.ratePerPiece ?? plan.variant.tailorRate;
      if (rate === null || rate === undefined)
        throw new BadRequestException(`Enter what the tailor is paid per piece (or set a rate for ${plan.variant.name} on its materials page)`);

      const jobNumber = await this.numbers.next(tx, organizationId, 'TJ');
      const job = await tx.tailorJob.create({
        data: {
          organizationId,
          jobNumber,
          branchId: dto.branchId,
          tailorId: dto.tailorId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          ratePerPiece: rate,
          materialsCost: plan.cost.total,
          dueDate: dto.dueDate ? new Date(`${dto.dueDate.slice(0, 10)}T00:00:00Z`) : null,
          notes: dto.notes?.trim() || null,
          createdByName: await this.myName(tx),
          materials: { create: plan.lines.map((l) => ({ organizationId, variantId: l.variantId, quantity: l.quantity, unitCost: l.unitCost })) },
        },
      });
      for (const l of plan.lines) {
        await this.inventory.recordInTx(tx, { branchId: dto.branchId, variantId: l.variantId, type: InventoryTxnType.TAILORING, quantityDelta: -l.quantity, referenceId: job.id });
      }
      await tx.productVariant.update({ where: { id: dto.variantId }, data: { madeAhead: true } });
      await this.auditLog.logInTx(tx, {
        action: 'tailorJob.created',
        entityType: 'TailorJob',
        entityId: job.id,
        after: { jobNumber, tailor: tailor.name, item: plan.variant.name, quantity: dto.quantity, ratePerPiece: rate, materials: plan.lines },
      });
      return { ...job, uncostedMaterials: plan.cost.uncosted };
    });
  }

  /** Finished pieces back from the tailor: good ones into stock at materials + rate, earning the tailor the rate each. */
  async handIn(jobId: string, dto: HandInDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tailor-job:${jobId}`}))`;
      const job = await tx.tailorJob.findUnique({ where: { id: jobId }, include: { variant: true } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status !== TailorJobStatus.OPEN) throw new BadRequestException(`This job is ${job.status.toLowerCase()} - nothing more can be handed in`);
      const rejected = dto.rejectedQty ?? 0;
      const problem = handInProblem(job, dto.goodQty, rejected);
      if (problem) throw new BadRequestException(problem);

      const rate = Number(job.ratePerPiece);
      const unitCost = pieceCost({ materialsCost: Number(job.materialsCost), quantity: job.quantity, ratePerPiece: rate });
      if (dto.goodQty > 0) {
        const held = await tx.inventoryItem.aggregate({ where: { variantId: job.variantId }, _sum: { quantity: true } });
        const cost = averageCost({ onHand: Number(held._sum.quantity ?? 0), oldCost: num(job.variant.cost), receivedQty: dto.goodQty, unitCost });
        await tx.productVariant.update({ where: { id: job.variantId }, data: { cost } });
        await this.inventory.recordInTx(tx, { branchId: job.branchId, variantId: job.variantId, type: InventoryTxnType.TAILORING, quantityDelta: dto.goodQty, referenceId: job.id });
      }
      const handIn = await tx.tailorHandIn.create({
        data: {
          organizationId,
          jobId,
          goodQty: dto.goodQty,
          rejectedQty: rejected,
          labourAmount: Math.round(dto.goodQty * rate * 100) / 100,
          unitCost,
          notes: dto.notes?.trim() || null,
          receivedByName: await this.myName(tx),
        },
      });
      const good = job.quantityGood + dto.goodQty;
      const bad = job.quantityRejected + rejected;
      const done = good + bad >= job.quantity;
      const updated = await tx.tailorJob.update({
        where: { id: jobId },
        data: { quantityGood: good, quantityRejected: bad, ...(done ? { status: TailorJobStatus.DONE, closedAt: new Date() } : {}) },
      });
      await this.auditLog.logInTx(tx, { action: 'tailorJob.handIn', entityType: 'TailorJob', entityId: jobId, after: { handInId: handIn.id, goodQty: dto.goodQty, rejectedQty: rejected, unitCost } });
      return { job: updated, handIn };
    });
  }

  /** Ends a job early: the pieces still with the tailor will not come (their materials are written off with the job). */
  async closeJob(jobId: string, dto: CloseJobDto) {
    return this.tenantPrisma.run(async (tx) => {
      const job = await tx.tailorJob.findUnique({ where: { id: jobId } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status !== TailorJobStatus.OPEN) throw new BadRequestException(`This job is already ${job.status.toLowerCase()}`);
      const updated = await tx.tailorJob.update({ where: { id: jobId }, data: { status: TailorJobStatus.DONE, closedAt: new Date(), closeNote: dto.reason.trim() } });
      await this.auditLog.logInTx(tx, { action: 'tailorJob.closed', entityType: 'TailorJob', entityId: jobId, before: job, after: updated });
      return updated;
    });
  }

  /** Takes back a job nothing was handed in on: its materials return to stock. */
  async cancelJob(jobId: string) {
    return this.tenantPrisma.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tailor-job:${jobId}`}))`;
      const job = await tx.tailorJob.findUnique({ where: { id: jobId }, include: { materials: true } });
      if (!job) throw new NotFoundException('Job not found');
      if (job.status !== TailorJobStatus.OPEN) throw new BadRequestException(`This job is already ${job.status.toLowerCase()}`);
      if (job.quantityGood + job.quantityRejected > 0)
        throw new BadRequestException('Pieces have already been handed in on this job - close it instead');
      for (const m of job.materials) {
        await this.inventory.recordInTx(tx, { branchId: job.branchId, variantId: m.variantId, type: InventoryTxnType.TAILORING, quantityDelta: Number(m.quantity), referenceId: job.id });
      }
      const updated = await tx.tailorJob.update({ where: { id: jobId }, data: { status: TailorJobStatus.CANCELLED, cancelledAt: new Date() } });
      await this.auditLog.logInTx(tx, { action: 'tailorJob.cancelled', entityType: 'TailorJob', entityId: jobId, before: job, after: updated });
      return updated;
    });
  }

  // ── Pay ──────────────────────────────────────────────────────────────────

  async listPayments(tailorId?: string) {
    return this.tenantPrisma.run((tx) =>
      tx.tailorPayment.findMany({ where: { tailorId }, include: { tailor: { select: { name: true } } }, orderBy: [{ paidOn: 'desc' }, { createdAt: 'desc' }], take: 300 }),
    );
  }

  async pay(dto: TailorPaymentDto) {
    const { organizationId } = getTenantStore();
    return this.tenantPrisma.run(async (tx) => {
      const tailor = await tx.tailor.findUnique({ where: { id: dto.tailorId } });
      if (!tailor) throw new NotFoundException('Tailor not found');
      const paidOn = dto.paidOn?.slice(0, 10) ?? todayKey();
      if (paidOn > todayKey()) throw new BadRequestException('A payment cannot be dated in the future');
      const payment = await tx.tailorPayment.create({
        data: {
          organizationId,
          tailorId: dto.tailorId,
          amount: dto.amount,
          method: dto.method,
          reference: dto.reference?.trim() || null,
          paidOn: new Date(`${paidOn}T00:00:00Z`),
          notes: dto.notes?.trim() || null,
          recordedByName: await this.myName(tx),
        },
      });
      await this.auditLog.logInTx(tx, { action: 'tailorPayment.created', entityType: 'TailorPayment', entityId: payment.id, after: payment });
      return payment;
    });
  }

  async voidPayment(id: string, dto: VoidPaymentDto) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.tailorPayment.findUnique({ where: { id } });
      if (!before) throw new NotFoundException('Payment not found');
      if (before.voidedAt) throw new BadRequestException('This payment is already voided');
      const payment = await tx.tailorPayment.update({ where: { id }, data: { voidedAt: new Date(), voidReason: dto.reason.trim() } });
      await this.auditLog.logInTx(tx, { action: 'tailorPayment.voided', entityType: 'TailorPayment', entityId: id, before, after: payment });
      return payment;
    });
  }
}
