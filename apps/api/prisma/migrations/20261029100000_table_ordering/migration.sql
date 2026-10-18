-- AlterEnum
ALTER TYPE "FulfilmentType" ADD VALUE 'DINE_IN';

-- DropForeignKey
ALTER TABLE "online_orders" DROP CONSTRAINT "online_orders_buyerId_fkey";

-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "guestTokenHash" TEXT,
ADD COLUMN     "tableId" TEXT,
ADD COLUMN     "tableLabel" TEXT,
ALTER COLUMN "buyerId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "restaurant_dishes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_dishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_dishes_variantId_key" ON "restaurant_dishes"("variantId");

-- CreateIndex
CREATE INDEX "restaurant_dishes_organizationId_idx" ON "restaurant_dishes"("organizationId");

-- AddForeignKey
ALTER TABLE "restaurant_dishes" ADD CONSTRAINT "restaurant_dishes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_dishes" ADD CONSTRAINT "restaurant_dishes_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_dishes" ADD CONSTRAINT "restaurant_dishes_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
