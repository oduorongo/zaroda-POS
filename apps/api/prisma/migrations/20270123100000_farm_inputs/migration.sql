-- Zaroda Shamba: farm inputs (seed, fertiliser, sprays, vet drugs, bought feed) kept apart from what the farm produces.

-- CreateEnum
CREATE TYPE "FarmInputKind" AS ENUM ('SEED', 'FERTILISER', 'CHEMICAL', 'VET_DRUG', 'FEED', 'OTHER');

-- CreateTable
CREATE TABLE "farm_inputs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "FarmInputKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_inputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_inputs_organizationId_productId_key" ON "farm_inputs"("organizationId", "productId");

-- Farms that already exist: the products their seed, fertiliser, sprays, drugs and bought feed were recorded under become inputs.
INSERT INTO "farm_inputs" ("id", "organizationId", "productId", "kind")
SELECT gen_random_uuid()::text, p."organizationId", p.id, k.kind::"FarmInputKind"
FROM (
  SELECT DISTINCT v."productId" AS pid, 'CHEMICAL' AS kind FROM farm_crop_activities a JOIN product_variants v ON v.id = a."inputVariantId" WHERE a.kind::text = 'SPRAYING'
  UNION SELECT DISTINCT v."productId", CASE WHEN a.kind::text = 'TOP_DRESSING' OR p2.name ~* '(fertili|DAP|CAN|NPK|urea|manure)' THEN 'FERTILISER' WHEN a.kind::text = 'PLANTING' THEN 'SEED' ELSE 'OTHER' END
    FROM farm_crop_activities a JOIN product_variants v ON v.id = a."inputVariantId" JOIN products p2 ON p2.id = v."productId" WHERE a.kind::text <> 'SPRAYING'
  UNION SELECT DISTINCT v."productId", 'VET_DRUG' FROM farm_drugs d JOIN product_variants v ON v.id = d."variantId"
  UNION SELECT DISTINCT v."productId", 'FEED' FROM farm_ration_items i JOIN product_variants v ON v.id = i."variantId"
    WHERE NOT EXISTS (SELECT 1 FROM farm_feed_batches b WHERE b."outputVariantId" = i."variantId")
      AND NOT EXISTS (SELECT 1 FROM farm_rations r WHERE r."outputVariantId" = i."variantId")
) k
JOIN products p ON p.id = k.pid
ON CONFLICT ("organizationId", "productId") DO NOTHING;
