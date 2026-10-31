import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTxnType, PurchaseOrderStatus } from '@prisma/client';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { InventoryTransactionsService } from '../../inventory/inventory-transactions.service';
import { PurchaseOrdersService } from '../../purchasing/purchase-orders.service';
import { ConContext, Tx, isDirector } from '../common/con-access';
import { todayKey } from '../compliance/compliance.util';
import { BudgetDto, GrnDto, IssueDto, LpoDto, RequisitionDto } from '../dto/materials.dto';
import { nextCode } from '../projects/projects.util';
import { approvalProblem, reconcile } from './materials.util';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = (s: string) => new Date(`${s}T00:00:00Z`);
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const variantName = (v: { name: string | null; sku: string; product: { name: string; baseUnit: string } }) => ({ name: v.name ? `${v.product.name} - ${v.name}` : v.product.name, unit: v.product.baseUnit, sku: v.sku });

/**
 * Site materials (docs/construction/01 s6), on the shared inventory: each project's site is a Branch, an LPO is a purchase order
 * to that branch (DRAFT until approved), a delivery is a goods receipt, and site stock is that branch's normal stock ledger.
 */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly audit: AuditLogService,
    private readonly purchaseOrders: PurchaseOrdersService,
    private readonly inventory: InventoryTransactionsService,
  ) {}

  private async project(tx: Tx, projectId: string) {
    const p = await tx.conProject.findUnique({ where: { id: projectId } });
    if (!p) throw new NotFoundException('Project not found');
    return p;
  }

  /** The project's site store, created the first time materials go to it. */
  async siteBranch(tx: Tx, con: ConContext, projectId: string): Promise<string> {
    const p = await this.project(tx, projectId);
    if (p.branchId) return p.branchId;
    const branch = await tx.branch.create({ data: { organizationId: con.organizationId, name: `${p.code} site - ${p.name}`.slice(0, 120), county: p.county } });
    await tx.conProject.update({ where: { id: projectId }, data: { branchId: branch.id } });
    await this.audit.logInTx(tx, { action: 'con_project.site_store_created', entityType: 'ConProject', entityId: projectId, after: { branchId: branch.id } });
    return branch.id;
  }

  private async checkVariants(tx: Tx, ids: string[]) {
    const unique = [...new Set(ids)];
    if ((await tx.productVariant.count({ where: { id: { in: unique } } })) !== unique.length) throw new NotFoundException('One or more materials were not found');
  }

  private async checkBqItems(tx: Tx, projectId: string, ids: (string | undefined)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length && (await tx.conBqItem.count({ where: { id: { in: wanted }, projectId } })) !== wanted.length) throw new BadRequestException('A BQ item is not on this project.');
  }

  // ── Requisitions ──

  async listRequisitions(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) =>
      tx.conRequisition.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        include: { lines: { include: { variant: { include: { product: true } }, bqItem: { select: { code: true, description: true } } } }, lpos: { select: { id: true, number: true } } },
      }),
    );
    return rows.map((r) => ({
      id: r.id, number: r.number, status: r.status, neededBy: day(r.neededBy), notes: r.notes, createdBy: r.createdBy, approvedAt: r.approvedAt, rejectedReason: r.rejectedReason, createdAt: r.createdAt, lpos: r.lpos,
      lines: r.lines.map((l) => ({ id: l.id, variantId: l.variantId, ...variantName(l.variant), qty: Number(l.qty), bqItem: l.bqItem, note: l.note, cost: l.variant.cost === null ? null : Number(l.variant.cost) })),
    }));
  }

  async createRequisition(con: ConContext, projectId: string, dto: RequisitionDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.checkVariants(tx, dto.lines.map((l) => l.variantId));
      await this.checkBqItems(tx, projectId, dto.lines.map((l) => l.bqItemId));
      const numbers = (await tx.conRequisition.findMany({ select: { number: true } })).map((x) => x.number);
      const r = await tx.conRequisition.create({
        data: {
          organizationId: con.organizationId, projectId, number: nextCode('REQ', numbers), status: 'SUBMITTED', neededBy: dto.neededBy ? date(dto.neededBy) : null, notes: dto.notes?.trim() || null, createdBy: con.orgUserId,
          lines: { create: dto.lines.map((l) => ({ organizationId: con.organizationId, variantId: l.variantId, qty: l.qty, bqItemId: l.bqItemId ?? null, note: l.note?.trim() || null })) },
        },
      });
      await this.audit.logInTx(tx, { action: 'con_requisition.created', entityType: 'ConRequisition', entityId: r.id, after: { ...r, lines: dto.lines } });
      return r;
    });
  }

  /** Approving or rejecting: never by whoever asked for it. */
  async decideRequisition(con: ConContext, projectId: string, id: string, approve: boolean, reason?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const before = await tx.conRequisition.findFirst({ where: { id, projectId } });
      if (!before) throw new NotFoundException('Requisition not found');
      if (before.status !== 'SUBMITTED') throw new ConflictException(`This requisition is already ${before.status.toLowerCase()}.`);
      if (before.createdBy === con.orgUserId) throw new ForbiddenException('You raised this requisition, so someone else must approve it.');
      const after = await tx.conRequisition.update({
        where: { id },
        data: approve ? { status: 'APPROVED', approvedBy: con.orgUserId, approvedAt: new Date() } : { status: 'REJECTED', approvedBy: con.orgUserId, approvedAt: new Date(), rejectedReason: reason?.trim() || null },
      });
      await this.audit.logInTx(tx, { action: approve ? 'con_requisition.approved' : 'con_requisition.rejected', entityType: 'ConRequisition', entityId: id, before: { status: before.status }, after: { status: after.status, reason: reason ?? null } });
      return after;
    });
  }

  // ── LPOs ──

  private lpoStatus(status: string, po: PurchaseOrderStatus) {
    if (status !== 'APPROVED') return status;
    return po === 'RECEIVED' ? 'RECEIVED' : po === 'PARTIALLY_RECEIVED' ? 'PART_RECEIVED' : po === 'CANCELLED' ? 'CANCELLED' : 'SENT';
  }

  private lpoInclude = {
    purchaseOrder: { include: { supplier: true, lineItems: { include: { variant: { include: { product: true } } } }, receipts: { select: { id: true, receiptNumber: true, deliveryNote: true, createdAt: true } } } },
    requisition: { select: { id: true, number: true } },
  } as const;

  private lpoView(l: Awaited<ReturnType<MaterialsService['loadLpo']>>) {
    const po = l.purchaseOrder;
    return {
      id: l.id, number: l.number, status: this.lpoStatus(l.status, po.status), total: Number(l.total), deliverBy: day(l.deliverBy), createdBy: l.createdBy, approvedAt: l.approvedAt, rejectedReason: l.rejectedReason, createdAt: l.createdAt,
      requisition: l.requisition, purchaseOrderId: po.id, notes: po.notes,
      supplier: { id: po.supplier.id, name: po.supplier.name, phone: po.supplier.phone, email: po.supplier.email },
      lines: po.lineItems.map((li) => ({ lineItemId: li.id, variantId: li.variantId, ...variantName(li.variant), qty: Number(li.quantityOrdered), received: Number(li.quantityReceived), rate: n(li.unitCost), amount: Math.round(Number(li.quantityOrdered) * n(li.unitCost) * 100) / 100 })),
      receipts: po.receipts,
    };
  }

  private async loadLpo(tx: Tx, projectId: string, id: string) {
    const l = await tx.conLpo.findFirst({ where: { id, projectId }, include: this.lpoInclude });
    if (!l) throw new NotFoundException('LPO not found');
    return l;
  }

  async listLpos(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.conLpo.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' }, include: this.lpoInclude });
      return rows.map((l) => this.lpoView(l));
    });
  }

  async getLpo(projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const [l, p, org] = await Promise.all([this.loadLpo(tx, projectId, id), this.project(tx, projectId), tx.organization.findFirst({ select: { name: true, phone: true, email: true, kraPin: true } })]);
      return { ...this.lpoView(l), project: { code: p.code, name: p.name, location: p.location, county: p.county }, company: org };
    });
  }

  /** Raised by procurement; a DRAFT purchase order to the site until approved. */
  async createLpo(con: ConContext, projectId: string, dto: LpoDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.checkVariants(tx, dto.lines.map((l) => l.variantId));
      if (dto.requisitionId) {
        const req = await tx.conRequisition.findFirst({ where: { id: dto.requisitionId, projectId } });
        if (!req) throw new NotFoundException('Requisition not found');
        if (req.status !== 'APPROVED') throw new ConflictException('Only an approved requisition can be ordered.');
      }
      const branchId = await this.siteBranch(tx, con, projectId);
      const po = await this.purchaseOrders.createInTx(tx, { branchId, supplierId: dto.supplierId, notes: dto.notes?.trim() || undefined, lineItems: dto.lines.map((l) => ({ variantId: l.variantId, quantityOrdered: l.qty, unitCost: l.rate })) }, PurchaseOrderStatus.DRAFT);
      const total = Math.round(dto.lines.reduce((a, l) => a + l.qty * l.rate, 0) * 100) / 100;
      const numbers = (await tx.conLpo.findMany({ select: { number: true } })).map((x) => x.number);
      const lpo = await tx.conLpo.create({ data: { organizationId: con.organizationId, projectId, purchaseOrderId: po.id, requisitionId: dto.requisitionId ?? null, number: nextCode('LPO', numbers), total, deliverBy: dto.deliverBy ? date(dto.deliverBy) : null, createdBy: con.orgUserId } });
      if (dto.requisitionId) await tx.conRequisition.update({ where: { id: dto.requisitionId }, data: { status: 'ORDERED' } });
      await this.audit.logInTx(tx, { action: 'con_lpo.created', entityType: 'ConLpo', entityId: lpo.id, after: { ...lpo, lines: dto.lines } });
      return this.lpoView(await this.loadLpo(tx, projectId, lpo.id));
    });
  }

  /** The most this person may approve on this project: highest limit among their Contracts Manager / Project Manager roles; Director unlimited. */
  private async limitFor(tx: Tx, con: ConContext, projectId: string): Promise<number | null> {
    if (isDirector(con)) return null;
    const codes = [...con.companyRoles.filter((r) => r === 'CON_CONTRACTS_MGR'), ...con.projectRoles.filter((p) => p.projectId === projectId && p.role === 'CON_PROJECT_MGR').map((p) => p.role)];
    const rows = await tx.conRole.findMany({ where: { code: { in: codes } } });
    const limits = rows.filter((r) => r.approvalLimit !== null).map((r) => Number(r.approvalLimit));
    return limits.length ? Math.max(...limits) : 0;
  }

  async decideLpo(con: ConContext, projectId: string, id: string, approve: boolean, reason?: string) {
    return this.tenantPrisma.run(async (tx) => {
      const l = await this.loadLpo(tx, projectId, id);
      if (l.status !== 'AWAITING_APPROVAL') throw new ConflictException(`This LPO is already ${l.status.toLowerCase().replace('_', ' ')}.`);
      if (approve) {
        const problem = approvalProblem({ total: Number(l.total), createdBy: l.createdBy, approverId: con.orgUserId, limit: await this.limitFor(tx, con, projectId), limitsOn: con.plan.features.includes('approval_limits') });
        if (problem) throw new ForbiddenException(problem);
      } else if (l.createdBy === con.orgUserId) throw new ForbiddenException('You raised this LPO; cancel it instead.');
      await tx.purchaseOrder.update({ where: { id: l.purchaseOrderId }, data: { status: approve ? 'ORDERED' : 'CANCELLED' } });
      const after = await tx.conLpo.update({ where: { id }, data: approve ? { status: 'APPROVED', approvedBy: con.orgUserId, approvedAt: new Date() } : { status: 'REJECTED', approvedBy: con.orgUserId, approvedAt: new Date(), rejectedReason: reason?.trim() || null } });
      await this.audit.logInTx(tx, { action: approve ? 'con_lpo.approved' : 'con_lpo.rejected', entityType: 'ConLpo', entityId: id, before: { status: l.status }, after: { status: after.status, total: Number(l.total), reason: reason ?? null } });
      return this.lpoView(await this.loadLpo(tx, projectId, id));
    });
  }

  async cancelLpo(con: ConContext, projectId: string, id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const l = await this.loadLpo(tx, projectId, id);
      if (l.purchaseOrder.lineItems.some((li) => Number(li.quantityReceived) > 0)) throw new ConflictException('Goods have already been delivered against this LPO.');
      if (l.status === 'CANCELLED' || l.status === 'REJECTED') throw new ConflictException('This LPO is already closed.');
      await tx.purchaseOrder.update({ where: { id: l.purchaseOrderId }, data: { status: 'CANCELLED' } });
      const after = await tx.conLpo.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.audit.logInTx(tx, { action: 'con_lpo.cancelled', entityType: 'ConLpo', entityId: id, before: { status: l.status }, after: { status: after.status } });
      return this.lpoView(await this.loadLpo(tx, projectId, id));
    });
  }

  /** A delivery to site (part deliveries welcome), through the normal goods-received path. Only approved LPOs can be received. */
  async receive(con: ConContext, projectId: string, id: string, dto: GrnDto) {
    const l = await this.tenantPrisma.run((tx) => this.loadLpo(tx, projectId, id));
    if (l.status !== 'APPROVED') throw new ConflictException('Only an approved LPO can be received.');
    if (!dto.lines.some((x) => x.quantity > 0 || (x.damaged ?? 0) > 0)) throw new BadRequestException('Enter what arrived.');
    const result = await this.purchaseOrders.receive(l.purchaseOrderId, { deliveryNote: dto.deliveryNote?.trim() || undefined, notes: dto.notes?.trim() || undefined, lines: dto.lines.filter((x) => x.quantity > 0 || (x.damaged ?? 0) > 0) });
    await this.tenantPrisma.run((tx) => this.audit.logInTx(tx, { action: 'con_lpo.received', entityType: 'ConLpo', entityId: id, after: { receiptId: result.receipt?.id, receiptNumber: result.receipt?.receiptNumber, deliveryNote: dto.deliveryNote ?? null, lines: dto.lines } }));
    return { receiptNumber: result.receipt?.receiptNumber ?? null, lpo: await this.tenantPrisma.run(async (tx) => this.lpoView(await this.loadLpo(tx, projectId, id))) };
  }

  // ── Site stock and issues ──

  async stock(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      if (!p.branchId) return { items: [], value: 0 };
      const items = await tx.inventoryItem.findMany({ where: { branchId: p.branchId }, include: { variant: { include: { product: true } } } });
      const rows = items
        .map((i) => ({ variantId: i.variantId, ...variantName(i.variant), qty: Number(i.quantity), cost: i.variant.cost === null ? null : Number(i.variant.cost), value: Math.round(Number(i.quantity) * n(i.variant.cost) * 100) / 100 }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { items: rows, value: Math.round(rows.reduce((a, r) => a + r.value, 0) * 100) / 100 };
    });
  }

  /** Takes material out of the site store, for a BQ item or as wastage. Never more than is on site. */
  async issue(con: ConContext, projectId: string, dto: IssueDto) {
    const issuedAt = dto.issuedAt ?? todayKey();
    if (issuedAt > todayKey()) throw new BadRequestException('An issue cannot be dated in the future.');
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      await this.checkBqItems(tx, projectId, [dto.bqItemId]);
      const onHand = p.branchId ? n((await tx.inventoryItem.findUnique({ where: { branchId_variantId: { branchId: p.branchId, variantId: dto.variantId } } }))?.quantity) : 0;
      if (dto.qty > onHand) throw new BadRequestException(`Only ${onHand} in the site store.`);
      const kind = dto.kind ?? 'USED';
      const issue = await tx.conMaterialIssue.create({
        data: { organizationId: con.organizationId, projectId, variantId: dto.variantId, qty: dto.qty, kind, bqItemId: dto.bqItemId ?? null, issuedTo: dto.issuedTo?.trim() || null, note: dto.note?.trim() || null, issuedAt: date(issuedAt), issuedBy: con.orgUserId },
      });
      await this.inventory.recordInTx(tx, { branchId: p.branchId!, variantId: dto.variantId, type: kind === 'WASTED' ? InventoryTxnType.WASTE : InventoryTxnType.SITE_ISSUE, quantityDelta: -dto.qty, referenceId: issue.id });
      await this.audit.logInTx(tx, { action: kind === 'WASTED' ? 'con_material.wasted' : 'con_material.issued', entityType: 'ConMaterialIssue', entityId: issue.id, after: issue });
      return issue;
    });
  }

  async listIssues(projectId: string) {
    const rows = await this.tenantPrisma.run((tx) => tx.conMaterialIssue.findMany({ where: { projectId }, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }], take: 200, include: { variant: { include: { product: true } }, bqItem: { select: { code: true, description: true } } } }));
    return rows.map((r) => ({ id: r.id, ...variantName(r.variant), qty: Number(r.qty), kind: r.kind, bqItem: r.bqItem, issuedTo: r.issuedTo, note: r.note, issuedAt: day(r.issuedAt) }));
  }

  // ── BQ allowances and reconciliation ──

  async setBudget(con: ConContext, projectId: string, dto: BudgetDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.project(tx, projectId);
      await this.checkVariants(tx, [dto.variantId]);
      const before = await tx.conMaterialBudget.findUnique({ where: { projectId_variantId: { projectId, variantId: dto.variantId } } });
      const after = await tx.conMaterialBudget.upsert({ where: { projectId_variantId: { projectId, variantId: dto.variantId } }, create: { organizationId: con.organizationId, projectId, variantId: dto.variantId, qty: dto.qty }, update: { qty: dto.qty } });
      await this.audit.logInTx(tx, { action: 'con_material_budget.set', entityType: 'ConMaterialBudget', entityId: after.id, before: before ?? undefined, after });
      return after;
    });
  }

  /** Per material: BQ allowance, ordered (approved LPOs), delivered, used, wasted, on site, wastage %. */
  async reconciliation(projectId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const p = await this.project(tx, projectId);
      const [budgets, lpos, issues, stock] = await Promise.all([
        tx.conMaterialBudget.findMany({ where: { projectId } }),
        tx.conLpo.findMany({ where: { projectId, status: 'APPROVED' }, include: { purchaseOrder: { include: { lineItems: true } } } }),
        tx.conMaterialIssue.groupBy({ by: ['variantId', 'kind'], where: { projectId }, _sum: { qty: true } }),
        p.branchId ? tx.inventoryItem.findMany({ where: { branchId: p.branchId } }) : Promise.resolve([]),
      ]);
      const ids = new Set<string>([...budgets.map((b) => b.variantId), ...issues.map((i) => i.variantId), ...stock.map((s) => s.variantId)]);
      const ordered = new Map<string, number>();
      const delivered = new Map<string, number>();
      for (const l of lpos) {
        if (l.purchaseOrder.status === 'CANCELLED') continue;
        for (const li of l.purchaseOrder.lineItems) {
          ids.add(li.variantId);
          ordered.set(li.variantId, (ordered.get(li.variantId) ?? 0) + Number(li.quantityOrdered));
          delivered.set(li.variantId, (delivered.get(li.variantId) ?? 0) + Number(li.quantityReceived));
        }
      }
      const variants = await tx.productVariant.findMany({ where: { id: { in: [...ids] } }, include: { product: true } });
      const sum = (variantId: string, kind: 'USED' | 'WASTED') => n(issues.find((i) => i.variantId === variantId && i.kind === kind)?._sum.qty);
      return variants
        .map((v) => ({
          variantId: v.id,
          ...variantName(v),
          ...reconcile({
            budget: budgets.find((b) => b.variantId === v.id) ? Number(budgets.find((b) => b.variantId === v.id)!.qty) : null,
            ordered: ordered.get(v.id) ?? 0,
            delivered: delivered.get(v.id) ?? 0,
            used: sum(v.id, 'USED'),
            wasted: sum(v.id, 'WASTED'),
            onHand: n(stock.find((s) => s.variantId === v.id)?.quantity),
          }),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }
}
