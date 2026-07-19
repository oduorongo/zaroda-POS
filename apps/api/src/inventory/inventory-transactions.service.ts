import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LowStockAlertStatus } from '@prisma/client';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';

@Injectable()
export class InventoryTransactionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly events: EventEmitter2,
  ) {}

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
   * The actual logic, parameterized on an already-open tenant-scoped `tx`.
   * Callers that are themselves already inside a TenantScopedPrismaService
   * transaction (e.g. SalesService completing a sale) MUST use this
   * directly with their own `tx`, not `record()` - `record()` opens a new
   * top-level transaction via the raw PrismaClient, which Prisma cannot
   * nest inside an existing interactive transaction. Using `record()` from
   * inside another transaction would silently run the inventory write in
   * its own separate transaction, breaking atomicity with whatever the
   * caller is doing (e.g. a sale could "complete" while its inventory
   * decrement rolls back independently, or vice versa).
   */
  async recordInTx(tx: TenantTx, dto: CreateInventoryTransactionDto) {
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

    // Only fired for actual decrements, not receipts/adjustments-upward -
    // "beforeDecrement" is specifically the point a module might want to
    // veto (DESIGN.md §3 - e.g. a future pharmacy module blocking a sale
    // of an expired batch). Awaited so a throw here aborts the whole
    // caller's transaction (e.g. SalesService.create()'s per-line-item
    // loop) rather than the veto being silently ignored.
    if (dto.quantityDelta < 0) {
      await this.events.emitAsync('inventory.beforeDecrement', {
        branchId: dto.branchId,
        variantId: dto.variantId,
        quantityDelta: dto.quantityDelta,
        type: dto.type,
        batchId: dto.batchId,
      });
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

    // Atomic `increment`, not a read-then-write - applied at the database's
    // row-lock level, so concurrent transactions against the same
    // branch+variant can't race each other into an inconsistent derived
    // count without needing application-level locking (DESIGN.md §4/§7).
    const item = await tx.inventoryItem.upsert({
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

    await this.syncLowStockAlert(tx, item);

    return transaction;
  }

  /**
   * Every quantity change funnels through recordInTx, so this is the one
   * place a low-stock crossing can be detected - no separate poll/cron
   * needed. A threshold of 0 means the tenant hasn't set one for this item
   * (opted out), so it's never alerted on. At most one OPEN alert exists
   * per branch+variant: re-crossing below the threshold while already OPEN
   * doesn't create a duplicate, and rising back above it auto-resolves the
   * existing alert. This table is the durable record a future SMS/
   * notification worker would consume once Redis/BullMQ and Africa's
   * Talking credentials are provisioned (DESIGN.md Phase 2 roadmap) - not
   * built yet, same as M-Pesa was scaffolded ahead of real credentials.
   */
  private async syncLowStockAlert(
    tx: TenantTx,
    item: {
      branchId: string;
      variantId: string;
      quantity: number;
      lowStockThreshold: number;
    },
  ) {
    if (item.lowStockThreshold <= 0) return;

    const openAlert = await tx.lowStockAlert.findFirst({
      where: {
        branchId: item.branchId,
        variantId: item.variantId,
        status: LowStockAlertStatus.OPEN,
      },
    });

    if (item.quantity <= item.lowStockThreshold) {
      if (openAlert) return;
      const { organizationId } = getTenantStore();
      await tx.lowStockAlert.create({
        data: {
          organizationId,
          branchId: item.branchId,
          variantId: item.variantId,
          quantity: item.quantity,
          threshold: item.lowStockThreshold,
        },
      });
    } else if (openAlert) {
      await tx.lowStockAlert.update({
        where: { id: openAlert.id },
        data: { status: LowStockAlertStatus.RESOLVED, resolvedAt: new Date() },
      });
    }
  }

  /** Standalone entry point (e.g. the /inventory/transactions endpoint) - opens its own transaction. */
  record(dto: CreateInventoryTransactionDto) {
    return this.tenantPrisma.run((tx) => this.recordInTx(tx, dto));
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
