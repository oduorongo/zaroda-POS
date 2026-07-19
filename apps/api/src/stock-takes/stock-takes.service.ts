import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, StockTakeStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateStockTakeDto } from './dto/create-stock-take.dto';
import { RecordCountDto } from './dto/record-count.dto';

const STOCK_TAKE_INCLUDE = {
  lines: { include: { variant: { include: { product: true } } } },
} as const;

@Injectable()
export class StockTakesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Snapshots the current system quantity for every variant with a stock
   * record at this branch into one line each - so a count that takes
   * hours to walk the floor is compared against a fixed point in time,
   * not a quantity that might keep moving from concurrent sales while the
   * count is in progress.
   */
  async open(dto: CreateStockTakeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: dto.branchId },
      });
      if (!branch) throw new NotFoundException('Branch not found');

      const { organizationId, orgUserId } = getTenantStore();
      const items = await tx.inventoryItem.findMany({
        where: { branchId: dto.branchId },
      });

      const stockTake = await tx.stockTake.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          startedById: orgUserId,
          lines: {
            create: items.map((item) => ({
              variantId: item.variantId,
              systemQuantity: item.quantity,
            })),
          },
        },
        include: STOCK_TAKE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'stock_take.opened',
        entityType: 'StockTake',
        entityId: stockTake.id,
        after: { branchId: dto.branchId, lineCount: items.length },
      });

      return stockTake;
    });
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.stockTake.findMany({
        where: { branchId: filters.branchId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const stockTake = await this.tenantPrisma.run((tx) =>
      tx.stockTake.findUnique({ where: { id }, include: STOCK_TAKE_INCLUDE }),
    );
    if (!stockTake) throw new NotFoundException('Stock take not found');
    return stockTake;
  }

  async recordCount(stockTakeId: string, lineId: string, dto: RecordCountDto) {
    return this.tenantPrisma.run(async (tx) => {
      const stockTake = await tx.stockTake.findUnique({
        where: { id: stockTakeId },
      });
      if (!stockTake) throw new NotFoundException('Stock take not found');
      if (stockTake.status !== StockTakeStatus.OPEN) {
        throw new BadRequestException(
          'This stock take is already completed - counts can no longer be edited',
        );
      }

      const line = await tx.stockTakeLine.findFirst({
        where: { id: lineId, stockTakeId },
      });
      if (!line) throw new NotFoundException('Stock take line not found');

      return tx.stockTakeLine.update({
        where: { id: lineId },
        data: {
          countedQuantity: dto.countedQuantity,
          variance: dto.countedQuantity - line.systemQuantity,
        },
      });
    });
  }

  /**
   * Reconciles every counted line's variance into the inventory ledger as
   * an ADJUSTMENT (never a silent overwrite of InventoryItem - the
   * discrepancy itself becomes a traceable ledger entry, same as every
   * other stock movement). Lines nobody got around to counting are simply
   * left alone - not treated as "counted zero".
   */
  async complete(stockTakeId: string) {
    return this.tenantPrisma.run(async (tx) => {
      const stockTake = await tx.stockTake.findUnique({
        where: { id: stockTakeId },
        include: STOCK_TAKE_INCLUDE,
      });
      if (!stockTake) throw new NotFoundException('Stock take not found');
      if (stockTake.status !== StockTakeStatus.OPEN) {
        throw new BadRequestException('This stock take is already completed');
      }

      let adjustedCount = 0;
      for (const line of stockTake.lines) {
        if (line.countedQuantity === null || line.variance === 0) continue;
        await this.inventoryTransactions.recordInTx(tx, {
          branchId: stockTake.branchId,
          variantId: line.variantId,
          type: InventoryTxnType.STOCKTAKE,
          quantityDelta: line.variance as number,
          referenceId: stockTake.id,
        });
        adjustedCount++;
      }

      const updated = await tx.stockTake.update({
        where: { id: stockTakeId },
        data: { status: StockTakeStatus.COMPLETED, completedAt: new Date() },
        include: STOCK_TAKE_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'stock_take.completed',
        entityType: 'StockTake',
        entityId: stockTakeId,
        after: { adjustedCount },
      });

      return updated;
    });
  }
}
