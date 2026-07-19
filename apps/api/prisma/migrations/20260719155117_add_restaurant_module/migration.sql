-- CreateEnum
CREATE TYPE "RestaurantTableStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'NEEDS_CLEANING');

-- CreateTable
CREATE TABLE "restaurant_tables" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "seats" INTEGER NOT NULL,
    "status" "RestaurantTableStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_sale_tables" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,

    CONSTRAINT "restaurant_sale_tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_tables_organizationId_idx" ON "restaurant_tables"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_tables_branchId_label_key" ON "restaurant_tables"("branchId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_sale_tables_saleId_key" ON "restaurant_sale_tables"("saleId");

-- AddForeignKey
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_tables" ADD CONSTRAINT "restaurant_tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_sale_tables" ADD CONSTRAINT "restaurant_sale_tables_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_sale_tables" ADD CONSTRAINT "restaurant_sale_tables_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "restaurant_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
