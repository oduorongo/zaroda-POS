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
import { RecipesService } from '../recipes/recipes.service';
import { CreateWasteDto } from './dto/create-waste.dto';
import { ListWasteDto } from './dto/list-waste.dto';

const WASTE_INCLUDE = {
  variant: { include: { product: true } },
  batch: true,
  branch: { select: { name: true } },
  createdBy: { select: { id: true, user: { select: { fullName: true } } } },
  ingredients: { include: { ingredientVariant: { include: { product: true } } } },
} as const;

@Injectable()
export class WasteService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly inventoryTransactions: InventoryTransactionsService,
    private readonly recipes: RecipesService,
    private readonly auditLog: AuditLogService,
  ) {}

  /**
   * A recipe-tracked variant (see RecipeIngredient) has no stock of its
   * own to write off - "5 unsold Biryanis went stale" has to mean "the
   * rice/chicken/oil that went into them are the actual loss", the same
   * ingredient-decrement path a sale of that dish would have used (see
   * SalesService), just typed WASTE instead of SALE and with no revenue.
   * A plain stocked item (a drink, a bag of rice itself) keeps the direct
   * "decrement this variant's own stock" path, optionally against a
   * specific batch.
   */
  async create(dto: CreateWasteDto) {
    return this.tenantPrisma.run(async (tx) => {
      const [branch, variant] = await Promise.all([
        tx.branch.findUnique({ where: { id: dto.branchId } }),
        tx.productVariant.findUnique({ where: { id: dto.variantId } }),
      ]);
      if (!branch) throw new NotFoundException('Branch not found');
      if (!variant) throw new NotFoundException('Product variant not found');

      const recipe = (
        await this.recipes.loadRecipesInTx(tx, [dto.variantId])
      ).get(dto.variantId);

      const { organizationId, orgUserId } = getTenantStore();

      if (recipe) {
        if (dto.batchId) {
          throw new BadRequestException(
            'A specific batch cannot be selected for a recipe-tracked item - it has no batches of its own, only its ingredients do',
          );
        }
        for (const ingredient of recipe) {
          assertQuantityMatchesMode(
            ingredient.ingredientVariant.quantityMode,
            Number(ingredient.quantity) * dto.quantity,
            `Quantity for ${ingredient.ingredientVariant.sku} (ingredient of ${variant.sku})`,
          );
        }

        const costKnown = recipe.every(
          (i) => i.ingredientVariant.cost !== null,
        );
        const totalCost = costKnown
          ? recipe.reduce(
              (sum, i) =>
                sum +
                Number(i.quantity) *
                  dto.quantity *
                  Number(i.ingredientVariant.cost),
              0,
            )
          : null;
        const unitCost = totalCost === null ? null : totalCost / dto.quantity;

        const wasteLog = await tx.wasteLog.create({
          data: {
            organizationId,
            branchId: dto.branchId,
            variantId: dto.variantId,
            quantity: dto.quantity,
            reason: dto.reason,
            notes: dto.notes,
            unitCost,
            totalCost,
            createdById: orgUserId,
          },
        });

        for (const ingredient of recipe) {
          const consumed = Number(ingredient.quantity) * dto.quantity;
          await this.inventoryTransactions.recordInTx(tx, {
            branchId: dto.branchId,
            variantId: ingredient.ingredientVariantId,
            type: InventoryTxnType.WASTE,
            quantityDelta: -consumed,
            referenceId: wasteLog.id,
          });
          await tx.wasteIngredient.create({
            data: {
              wasteLogId: wasteLog.id,
              ingredientVariantId: ingredient.ingredientVariantId,
              quantity: consumed,
            },
          });
        }

        await this.auditLog.logInTx(tx, {
          action: 'waste.recorded',
          entityType: 'WasteLog',
          entityId: wasteLog.id,
          after: {
            branchId: dto.branchId,
            variantId: dto.variantId,
            quantity: dto.quantity,
            reason: dto.reason,
            totalCost,
          },
        });

        return tx.wasteLog.findUnique({
          where: { id: wasteLog.id },
          include: WASTE_INCLUDE,
        });
      }

      assertQuantityMatchesMode(
        variant.quantityMode,
        dto.quantity,
        `Quantity for ${variant.sku}`,
      );

      const unitCost = variant.cost === null ? null : Number(variant.cost);
      const totalCost = unitCost === null ? null : unitCost * dto.quantity;

      const wasteLog = await tx.wasteLog.create({
        data: {
          organizationId,
          branchId: dto.branchId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          reason: dto.reason,
          notes: dto.notes,
          batchId: dto.batchId,
          unitCost,
          totalCost,
          createdById: orgUserId,
        },
      });

      await this.inventoryTransactions.recordInTx(tx, {
        branchId: dto.branchId,
        variantId: dto.variantId,
        type: InventoryTxnType.WASTE,
        quantityDelta: -dto.quantity,
        referenceId: wasteLog.id,
        batchId: dto.batchId,
      });

      await this.auditLog.logInTx(tx, {
        action: 'waste.recorded',
        entityType: 'WasteLog',
        entityId: wasteLog.id,
        after: {
          branchId: dto.branchId,
          variantId: dto.variantId,
          quantity: dto.quantity,
          reason: dto.reason,
          totalCost,
        },
      });

      return tx.wasteLog.findUnique({
        where: { id: wasteLog.id },
        include: WASTE_INCLUDE,
      });
    });
  }

  findAll(filters: ListWasteDto) {
    return this.tenantPrisma.run((tx) =>
      tx.wasteLog.findMany({
        where: {
          branchId: filters.branchId,
          variantId: filters.variantId,
          reason: filters.reason,
        },
        include: WASTE_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }
}
