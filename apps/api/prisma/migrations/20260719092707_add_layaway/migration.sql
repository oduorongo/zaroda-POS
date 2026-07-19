-- CreateEnum
CREATE TYPE "LayawayStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "layaways" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "LayawayStatus" NOT NULL DEFAULT 'OPEN',
    "total" DECIMAL(12,2) NOT NULL,
    "depositPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "layaways_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layaway_line_items" (
    "id" TEXT NOT NULL,
    "layawayId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "layaway_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "layaway_payments" (
    "id" TEXT NOT NULL,
    "layawayId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "layaway_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "layaways_organizationId_idx" ON "layaways"("organizationId");

-- CreateIndex
CREATE INDEX "layaways_branchId_idx" ON "layaways"("branchId");

-- CreateIndex
CREATE INDEX "layaway_line_items_layawayId_idx" ON "layaway_line_items"("layawayId");

-- CreateIndex
CREATE INDEX "layaway_payments_layawayId_idx" ON "layaway_payments"("layawayId");

-- AddForeignKey
ALTER TABLE "layaways" ADD CONSTRAINT "layaways_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaways" ADD CONSTRAINT "layaways_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaways" ADD CONSTRAINT "layaways_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_line_items" ADD CONSTRAINT "layaway_line_items_layawayId_fkey" FOREIGN KEY ("layawayId") REFERENCES "layaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_line_items" ADD CONSTRAINT "layaway_line_items_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "layaway_payments" ADD CONSTRAINT "layaway_payments_layawayId_fkey" FOREIGN KEY ("layawayId") REFERENCES "layaways"("id") ON DELETE CASCADE ON UPDATE CASCADE;
