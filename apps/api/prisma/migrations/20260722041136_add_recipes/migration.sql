-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "ingredientVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_line_item_ingredients" (
    "id" TEXT NOT NULL,
    "saleLineItemId" TEXT NOT NULL,
    "ingredientVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "sale_line_item_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recipe_ingredients_variantId_idx" ON "recipe_ingredients"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_ingredients_variantId_ingredientVariantId_key" ON "recipe_ingredients"("variantId", "ingredientVariantId");

-- CreateIndex
CREATE INDEX "sale_line_item_ingredients_saleLineItemId_idx" ON "sale_line_item_ingredients"("saleLineItemId");

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_item_ingredients" ADD CONSTRAINT "sale_line_item_ingredients_saleLineItemId_fkey" FOREIGN KEY ("saleLineItemId") REFERENCES "sale_line_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_line_item_ingredients" ADD CONSTRAINT "sale_line_item_ingredients_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
