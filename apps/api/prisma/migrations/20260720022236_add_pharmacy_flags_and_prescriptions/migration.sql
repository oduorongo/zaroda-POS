-- CreateTable
CREATE TABLE "pharmacy_product_flags" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "isControlledSubstance" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pharmacy_product_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pharmacy_sale_prescriptions" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "prescriptionNumber" TEXT NOT NULL,
    "prescriberName" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pharmacy_sale_prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_product_flags_productId_key" ON "pharmacy_product_flags"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "pharmacy_sale_prescriptions_saleId_key" ON "pharmacy_sale_prescriptions"("saleId");

-- AddForeignKey
ALTER TABLE "pharmacy_product_flags" ADD CONSTRAINT "pharmacy_product_flags_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pharmacy_sale_prescriptions" ADD CONSTRAINT "pharmacy_sale_prescriptions_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
