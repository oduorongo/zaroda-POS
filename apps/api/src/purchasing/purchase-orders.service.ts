import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, PurchaseOrderStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { GoodsReceiptsService } from './goods-receipts.service';

const PURCHASE_ORDER_INCLUDE = {
  supplier: true,
  branch: { select: { name: true } },
  createdBy: { select: { id: true, user: { select: { fullName: true } } } },
  lineItems: { include: { variant: { include: { product: true } } } },
} as const;

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
    private readonly receipts: GoodsReceiptsService,
  ) {}

  async create(dto: CreatePurchaseOrderDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, supplier] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.supplier.findUnique({ where: { id: dto.supplierId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!supplier) throw new NotFoundException('Supplier not found');

      const variantIds = dto.lineItems.map((l) => l.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
      });
      if (variants.length !== new Set(variantIds).size) {
        throw new NotFoundException(
          'One or more product variants were not found',
        );
      }
      const variantById = new Map(variants.map((v) => [v.id, v]));
      for (const l of dto.lineItems) {
        const variant = variantById.get(l.variantId)!;
        assertQuantityMatchesMode(
          variant.quantityMode,
          l.quantityOrdered,
          `Quantity ordered for ${variant.sku}`,
        );
      }

      const { organizationId, orgUserId } = getTenantStore();
      const order = await tx.purchaseOrder.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          reference: dto.reference,
          notes: dto.notes,
          createdById: orgUserId,
          status: PurchaseOrderStatus.ORDERED,
          lineItems: {
            create: dto.lineItems.map((l) => ({
              variantId: l.variantId,
              quantityOrdered: l.quantityOrdered,
              unitCost: l.unitCost,
            })),
          },
        },
        include: PURCHASE_ORDER_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'purchase_order.created',
        entityType: 'PurchaseOrder',
        entityId: order.id,
        after: {
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          lineItems: dto.lineItems,
        },
      });

      return order;
    });
  }

  findAll(filters: { branchId?: string; supplierId?: string; status?: PurchaseOrderStatus }) {
    return this.tenantPrisma.run((tx) =>
      tx.purchaseOrder.findMany({
        where: {
          branchId: filters.branchId,
          supplierId: filters.supplierId,
          status: filters.status,
        },
        include: PURCHASE_ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const order = await this.tenantPrisma.run((tx) =>
      tx.purchaseOrder.findUnique({
        where: { id },
        include: PURCHASE_ORDER_INCLUDE,
      }),
    );
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  /**
   * Receiving is partial-friendly: a delivery rarely arrives as one
   * complete shipment, so each call only needs to cover the lines/quantities
   * that actually showed up this time. Every accepted line goes through the
   * same stock-movement path ad-hoc receiving uses (BatchesService /
   * InventoryTransactionsService.recordInTx) with referenceId set to this
   * PO's id, so a purchase order's receipts show up in the normal
   * inventory ledger, not a separate untracked one - the PO's
   * quantityReceived columns are just a fast-read summary on top of that
   * ledger, same relationship as InventoryItem.quantity to
   * InventoryTransaction.
   */
  async receive(id: string, dto: ReceivePurchaseOrderDto) {
    return this.tenantPrisma.run(async (tx) => {
      const { receipt, warnings, bill } = await this.receipts.receiveInTx(tx, {
        purchaseOrderId: id,
        deliveryNote: dto.deliveryNote,
        notes: dto.notes,
        bill: dto.bill,
        minMarginPercent: dto.minMarginPercent,
        lines: dto.lines.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity, damaged: l.damaged, damagedNote: l.damagedNote, batchNumber: l.batchNumber, expiryDate: l.expiryDate, unitCost: l.unitCost })),
      });
      const order = await tx.purchaseOrder.findUnique({ where: { id }, include: PURCHASE_ORDER_INCLUDE });
      return { ...order, receipt, warnings, bill };
    });
  }

  async cancel(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Purchase order not found');
      if (
        order.status === PurchaseOrderStatus.RECEIVED ||
        order.status === PurchaseOrderStatus.PARTIALLY_RECEIVED
      ) {
        throw new BadRequestException(
          'Cannot cancel a purchase order that has already received stock',
        );
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: { status: PurchaseOrderStatus.CANCELLED },
      });
    });
  }
}
