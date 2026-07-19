-- CreateEnum
CREATE TYPE "LowStockAlertStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateTable
CREATE TABLE "low_stock_alerts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "threshold" INTEGER NOT NULL,
    "status" "LowStockAlertStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "low_stock_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "low_stock_alerts_organizationId_idx" ON "low_stock_alerts"("organizationId");

-- CreateIndex
CREATE INDEX "low_stock_alerts_branchId_variantId_status_idx" ON "low_stock_alerts"("branchId", "variantId", "status");

-- AddForeignKey
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "low_stock_alerts" ADD CONSTRAINT "low_stock_alerts_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
