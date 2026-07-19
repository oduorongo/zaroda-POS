import { Injectable, NotFoundException } from '@nestjs/common';
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
}
