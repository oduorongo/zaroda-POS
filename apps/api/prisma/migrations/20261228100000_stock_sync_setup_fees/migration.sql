-- AlterTable
ALTER TABLE "online_stores" ADD COLUMN     "onlineStockBuffer" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "stock_sync_keys" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "requests" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_sync_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_setup_fee_rates" (
    "id" TEXT NOT NULL,
    "industryType" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "minKes" DECIMAL(12,2) NOT NULL,
    "maxKes" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_setup_fee_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_setup_fees" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "industryType" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "receiptNo" TEXT NOT NULL,
    "note" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_setup_fees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "stock_sync_keys_prefix_key" ON "stock_sync_keys"("prefix");

-- CreateIndex
CREATE INDEX "stock_sync_keys_organizationId_idx" ON "stock_sync_keys"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_setup_fee_rates_industryType_size_key" ON "sales_setup_fee_rates"("industryType", "size");

-- CreateIndex
CREATE UNIQUE INDEX "sales_setup_fees_receiptNo_key" ON "sales_setup_fees"("receiptNo");

-- CreateIndex
CREATE INDEX "sales_setup_fees_organizationId_idx" ON "sales_setup_fees"("organizationId");

-- CreateIndex
CREATE INDEX "sales_setup_fees_agentId_receivedAt_idx" ON "sales_setup_fees"("agentId", "receivedAt");

-- AddForeignKey
ALTER TABLE "stock_sync_keys" ADD CONSTRAINT "stock_sync_keys_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_setup_fees" ADD CONSTRAINT "sales_setup_fees_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_setup_fees" ADD CONSTRAINT "sales_setup_fees_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "sales_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Starting setup fee ranges for every business type (edit them on the platform admin's Setup fees page).
INSERT INTO "sales_setup_fee_rates" ("id", "industryType", "size", "minKes", "maxKes", "updatedAt") VALUES
  (gen_random_uuid(), 'ANY', 'SMALL', 1000, 3000, now()),
  (gen_random_uuid(), 'ANY', 'MEDIUM', 3000, 10000, now()),
  (gen_random_uuid(), 'ANY', 'LARGE', 10000, 30000, now())
ON CONFLICT ("industryType", "size") DO NOTHING;
