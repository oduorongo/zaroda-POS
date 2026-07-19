import { Injectable, NotFoundException } from '@nestjs/common';
import { LowStockAlertStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';

@Injectable()
export class InventoryItemsService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  /**
   * `quantity` here is the materialized column, not a live SUM over the
   * ledger - see InventoryTransactionsService.record() for how it's kept in
   * sync via atomic increments. Fine for pilot scale; if it were ever
   * suspected to drift, recomputing from inventory_transactions is the
   * source of truth to reconcile against.
   */
  async findAllForBranch(branchId: string, lowStockOnly?: boolean) {
    const items = await this.tenantPrisma.run((tx) =>
      tx.inventoryItem.findMany({
        where: { branchId },
        include: { variant: { include: { product: true } } },
        orderBy: { variant: { sku: 'asc' } },
      }),
    );
    // Prisma Client can't compare one column to another (quantity vs
    // lowStockThreshold) in a `where` filter - filtering in memory is fine
    // at pilot scale (a branch's distinct variant count, not transaction
    // volume) rather than reaching for $queryRaw here.
    return lowStockOnly
      ? items.filter((item) => item.quantity <= item.lowStockThreshold)
      : items;
  }

  async findOne(branchId: string, variantId: string) {
    const item = await this.tenantPrisma.run((tx) =>
      tx.inventoryItem.findUnique({
        where: { branchId_variantId: { branchId, variantId } },
        include: { variant: { include: { product: true } } },
      }),
    );
    if (!item)
      throw new NotFoundException(
        'No inventory record for this branch/variant - it may just never have had a stock movement yet',
      );
    return item;
  }

  /**
   * Upserts because a branch+variant may not have an InventoryItem row yet
   * (one is only created on the first stock movement) - a manager should
   * still be able to set a threshold ahead of the first delivery.
   */
  async setLowStockThreshold(
    branchId: string,
    variantId: string,
    lowStockThreshold: number,
  ) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, variant] = await Promise.all([
        tx.branch.findUnique({ where: { id: branchId } }),
        tx.productVariant.findUnique({ where: { id: variantId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!variant) throw new NotFoundException('Product variant not found');

      return tx.inventoryItem.upsert({
        where: { branchId_variantId: { branchId, variantId } },
        create: { branchId, variantId, lowStockThreshold },
        update: { lowStockThreshold },
      });
    });
  }

  findLowStockAlerts(filters: {
    branchId?: string;
    includeResolved?: boolean;
  }) {
    return this.tenantPrisma.run((tx) =>
      tx.lowStockAlert.findMany({
        where: {
          branchId: filters.branchId,
          status: filters.includeResolved
            ? undefined
            : LowStockAlertStatus.OPEN,
        },
        include: { variant: { include: { product: true } }, branch: true },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
