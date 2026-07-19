import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';

@Injectable()
export class InventoryTransactionsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  private async assertBranchAndVariantExist(
    branchId: string,
    variantId: string,
    tx: TenantTx,
  ) {
    const [branch, variant] = await Promise.all([
      tx.branch.findUnique({ where: { id: branchId } }),
      tx.productVariant.findUnique({ where: { id: variantId } }),
    ]);
    if (!branch) throw new NotFoundException('Branch not found');
    if (!variant) throw new NotFoundException('Product variant not found');
  }

  /**
   * Writes the ledger row (the source of truth - see DESIGN.md §4) and
   * atomically keeps InventoryItem.quantity in sync via an `increment`, not
   * a read-then-write - the increment is applied at the database's row-lock
   * level, so concurrent transactions against the same branch+variant can't
   * race each other into an inconsistent derived count, without needing
   * application-level locking.
   */
  async record(dto: CreateInventoryTransactionDto) {
    return this.tenantPrisma.run(async (tx) => {
      await this.assertBranchAndVariantExist(dto.branchId, dto.variantId, tx);

      if (dto.batchId) {
        const batch = await tx.batch.findUnique({ where: { id: dto.batchId } });
        if (!batch) throw new NotFoundException('Batch not found');
        if (batch.variantId !== dto.variantId) {
          throw new BadRequestException(
            'This batch belongs to a different product variant',
          );
        }
      }

      const transaction = await tx.inventoryTransaction.create({
        data: {
          branchId: dto.branchId,
          variantId: dto.variantId,
          batchId: dto.batchId,
          type: dto.type,
          quantityDelta: dto.quantityDelta,
          referenceId: dto.referenceId,
        },
      });

      await tx.inventoryItem.upsert({
        where: {
          branchId_variantId: {
            branchId: dto.branchId,
            variantId: dto.variantId,
          },
        },
        create: {
          branchId: dto.branchId,
          variantId: dto.variantId,
          quantity: dto.quantityDelta,
        },
        update: { quantity: { increment: dto.quantityDelta } },
      });

      return transaction;
    });
  }

  findAll(filters: { branchId?: string; variantId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.inventoryTransaction.findMany({
        where: { branchId: filters.branchId, variantId: filters.variantId },
        include: { variant: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
