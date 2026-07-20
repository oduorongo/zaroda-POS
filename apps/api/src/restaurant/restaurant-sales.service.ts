import { Injectable, NotFoundException } from '@nestjs/common';
import { RestaurantTableStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { SalesService } from '../sales/sales.service';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { CreateTableSaleDto } from './dto/create-table-sale.dto';

@Injectable()
export class RestaurantSalesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly sales: SalesService,
    private readonly kitchenTickets: KitchenTicketsService,
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
   * Not atomic across the remaining steps below (complete the sale ->
   * link it to the table + create kitchen tickets + mark the table for
   * cleaning) - SalesService.create() always opens and commits its own
   * transaction, so a crash between them could leave a genuinely
   * completed sale not yet linked to its table. Accepted deliberately,
   * the same "never lose a sale, reconcile after the fact" principle
   * already applied elsewhere in this system (DESIGN.md §6) - the sale
   * itself is never at risk, only its restaurant-specific metadata,
   * which is cheap to detect and fix (an unlinked RestaurantSaleTable is
   * a trivial reconciliation query) compared to losing or double-
   * charging a sale.
   *
   * Station IDs are validated BEFORE calling sales.create(), not left to
   * fail during ticket creation afterward - live-testing this exact flow
   * caught a real bug where an unknown stationId produced a 404 to the
   * client while the sale had already completed and decremented stock,
   * with zero kitchen tickets ever created for it: a paid-for order that
   * would never reach the kitchen. Validating everything that CAN be
   * checked up front, before any core state changes, avoids that class
   * of "the sale succeeded but silently produced nothing useful" failure
   * for anything within this method's control.
   */
  async createForTable(tableId: string, dto: CreateTableSaleDto) {
    const table = await this.tenantPrisma.run((tx) =>
      tx.restaurantTable.findUnique({ where: { id: tableId } }),
    );
    if (!table) throw new NotFoundException('Table not found');

    await this.kitchenTickets.assertStationsExist(
      dto.lineItems.map((li) => li.stationId),
    );

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
      if (existingLink) {
        const [existingTip, existingTickets] = await Promise.all([
          tx.restaurantSaleTip.findUnique({ where: { saleId: sale.id } }),
          tx.kitchenTicket.findMany({ where: { saleId: sale.id } }),
        ]);
        return {
          sale,
          tableLink: existingLink,
          tip: existingTip,
          tickets: existingTickets,
        };
      }

      const tableLink = await tx.restaurantSaleTable.create({
        data: { saleId: sale.id, tableId },
      });

      const tickets = await this.kitchenTickets.createTicketsInTx(
        tx,
        sale.id,
        dto.lineItems,
      );

      // Tracked separately from the sale itself (see the schema comment
      // on RestaurantSaleTip) - only creates a row when there's actually
      // a nonzero tip/service charge, so a plain order doesn't leave a
      // pointless all-zero extension row behind.
      const tipAmount = dto.tipAmount ?? 0;
      const serviceChargeAmount = dto.serviceChargeAmount ?? 0;
      const tip =
        tipAmount > 0 || serviceChargeAmount > 0
          ? await tx.restaurantSaleTip.create({
              data: { saleId: sale.id, tipAmount, serviceChargeAmount },
            })
          : null;

      // A dine-in table needs bussing after the check is paid - staff
      // explicitly mark it AVAILABLE again once cleared, rather than this
      // jumping straight back to available on its own.
      await tx.restaurantTable.update({
        where: { id: tableId },
        data: { status: RestaurantTableStatus.NEEDS_CLEANING },
      });

      return { sale, tableLink, tip, tickets };
    });
  }
}
