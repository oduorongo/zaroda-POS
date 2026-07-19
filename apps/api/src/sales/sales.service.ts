import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, SaleStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { AuditLogService } from '../common/audit/audit-log.service';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { VoidSaleDto } from './dto/void-sale.dto';

const SALE_INCLUDE = { lineItems: true, payments: true } as const;

@Injectable()
export class SalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Cash-only in this increment (DESIGN.md sales-pipeline decision): M-Pesa
   * STK push is async (the customer approves on their phone before it
   * settles), which needs a pending-payment status and a callback webhook
   * to complete correctly - deferred until there are real credentials to
   * design and test that flow against, rather than guess at it. Rejecting
   * non-cash methods here is deliberate, not an oversight - see
   * payments/mpesa-payment.processor.ts.
   */
  async create(dto: CreateSaleDto) {
    const nonCash = dto.payments.find((p) => p.method !== 'CASH');
    if (nonCash) {
      throw new BadRequestException(
        `Payment method ${nonCash.method} is not wired into sale completion yet - only CASH is supported until M-Pesa credentials are available (see payments/mpesa-payment.processor.ts).`,
      );
    }

    return this.tenantPrisma.run(async (tx) => {
      // Idempotent: a retried submission with the same client-generated id
      // returns the original sale rather than erroring or double-selling
      // (DESIGN.md §6 - the same principle applies online, not just to
      // offline sync replay, since network retries can duplicate a submit).
      const existing = await tx.sale.findUnique({
        where: { clientId: dto.clientId },
        include: SALE_INCLUDE,
      });
      if (existing) return existing;

      const [branch, terminal, cashierSession] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.terminal.findUnique({ where: { id: dto.terminalId } }),
        tx.cashierSession.findUnique({ where: { id: dto.cashierSessionId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!terminal) throw new NotFoundException('Terminal not found');
      if (!cashierSession)
        throw new NotFoundException('Cashier session not found');
      if (cashierSession.pinEndedAt) {
        throw new BadRequestException(
          'This cashier session has already ended - PIN in again to start a new one',
        );
      }

      const variantIds = dto.lineItems.map((li) => li.variantId);
      const variants = await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        include: { product: { include: { taxClass: true } } },
      });
      const variantById = new Map(variants.map((v) => [v.id, v]));
      const missing = variantIds.filter((id) => !variantById.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Unknown product variant(s): ${missing.join(', ')}`,
        );
      }

      let total = 0;
      const lineItemRows = dto.lineItems.map((li) => {
        const variant = variantById.get(li.variantId)!;
        const unitPrice = Number(variant.price);
        const lineSubtotal = unitPrice * li.quantity;
        const taxClass = variant.product.taxClass;
        const taxAmount =
          taxClass && !taxClass.isExempt
            ? lineSubtotal * Number(taxClass.rate)
            : 0;
        total += lineSubtotal + taxAmount;
        return {
          variantId: li.variantId,
          quantity: li.quantity,
          unitPrice,
          taxAmount,
        };
      });

      const paymentsTotal = dto.payments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(paymentsTotal - total) > 0.01) {
        throw new BadRequestException(
          `Payments total ${paymentsTotal.toFixed(2)} does not match sale total ${total.toFixed(2)}`,
        );
      }

      const { organizationId } = getTenantStore();
      const sale = await tx.sale.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          terminalId: dto.terminalId,
          shiftId: dto.shiftId,
          cashierSessionId: dto.cashierSessionId,
          cashierOrgUserId: cashierSession.orgUserId,
          clientId: dto.clientId,
          status: SaleStatus.COMPLETED,
          total,
          lineItems: { create: lineItemRows },
          payments: {
            create: dto.payments.map((p) => ({
              method: p.method,
              amount: p.amount,
            })),
          },
        },
        include: SALE_INCLUDE,
      });

      for (const line of lineItemRows) {
        await this.inventoryTransactions.recordInTx(tx, {
          branchId: dto.branchId,
          variantId: line.variantId,
          type: InventoryTxnType.SALE,
          quantityDelta: -line.quantity,
          referenceId: sale.id,
        });
      }

      await this.auditLog.logInTx(tx, {
        action: 'sale.created',
        entityType: 'Sale',
        entityId: sale.id,
        after: { total, lineItemCount: lineItemRows.length },
        terminalId: dto.terminalId,
      });

      return sale;
    });
  }

  findAll(filters: { branchId?: string; shiftId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.sale.findMany({
        where: { branchId: filters.branchId, shiftId: filters.shiftId },
        include: SALE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const sale = await this.tenantPrisma.run((tx) =>
      tx.sale.findUnique({ where: { id }, include: SALE_INCLUDE }),
    );
    if (!sale) throw new NotFoundException('Sale not found');
    return sale;
  }

  /**
   * Reverses the sale's inventory decrement and marks it VOIDED - never
   * deletes the row (audit trail requirement, DESIGN.md §3). A sale can
   * only be voided once; voiding an already-voided sale is rejected rather
   * than silently double-reversing inventory.
   */
  async void(id: string, dto: VoidSaleDto) {
    return this.tenantPrisma.run(async (tx: TenantTx) => {
      const sale = await tx.sale.findUnique({
        where: { id },
        include: { lineItems: true },
      });
      if (!sale) throw new NotFoundException('Sale not found');
      if (sale.status === SaleStatus.VOIDED) {
        throw new ConflictException('This sale has already been voided');
      }

      for (const line of sale.lineItems) {
        await this.inventoryTransactions.recordInTx(tx, {
          branchId: sale.branchId,
          variantId: line.variantId,
          type: InventoryTxnType.RETURN,
          quantityDelta: line.quantity,
          referenceId: sale.id,
        });
      }

      const updated = await tx.sale.update({
        where: { id },
        data: { status: SaleStatus.VOIDED },
        include: SALE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'sale.voided',
        entityType: 'Sale',
        entityId: id,
        before: { status: sale.status },
        after: { status: SaleStatus.VOIDED, reason: dto.reason },
      });

      return updated;
    });
  }
}
