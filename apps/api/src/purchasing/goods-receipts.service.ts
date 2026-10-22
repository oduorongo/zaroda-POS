import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, Prisma, PurchaseOrderStatus } from '@prisma/client';
import { AuditLogService } from '../common/audit/audit-log.service';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateGoodsReceiptDto } from './dto/goods-receipt.dto';
import {
  dueDateFor,
  isoDay,
  marginWarning,
  MarginWarning,
  receiptNumber,
  receiptSequence,
  receiptValue,
} from './payables.util';

const DEFAULT_MIN_MARGIN = 10;
const kenyaToday = () => isoDay(new Date(Date.now() + 3 * 3_600_000));
const day = (s: string) => new Date(`${s}T00:00:00Z`);

const RECEIPT_INCLUDE = {
  branch: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, reference: true } },
  lines: {
    include: {
      variant: {
        select: {
          id: true,
          sku: true,
          name: true,
          product: { select: { name: true } },
        },
      },
    },
  },
  bills: { select: { id: true, billNumber: true, total: true, status: true } },
} as const;

/**
 * Stock arriving, as one document. Everything on a delivery is checked first, then the good stock goes up through the ordinary
 * ledger (type RECEIPT, so a delivery is never confused with a correction) in the same transaction as the receipt, the purchase
 * order's progress and - if asked - the bill for what is now owed. Damaged goods are written on the receipt but never enter stock.
 */
@Injectable()
export class GoodsReceiptsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /** Receives a delivery inside a transaction that is already open. Used by the receipts endpoint and by receiving against an order. */
  async receiveInTx(tx: TenantTx, dto: CreateGoodsReceiptDto) {
    const { organizationId, orgUserId } = getTenantStore();

    // The order, locked so two deliveries booked at once cannot both take the same outstanding quantity.
    let order: Prisma.PurchaseOrderGetPayload<{
      include: { lineItems: { include: { variant: true } } };
    }> | null = null;
    if (dto.purchaseOrderId) {
      await tx.$queryRaw`SELECT id FROM purchase_orders WHERE id = ${dto.purchaseOrderId} FOR UPDATE`;
      order = await tx.purchaseOrder.findUnique({
        where: { id: dto.purchaseOrderId },
        include: { lineItems: { include: { variant: true } } },
      });
      if (!order) throw new NotFoundException('Purchase order not found');
      if (
        order.status === PurchaseOrderStatus.RECEIVED ||
        order.status === PurchaseOrderStatus.CANCELLED
      )
        throw new BadRequestException(
          `Cannot receive against a purchase order that is already ${order.status}`,
        );
    }

    const branchId = order?.branchId ?? dto.branchId;
    if (!branchId)
      throw new BadRequestException(
        'Choose the branch the stock is arriving at',
      );
    if (order && dto.branchId && dto.branchId !== order.branchId)
      throw new BadRequestException('This order is for a different branch');
    if (!(await tx.branch.findUnique({ where: { id: branchId } })))
      throw new NotFoundException('Branch not found');
    const supplierId = order?.supplierId ?? dto.supplierId ?? null;
    const supplier = supplierId
      ? await tx.supplier.findUnique({ where: { id: supplierId } })
      : null;
    if (supplierId && !supplier)
      throw new NotFoundException('Supplier not found');
    if (dto.bill && !supplier)
      throw new BadRequestException(
        'Choose the supplier to record a bill for this delivery',
      );

    // Number the receipt (per business, per year), one at a time.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'grn:' + organizationId}))`;
    const year = new Date().getUTCFullYear();
    const last = await tx.goodsReceipt.findFirst({
      where: { receiptNumber: { startsWith: `GRN-${year}-` } },
      orderBy: { receiptNumber: 'desc' },
      select: { receiptNumber: true },
    });
    const number = receiptNumber(
      year,
      (last ? receiptSequence(last.receiptNumber, year) : 0) + 1,
    );

    const receipt = await tx.goodsReceipt.create({
      data: {
        organizationId,
        branchId,
        receiptNumber: number,
        purchaseOrderId: order?.id,
        supplierId,
        deliveryNote: dto.deliveryNote || null,
        notes: dto.notes || null,
        receivedById: orgUserId,
      },
    });

    const lineById = new Map((order?.lineItems ?? []).map((l) => [l.id, l]));
    const seen = new Set<string>();
    const billLines: { quantityAccepted: number; unitCost: number | null }[] =
      [];
    const warnings: MarginWarning[] = [];
    const received: { variantId: string; accepted: number; damaged: number }[] =
      [];

    for (const l of dto.lines) {
      const accepted = l.quantity;
      const damaged = l.damaged ?? 0;
      if (accepted + damaged <= 0)
        throw new BadRequestException(
          'A line needs a quantity received or damaged',
        );

      let variantId: string;
      let poLine: NonNullable<typeof order>['lineItems'][number] | undefined;
      if (order) {
        if (!l.lineItemId)
          throw new BadRequestException(
            'Each line of a delivery against an order must say which order line it is',
          );
        poLine = lineById.get(l.lineItemId);
        if (!poLine)
          throw new NotFoundException(
            `Line item ${l.lineItemId} does not belong to this purchase order`,
          );
        if (seen.has(l.lineItemId))
          throw new BadRequestException(
            'An order line is listed twice - put the whole quantity on one line',
          );
        seen.add(l.lineItemId);
        variantId = poLine.variantId;
        const remaining =
          Number(poLine.quantityOrdered) - Number(poLine.quantityReceived);
        if (accepted > remaining)
          throw new BadRequestException(
            `Cannot receive ${accepted} for a line with only ${remaining} outstanding`,
          );
      } else {
        if (!l.variantId)
          throw new BadRequestException('Each line needs a product');
        variantId = l.variantId;
      }

      const variant =
        poLine?.variant ??
        (await tx.productVariant.findUnique({ where: { id: variantId } }));
      if (!variant) throw new NotFoundException('Product variant not found');
      if (accepted > 0)
        assertQuantityMatchesMode(
          variant.quantityMode,
          accepted,
          `Quantity received for ${variant.sku}`,
        );
      if (damaged > 0)
        assertQuantityMatchesMode(
          variant.quantityMode,
          damaged,
          `Quantity damaged for ${variant.sku}`,
        );

      // The price paid: what the delivery was charged, else the price agreed on the order.
      const paid =
        l.unitCost ??
        (poLine?.unitCost == null ? undefined : Number(poLine.unitCost));
      const previousCost = variant.cost === null ? null : Number(variant.cost);

      let batchId: string | undefined;
      if (accepted > 0) {
        if (l.batchNumber) {
          const batch = await tx.batch.create({
            data: {
              variantId,
              batchNumber: l.batchNumber,
              expiryDate: l.expiryDate ? new Date(l.expiryDate) : undefined,
              quantityReceived: accepted,
            },
          });
          batchId = batch.id;
        }
        await this.inventoryTransactions.recordInTx(tx, {
          branchId,
          variantId,
          type: InventoryTxnType.RECEIPT,
          quantityDelta: accepted,
          batchId,
          referenceId: receipt.id,
          unitCost: paid,
        });
        received.push({ variantId, accepted, damaged });
        if (poLine)
          await tx.purchaseOrderLineItem.update({
            where: { id: poLine.id },
            data: { quantityReceived: { increment: accepted } },
          });

        const fresh = await tx.productVariant.findUniqueOrThrow({
          where: { id: variantId },
          include: { product: { select: { name: true } } },
        });
        const w = marginWarning({
          variantId,
          sku: fresh.sku,
          name: fresh.name ?? fresh.product.name,
          price: Number(fresh.price),
          cost: paid ?? NaN,
          previousCost,
          minMarginPercent: dto.minMarginPercent ?? DEFAULT_MIN_MARGIN,
        });
        if (w && paid !== undefined) warnings.push(w);
      }

      billLines.push({ quantityAccepted: accepted, unitCost: paid ?? null });
      await tx.goodsReceiptLine.create({
        data: {
          receiptId: receipt.id,
          variantId,
          purchaseOrderLineId: poLine?.id,
          quantityAccepted: accepted,
          quantityDamaged: damaged,
          damagedNote: l.damagedNote || null,
          unitCost: paid,
          batchId,
        },
      });
    }

    if (order) {
      const lines = await tx.purchaseOrderLineItem.findMany({
        where: { purchaseOrderId: order.id },
      });
      const full = lines.every(
        (l) => Number(l.quantityReceived) >= Number(l.quantityOrdered),
      );
      const some = lines.some((l) => Number(l.quantityReceived) > 0);
      const status = full
        ? PurchaseOrderStatus.RECEIVED
        : some
          ? PurchaseOrderStatus.PARTIALLY_RECEIVED
          : order.status;
      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status },
      });
    }

    let bill: {
      id: string;
      billNumber: string;
      total: number;
      dueDate: string;
    } | null = null;
    if (dto.bill && supplier) {
      const total = receiptValue(billLines);
      if (total === null)
        throw new BadRequestException(
          'Enter the price paid on every line to record a bill',
        );
      if (total <= 0)
        throw new BadRequestException(
          'Nothing was accepted, so there is nothing to bill',
        );
      const billDate = dto.bill.billDate ?? kenyaToday();
      const billNumber = (
        dto.bill.billNumber ||
        dto.deliveryNote ||
        number
      ).slice(0, 60);
      try {
        const created = await tx.supplierBill.create({
          data: {
            organizationId,
            supplierId: supplier.id,
            billNumber,
            billDate: day(billDate),
            dueDate: day(
              dto.bill.dueDate ??
                dueDateFor(billDate, supplier.paymentTermsDays),
            ),
            total,
            purchaseOrderId: order?.id,
            goodsReceiptId: receipt.id,
            createdById: orgUserId,
          },
        });
        bill = {
          id: created.id,
          billNumber,
          total,
          dueDate: isoDay(created.dueDate),
        };
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        )
          throw new ConflictException(
            `${supplier.name} already has a bill numbered ${billNumber}`,
          );
        throw e;
      }
    }

    await this.auditLog.logInTx(tx, {
      action: 'goods_receipt.created',
      entityType: 'GoodsReceipt',
      entityId: receipt.id,
      after: {
        receiptNumber: number,
        purchaseOrderId: order?.id ?? null,
        branchId,
        lines: received,
        damaged: dto.lines.filter((l) => (l.damaged ?? 0) > 0).length,
        billId: bill?.id ?? null,
      },
    });

    const full = await tx.goodsReceipt.findUniqueOrThrow({
      where: { id: receipt.id },
      include: RECEIPT_INCLUDE,
    });
    return { receipt: this.view(full), warnings, bill };
  }

  /** The receipts endpoint: its own transaction. */
  create(dto: CreateGoodsReceiptDto) {
    return this.tenantPrisma.run((tx) => this.receiveInTx(tx, dto));
  }

  private view(
    r: Prisma.GoodsReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>,
  ) {
    return {
      id: r.id,
      receiptNumber: r.receiptNumber,
      createdAt: r.createdAt,
      deliveryNote: r.deliveryNote,
      notes: r.notes,
      branch: r.branch,
      supplier: r.supplier,
      purchaseOrder: r.purchaseOrder,
      bills: r.bills.map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        total: Number(b.total),
        status: b.status,
      })),
      lines: r.lines.map((l) => ({
        id: l.id,
        variantId: l.variantId,
        sku: l.variant.sku,
        name: l.variant.name ?? l.variant.product.name,
        quantityAccepted: Number(l.quantityAccepted),
        quantityDamaged: Number(l.quantityDamaged),
        damagedNote: l.damagedNote,
        unitCost: l.unitCost === null ? null : Number(l.unitCost),
        value:
          l.unitCost === null
            ? null
            : Math.round(
                Number(l.quantityAccepted) * Number(l.unitCost) * 100,
              ) / 100,
      })),
    };
  }

  async list(filters: {
    branchId?: string;
    supplierId?: string;
    purchaseOrderId?: string;
  }) {
    return this.tenantPrisma.run(async (tx) => {
      const rows = await tx.goodsReceipt.findMany({
        where: {
          branchId: filters.branchId,
          supplierId: filters.supplierId,
          purchaseOrderId: filters.purchaseOrderId,
        },
        include: RECEIPT_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      return rows.map((r) => this.view(r));
    });
  }

  async findOne(id: string) {
    const row = await this.tenantPrisma.run((tx) =>
      tx.goodsReceipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE }),
    );
    if (!row) throw new NotFoundException('Goods received note not found');
    return this.view(row);
  }
}
