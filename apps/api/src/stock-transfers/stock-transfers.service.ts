import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateStockTransferDto } from './dto/create-stock-transfer.dto';

@Injectable()
export class StockTransfersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * A single-step transfer, not a multi-stage in-transit/receiving
   * workflow (DESIGN.md doesn't call for one at pilot scale - see the
   * schema comment on StockTransfer). Completes atomically: both ledger
   * entries (the deduction at the source, the addition at the
   * destination) and the transfer record itself commit or roll back
   * together, so a transfer can never leave stock deducted from one
   * branch without appearing at the other.
   */
  async create(dto: CreateStockTransferDto) {
    if (dto.fromBranchId === dto.toBranchId) {
      throw new BadRequestException('Cannot transfer stock to the same branch');
    }

    return this.tenantPrisma.run(async (tx) => {
      const [fromBranch, toBranch, variant] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.fromBranchId } }),
        tx.branch.findUnique({ where: { id: dto.toBranchId } }),
        tx.productVariant.findUnique({ where: { id: dto.variantId } }),
      ]);
      if (!fromBranch) throw new NotFoundException('Source branch not found');
      if (!toBranch)
        throw new NotFoundException('Destination branch not found');
      if (!variant) throw new NotFoundException('Product variant not found');

      const { organizationId, orgUserId } = getTenantStore();
      const transfer = await tx.stockTransfer.create({
        data: {
          organizationId,
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          notes: dto.notes,
          createdById: orgUserId,
        },
      });

      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.fromBranchId,
        variantId: dto.variantId,
        type: InventoryTxnType.TRANSFER,
        quantityDelta: -dto.quantity,
        referenceId: transfer.id,
      });
      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.toBranchId,
        variantId: dto.variantId,
        type: InventoryTxnType.TRANSFER,
        quantityDelta: dto.quantity,
        referenceId: transfer.id,
      });

      await this.auditLog.logInTx(tx, {
        action: 'stock_transfer.created',
        entityType: 'StockTransfer',
        entityId: transfer.id,
        after: {
          fromBranchId: dto.fromBranchId,
          toBranchId: dto.toBranchId,
          variantId: dto.variantId,
          quantity: dto.quantity,
        },
      });

      return transfer;
    });
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.stockTransfer.findMany({
        where: filters.branchId
          ? {
              OR: [
                { fromBranchId: filters.branchId },
                { toBranchId: filters.branchId },
              ],
            }
          : {},
        include: {
          variant: { include: { product: true } },
          fromBranch: { select: { name: true } },
          toBranch: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
