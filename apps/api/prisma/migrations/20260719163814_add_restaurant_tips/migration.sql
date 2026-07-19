-- CreateTable
CREATE TABLE "restaurant_sale_tips" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "tipAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "serviceChargeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_sale_tips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_sale_tips_saleId_key" ON "restaurant_sale_tips"("saleId");

-- AddForeignKey
ALTER TABLE "restaurant_sale_tips" ADD CONSTRAINT "restaurant_sale_tips_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
