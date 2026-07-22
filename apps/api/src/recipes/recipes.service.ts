import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  TenantScopedPrismaService,
  TenantTx,
} from '../common/prisma/tenant-scoped-prisma.service';
import { SetRecipeDto } from './dto/set-recipe.dto';

@Injectable()
export class RecipesService {
  constructor(private readonly tenantPrisma: TenantScopedPrismaService) {}

  async get(variantId: string) {
    const variant = await this.tenantPrisma.run((tx) =>
      tx.productVariant.findUnique({ where: { id: variantId } }),
    );
    if (!variant) throw new NotFoundException('Product variant not found');

    return this.tenantPrisma.run((tx) =>
      tx.recipeIngredient.findMany({
        where: { variantId },
        include: {
          ingredientVariant: { include: { product: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * Full replace, not a patch - simplest correct semantics for a small
   * list a manager edits as a whole (same reasoning as
   * StockTakesService reconciling a whole count, not per-line PATCHes).
   * An empty `ingredients` array is a valid, meaningful call: it clears
   * the recipe, reverting the variant to a plain stocked item (see the
   * schema comment on RecipeIngredient for what that means for sales).
   */
  async set(variantId: string, dto: SetRecipeDto) {
    return this.tenantPrisma.run(async (tx) => {
      const variant = await tx.productVariant.findUnique({
        where: { id: variantId },
      });
      if (!variant) throw new NotFoundException('Product variant not found');

      if (dto.ingredients.some((i) => i.ingredientVariantId === variantId)) {
        throw new BadRequestException(
          'A product cannot be an ingredient of its own recipe',
        );
      }
      const ingredientIds = dto.ingredients.map((i) => i.ingredientVariantId);
      if (new Set(ingredientIds).size !== ingredientIds.length) {
        throw new BadRequestException(
          'The same ingredient was listed more than once',
        );
      }
      if (ingredientIds.length > 0) {
        const ingredientVariants = await tx.productVariant.findMany({
          where: { id: { in: ingredientIds } },
        });
        if (ingredientVariants.length !== ingredientIds.length) {
          throw new NotFoundException(
            'One or more ingredient product variants were not found',
          );
        }
      }

      await tx.recipeIngredient.deleteMany({ where: { variantId } });
      if (dto.ingredients.length > 0) {
        await tx.recipeIngredient.createMany({
          data: dto.ingredients.map((i) => ({
            variantId,
            ingredientVariantId: i.ingredientVariantId,
            quantity: i.quantity,
          })),
        });
      }

      return tx.recipeIngredient.findMany({
        where: { variantId },
        include: { ingredientVariant: { include: { product: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
  }

  /**
   * Used by SalesService from inside its own already-open transaction -
   * same "InTx" convention as InventoryTransactionsService.recordInTx, for
   * the same reason (a sale's recipe lookup must see the same transaction
   * snapshot as everything else the sale does, and must not open a nested
   * transaction). Variants with no recipe rows simply don't appear in the
   * returned map - callers treat "no entry" as "plain stocked item".
   */
  async loadRecipesInTx(tx: TenantTx, variantIds: string[]) {
    const rows = await tx.recipeIngredient.findMany({
      where: { variantId: { in: variantIds } },
      include: { ingredientVariant: true },
    });
    const byVariant = new Map<string, typeof rows>();
    for (const row of rows) {
      const list = byVariant.get(row.variantId) ?? [];
      list.push(row);
      byVariant.set(row.variantId, list);
    }
    return byVariant;
  }
}
