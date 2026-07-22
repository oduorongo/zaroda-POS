import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InventoryTxnType, ProductionOrderStatus } from '@prisma/client';
import { TenantScopedPrismaService } from '../common/prisma/tenant-scoped-prisma.service';
import { AuditLogService } from '../common/audit/audit-log.service';
import { getTenantStore } from '../common/tenant/tenant-context';
import { assertQuantityMatchesMode } from '../common/inventory/quantity-mode.util';
import { InventoryTransactionsService } from '../inventory/inventory-transactions.service';
import { RecipesService } from '../recipes/recipes.service';
import { CreateProductionOrderDto } from './dto/create-production-order.dto';
import { CompleteProductionOrderDto } from './dto/complete-production-order.dto';

const ORDER_INCLUDE = {
  variant: { include: { product: true } },
  branch: { select: { name: true } },
} as const;

@Injectable()
export class ProductionOrdersService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly recipes: RecipesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(dto: CreateProductionOrderDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, variant] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.productVariant.findUnique({ where: { id: dto.variantId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!variant) throw new NotFoundException('Product variant not found');
      assertQuantityMatchesMode(
        variant.quantityMode,
        dto.plannedQuantity,
        `Planned quantity for ${variant.sku}`,
      );

      const recipe = await tx.recipeIngredient.findMany({
        where: { variantId: dto.variantId },
      });
      if (recipe.length === 0) {
        throw new BadRequestException(
          `${variant.sku} has no recipe (bill of materials) set - add one via the recipe editor before raising a production order for it`,
        );
      }

      const { organizationId, orgUserId } = getTenantStore();
      const order = await tx.productionOrder.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          variantId: dto.variantId,
          plannedQuantity: dto.plannedQuantity,
          notes: dto.notes,
          createdById: orgUserId,
        },
        include: ORDER_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'productionOrder.created',
        entityType: 'ProductionOrder',
        entityId: order.id,
        after: {
          branchId: dto.branchId,
          variantId: dto.variantId,
          plannedQuantity: dto.plannedQuantity,
        },
      });

      return order;
    });
  }

  findAll(filters: { branchId?: string; status?: ProductionOrderStatus }) {
    return this.tenantPrisma.run((tx) =>
      tx.productionOrder.findMany({
        where: { branchId: filters.branchId, status: filters.status },
        include: ORDER_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async findOne(id: string) {
    const order = await this.tenantPrisma.run((tx) =>
      tx.productionOrder.findUnique({ where: { id }, include: ORDER_INCLUDE }),
    );
    if (!order) throw new NotFoundException('Production order not found');
    return order;
  }

  async start(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.productionOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Production order not found');
      if (order.status !== ProductionOrderStatus.DRAFT) {
        throw new BadRequestException(
          `Cannot start a production order that is ${order.status.toLowerCase()}`,
        );
      }

      return tx.productionOrder.update({
        where: { id },
        data: {
          status: ProductionOrderStatus.IN_PROGRESS,
          startedAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });
    });
  }

  /**
   * The one place raw materials actually move: read the finished good's
   * BOM (RecipeIngredient - the same rows the recipe editor manages and
   * SalesService reads for recipe-tracked sales), scale each ingredient's
   * quantity by actualQuantity (not plannedQuantity - the real yield is
   * what was actually charged against stock), then decrement every
   * ingredient and increment the finished good, all tagged PRODUCTION and
   * referencing this order's id in one transaction - same atomic two-leg
   * shape as RepackagingService.create(), generalized to N ingredients.
   */
  async complete(id: string, dto: CompleteProductionOrderDto) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.productionOrder.findUnique({
        where: { id },
        include: { variant: true },
      });
      if (!order) throw new NotFoundException('Production order not found');
      if (
        order.status !== ProductionOrderStatus.DRAFT &&
        order.status !== ProductionOrderStatus.IN_PROGRESS
      ) {
        throw new BadRequestException(
          `Cannot complete a production order that is ${order.status.toLowerCase()}`,
        );
      }
      assertQuantityMatchesMode(
        order.variant.quantityMode,
        dto.actualQuantity,
        `Actual quantity for ${order.variant.sku}`,
      );

      const recipe = await tx.recipeIngredient.findMany({
        where: { variantId: order.variantId },
        include: { ingredientVariant: true },
      });
      if (recipe.length === 0) {
        throw new BadRequestException(
          `${order.variant.sku} no longer has a recipe (bill of materials) set - it may have been cleared after this order was created`,
        );
      }

      for (const ingredient of recipe) {
        const consumed = Number(ingredient.quantity) * dto.actualQuantity;
        assertQuantityMatchesMode(
          ingredient.ingredientVariant.quantityMode,
          consumed,
          `Quantity for ${ingredient.ingredientVariant.sku} (ingredient of ${order.variant.sku})`,
        );
        await this.inventoryTransactions.recordInTx(tx, {
          branchId: order.branchId,
          variantId: ingredient.ingredientVariantId,
          type: InventoryTxnType.PRODUCTION,
          quantityDelta: -consumed,
          referenceId: order.id,
        });
      }

      await this.inventoryTransactions.recordInTx(tx, {
        branchId: order.branchId,
        variantId: order.variantId,
        type: InventoryTxnType.PRODUCTION,
        quantityDelta: dto.actualQuantity,
        referenceId: order.id,
      });

      const updated = await tx.productionOrder.update({
        where: { id },
        data: {
          status: ProductionOrderStatus.COMPLETED,
          actualQuantity: dto.actualQuantity,
          completedAt: new Date(),
        },
        include: ORDER_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'productionOrder.completed',
        entityType: 'ProductionOrder',
        entityId: id,
        after: { actualQuantity: dto.actualQuantity },
      });

      return updated;
    });
  }

  async cancel(id: string) {
    return this.tenantPrisma.run(async (tx) => {
      const order = await tx.productionOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Production order not found');
      if (
        order.status === ProductionOrderStatus.COMPLETED ||
        order.status === ProductionOrderStatus.CANCELLED
      ) {
        throw new BadRequestException(
          `Cannot cancel a production order that is already ${order.status.toLowerCase()}`,
        );
      }

      const updated = await tx.productionOrder.update({
        where: { id },
        data: { status: ProductionOrderStatus.CANCELLED },
        include: ORDER_INCLUDE,
      });

      await this.auditLog.logInTx(tx, {
        action: 'productionOrder.cancelled',
        entityType: 'ProductionOrder',
        entityId: id,
      });

      return updated;
    });
  }
}
