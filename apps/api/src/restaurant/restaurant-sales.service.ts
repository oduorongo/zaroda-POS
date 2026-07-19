import { Injectable, NotFoundException } from '@nestjs/common';
import { RestaurantTableStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { CreateTableSaleDto } from './dto/create-table-sale.dto';

@Injectable()
export class RestaurantSalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sales: SalesService,
  ) {}

  /**
   * A module calling into core exactly as DESIGN.md §3 intends: this
   * service imports and calls SalesService.create() directly rather than
   * duplicating any sale-completion logic - the restaurant module gets
   * every core guarantee (idempotency, discount/loyalty handling,
   * inventory decrement, audit logging, the sale.beforeComplete/
   * afterComplete hooks) for free, with zero changes to SalesService
   * itself.
   *
   * Not atomic across all three steps below (validate table -> complete
   * the sale -> link it to the table + mark the table for cleaning) -
   * SalesService.create() always opens and commits its own transaction,
   * so a crash between steps 2 and 3 could leave a genuinely completed
   * sale not yet linked to its table. Accepted deliberately, the same
   * "never lose a sale, reconcile after the fact" principle already
   * applied elsewhere in this system (DESIGN.md §6) - the sale itself is
   * never at risk, only its restaurant-specific metadata, which is
   * cheap to detect and fix (an unlinked RestaurantSaleTable is a
   * trivial reconciliation query) compared to losing or double-charging
   * a sale.
   */
  async createForTable(tableId: string, dto: CreateTableSaleDto) {
    const table = await this.tenantPrisma.run((tx) =>
      tx.restaurantTable.findUnique({ where: { id: tableId } }),
    );
    if (!table) throw new NotFoundException('Table not found');

    const sale = await this.sales.create({
      clientId: dto.clientId,
      branchId: table.branchId,
      terminalId: dto.terminalId,
      cashierSessionId: dto.cashierSessionId,
      shiftId: dto.shiftId,
      lineItems: dto.lineItems,
      payments: dto.payments,
      discount: dto.discount,
      customerId: dto.customerId,
      redeemPoints: dto.redeemPoints,
    });

    return this.tenantPrisma.run(async (tx) => {
      // Idempotent the same way the sale itself is: a retried submission
      // with the same clientId resolves to the same sale above, and this
      // just confirms the link already exists rather than violating the
      // unique constraint on saleId trying to recreate it.
      const existingLink = await tx.restaurantSaleTable.findUnique({
        where: { saleId: sale.id },
      });
      if (existingLink) return { sale, tableLink: existingLink };

      const tableLink = await tx.restaurantSaleTable.create({
        data: { saleId: sale.id, tableId },
      });

      // A dine-in table needs bussing after the check is paid - staff
      // explicitly mark it AVAILABLE again once cleared, rather than this
      // jumping straight back to available on its own.
      await tx.restaurantTable.update({
        where: { id: tableId },
        data: { status: RestaurantTableStatus.NEEDS_CLEANING },
      });

      return { sale, tableLink };
    });
  }
}
