import { TenantTx } from '../common/prisma/tenant-scoped-prisma.service';

/** What making ONE of a dish uses: each ingredient and how much of it. A variant with no entry is an ordinary stocked item. */
export type RecipeMap = Map<string, { ingredientVariantId: string; quantity: number }[]>;

export async function loadRecipeMap(tx: TenantTx, variantIds: string[]): Promise<RecipeMap> {
  const ids = [...new Set(variantIds)];
  const recipes: RecipeMap = new Map();
  if (ids.length === 0) return recipes;
  const rows = await tx.recipeIngredient.findMany({
    where: { variantId: { in: ids } },
    select: { variantId: true, ingredientVariantId: true, quantity: true },
  });
  for (const row of rows) {
    const list = recipes.get(row.variantId) ?? [];
    list.push({ ingredientVariantId: row.ingredientVariantId, quantity: Number(row.quantity) });
    recipes.set(row.variantId, list);
  }
  return recipes;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * The stock a set of order lines really uses, in the things actually kept in stock: a dish made from a recipe is
 * replaced by its ingredients (quantity x recipe amount), anything else counts as itself. This is what gets held
 * while an order waits, deducted when it is accepted, and put back if it is cancelled.
 */
export function stockNeeds(lines: { variantId: string; quantity: number }[], recipes: RecipeMap): Map<string, number> {
  const needs = new Map<string, number>();
  const add = (id: string, quantity: number) => needs.set(id, round6((needs.get(id) ?? 0) + quantity));
  for (const line of lines) {
    const recipe = recipes.get(line.variantId);
    if (recipe && recipe.length > 0) for (const ingredient of recipe) add(ingredient.ingredientVariantId, ingredient.quantity * line.quantity);
    else add(line.variantId, line.quantity);
  }
  return needs;
}

/**
 * How many of each variant can still be sold right now. An ordinary item: what is on the shelf minus what open orders
 * already hold. A made dish: how many portions the scarcest ingredient still allows - so a dish disappears from the
 * menu the moment any one of its ingredients runs out, and shows "only 3 left" when that ingredient is nearly gone.
 */
export function availablePortions(
  variantIds: string[],
  recipes: RecipeMap,
  onHand: Map<string, number>,
  held: Map<string, number>,
): Map<string, number> {
  const free = (id: string) => Math.max(0, (onHand.get(id) ?? 0) - (held.get(id) ?? 0));
  const result = new Map<string, number>();
  for (const id of variantIds) {
    const recipe = recipes.get(id);
    if (recipe && recipe.length > 0) {
      let portions = Infinity;
      for (const ingredient of recipe) {
        if (ingredient.quantity <= 0) continue;
        portions = Math.min(portions, Math.floor(free(ingredient.ingredientVariantId) / ingredient.quantity + 1e-9));
      }
      result.set(id, Number.isFinite(portions) ? Math.max(0, portions) : 0);
    } else {
      result.set(id, free(id));
    }
  }
  return result;
}
