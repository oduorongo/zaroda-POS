-- eTIMS items: how each product option is known to KRA (classification, units, unique item code, registration status) and the
-- running counter that makes item codes. Additive only.

-- CreateEnum
CREATE TYPE "EtimsItemStatus" AS ENUM ('NOT_SENT', 'REGISTERED', 'REJECTED');

-- AlterTable
ALTER TABLE "etims_settings" ADD COLUMN     "itemSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "etims_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "itemCd" TEXT,
    "itemClsCd" TEXT,
    "itemTyCd" TEXT NOT NULL DEFAULT '2',
    "pkgUnitCd" TEXT NOT NULL DEFAULT 'NT',
    "qtyUnitCd" TEXT NOT NULL DEFAULT 'U',
    "taxTyCd" TEXT,
    "status" "EtimsItemStatus" NOT NULL DEFAULT 'NOT_SENT',
    "sentHash" TEXT,
    "lastError" TEXT,
    "registeredAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "etims_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etims_items_variantId_key" ON "etims_items"("variantId");

-- CreateIndex
CREATE INDEX "etims_items_organizationId_status_idx" ON "etims_items"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "etims_items_organizationId_itemCd_key" ON "etims_items"("organizationId", "itemCd");

-- AddForeignKey
ALTER TABLE "etims_items" ADD CONSTRAINT "etims_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "etims_items" ADD CONSTRAINT "etims_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

