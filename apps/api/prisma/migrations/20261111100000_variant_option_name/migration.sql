-- A readable name for a product option (a size or pack), e.g. "Large loaf 800g", instead of only a product code.
ALTER TABLE "product_variants" ADD COLUMN "name" TEXT;
