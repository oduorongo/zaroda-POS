import { Injectable, NotFoundException } from '@nestjs/common';
import { InventoryTxnType } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { InventoryTransactionsService } from './inventory-transactions.service';
import { CreateBatchDto } from './dto/create-batch.dto';

@Injectable()
export class BatchesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
  ) {}

  /**
   * Creating a batch always receives stock in the same operation - a
   * batch record with no corresponding inventory increment would be a
   * paper trail for goods that were never actually added to stock, which
   * is worse than not tracking the batch at all. Goes through the same
   * recordInTx ledger path every other stock movement uses
   * (InventoryTransactionsService), type ADJUSTMENT, referencing the new
   * batch's id - so this batch's receipt shows up in the normal
   * transaction history, not a separate untracked path.
   */
  async create(dto: CreateBatchDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [variant, branch] = await Promise.all([
        tx.productVariant.findUnique({ where: { id: dto.variantId } }),
        tx.branch.findUnique({ where: { id: dto.branchId } }),
      ]);
      if (!variant) throw new NotFoundException('Product variant not found');
      if (!branch) throw new NotFoundException('Branch not found');

      const batch = await tx.batch.create({
        data: {
          variantId: dto.variantId,
          batchNumber: dto.batchNumber,
          expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
          quantityReceived: dto.quantityReceived,
        },
      });

      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.branchId,
        variantId: dto.variantId,
        type: InventoryTxnType.ADJUSTMENT,
        quantityDelta: dto.quantityReceived,
        batchId: batch.id,
        referenceId: batch.id,
      });

      return batch;
    });
  }

  findAll(filters: { variantId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.batch.findMany({
        where: { variantId: filters.variantId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
