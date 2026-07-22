import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { CreateRepackagingDto } from './dto/create-repackaging.dto';

@Injectable()
export class RepackagingService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * Breaking bulk stock into resale-sized units - a 20L jerrycan of cooking
   * oil into Ksh 50 scoops, a 50kg bag of rice into Ksh 30 portions. Single
   * branch (unlike StockTransfer's two), but the same atomicity shape: one
   * REPACK InventoryTransaction decrementing the bulk variant, one REPACK
   * InventoryTransaction incrementing the resale variant, both referencing
   * this row's id, all in one transaction - so a repackaging can never
   * leave bulk stock consumed without the resale stock actually appearing.
   */
  async create(dto: CreateRepackagingDto) {
    if (dto.fromVariantId === dto.toVariantId) {
      throw new BadRequestException(
        'Cannot repackage a product variant into itself',
      );
    }

    return this.tenantPrisma.run(async (tx) => {
      const [branch, fromVariant, toVariant] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.productVariant.findUnique({ where: { id: dto.fromVariantId } }),
        tx.productVariant.findUnique({ where: { id: dto.toVariantId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!fromVariant)
        throw new NotFoundException('Source product variant not found');
      if (!toVariant)
        throw new NotFoundException('Destination product variant not found');
      assertQuantityMatchesMode(
        fromVariant.quantityMode,
        dto.fromQuantity,
        `Bulk quantity for ${fromVariant.sku}`,
      );
      assertQuantityMatchesMode(
        toVariant.quantityMode,
        dto.toQuantity,
        `Resale quantity for ${toVariant.sku}`,
      );

      const { organizationId, orgUserId } = getTenantStore();
      const repackaging = await tx.repackaging.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          fromVariantId: dto.fromVariantId,
          fromQuantity: dto.fromQuantity,
          toVariantId: dto.toVariantId,
          toQuantity: dto.toQuantity,
          notes: dto.notes,
          createdById: orgUserId,
        },
      });

      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.branchId,
        variantId: dto.fromVariantId,
        type: InventoryTxnType.REPACK,
        quantityDelta: -dto.fromQuantity,
        referenceId: repackaging.id,
      });
      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.branchId,
        variantId: dto.toVariantId,
        type: InventoryTxnType.REPACK,
        quantityDelta: dto.toQuantity,
        referenceId: repackaging.id,
      });

      await this.auditLog.logInTx(tx, {
        action: 'repackaging.created',
        entityType: 'Repackaging',
        entityId: repackaging.id,
        after: {
          branchId: dto.branchId,
          fromVariantId: dto.fromVariantId,
          fromQuantity: dto.fromQuantity,
          toVariantId: dto.toVariantId,
          toQuantity: dto.toQuantity,
        },
      });

      return repackaging;
    });
  }

  findAll(filters: { branchId?: string }) {
    return this.tenantPrisma.run((tx) =>
      tx.repackaging.findMany({
        where: { branchId: filters.branchId },
        include: {
          fromVariant: { include: { product: true } },
          toVariant: { include: { product: true } },
          branch: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
