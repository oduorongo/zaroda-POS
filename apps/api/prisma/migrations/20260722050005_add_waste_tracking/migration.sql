-- CreateEnum
CREATE TYPE "WasteReason" AS ENUM ('EXPIRED', 'DAMAGED', 'SPOILED', 'OVERPRODUCTION', 'OTHER');

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'WASTE';

-- CreateTable
CREATE TABLE "waste_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" "WasteReason" NOT NULL,
    "notes" TEXT,
    "batchId" TEXT,
    "unitCost" DECIMAL(12,2),
    "totalCost" DECIMAL(12,2),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waste_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waste_ingredients" (
    "id" TEXT NOT NULL,
    "wasteLogId" TEXT NOT NULL,
    "ingredientVariantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "waste_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "waste_logs_organizationId_idx" ON "waste_logs"("organizationId");

-- CreateIndex
CREATE INDEX "waste_logs_branchId_idx" ON "waste_logs"("branchId");

-- CreateIndex
CREATE INDEX "waste_logs_variantId_idx" ON "waste_logs"("variantId");

-- CreateIndex
CREATE INDEX "waste_ingredients_wasteLogId_idx" ON "waste_ingredients"("wasteLogId");

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_logs" ADD CONSTRAINT "waste_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "org_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_ingredients" ADD CONSTRAINT "waste_ingredients_wasteLogId_fkey" FOREIGN KEY ("wasteLogId") REFERENCES "waste_logs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waste_ingredients" ADD CONSTRAINT "waste_ingredients_ingredientVariantId_fkey" FOREIGN KEY ("ingredientVariantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
