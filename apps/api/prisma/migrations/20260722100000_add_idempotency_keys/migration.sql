-- AlterTable
ALTER TABLE "refunds" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "salon_appointments" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "stock_transfers" ADD COLUMN     "clientId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "refunds_clientId_key" ON "refunds"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "salon_appointments_clientId_key" ON "salon_appointments"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "stock_transfers_clientId_key" ON "stock_transfers"("clientId");

