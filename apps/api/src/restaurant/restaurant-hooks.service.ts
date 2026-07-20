import { Injectable, Logger } from '@nestjs/common';
import { Refund, Sale } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';

/**
 * The manifest's `hooks` array (DESIGN.md §3) takes plain
 * `(payload: unknown) => Promise<void>` handlers with no DI context of
 * their own, so the actual logic lives here as bound methods of an
 * injectable service - RestaurantModule wires `this.hooks.onSaleAfterComplete
 * .bind(this.hooks)` into the manifest at registration time.
 */
@Injectable()
export class RestaurantHooksService {
  private readonly logger = new Logger(RestaurantHooksService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Fires for EVERY completed sale system-wide, not just restaurant ones
   * - core has no concept of "restaurant" and doesn't filter on our
   * behalf.
   *
   * Deliberately does NOT try to look up `restaurantSaleTable` here to
   * decide relevance, even though that seems like the obvious way to
   * filter to "only restaurant orders" - building and live-testing this
   * exact check is what surfaced a real ordering constraint worth
   * documenting: RestaurantSalesService.createForTable() calls
   * SalesService.create() (which is what emits this event) and only
   * creates the RestaurantSaleTable link AFTER that call returns - so at
   * the moment this hook runs, the link this sale is about to get
   * genuinely does not exist yet. A hook cannot see synchronous
   * extension data its own caller hasn't written yet. The lesson: if a
   * module needs extension data to exist atomically alongside a sale, it
   * has to write that data itself as the direct caller (exactly what
   * RestaurantSalesService already does for the table link/status
   * update), not lean on an afterComplete hook for it. This hook proves
   * the mechanism itself fires for every sale, which is the thing that
   * was actually broken before Phase 4 (see industry-module-manifest
   * .interface.ts) - not a place to also solve synchronous linkage.
   */
  async onSaleAfterComplete(payload: unknown): Promise<void> {
    const sale = payload as Sale;
    this.logger.log(`sale.afterComplete hook fired for sale ${sale.id}`);
    await this.tenantPrisma.run((tx) =>
      this.auditLog.logInTx(tx, {
        action: 'restaurant.sale_hook_fired',
        entityType: 'Sale',
        entityId: sale.id,
        after: { total: sale.total },
      }),
    );
  }

  /**
   * The fourth core domain event (see industry-module-manifest.interface
   * .ts), wired here as the second real subscriber - a genuinely
   * plausible restaurant use (flagging a refunded ticket for the kitchen
   * to know an item was comped/returned), and a live way to verify
   * SalesService.refund() actually fires this event the same way
   * sale.afterComplete does, not just an assumption because the code
   * looks the same.
   */
  async onRefundAfterApproved(payload: unknown): Promise<void> {
    const refund = payload as Refund;
    this.logger.log(
      `refund.afterApproved hook fired for refund ${refund.id} (sale ${refund.saleId})`,
    );
    await this.tenantPrisma.run((tx) =>
      this.auditLog.logInTx(tx, {
        action: 'restaurant.refund_hook_fired',
        entityType: 'Refund',
        entityId: refund.id,
        after: { saleId: refund.saleId, amount: refund.amount },
      }),
    );
  }
}
