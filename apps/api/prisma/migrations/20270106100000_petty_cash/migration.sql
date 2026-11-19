-- Petty cash: a business's petty cash boxes and what moves in and out of them; ZARODA's own petty cash.

CREATE TYPE "PettyCashKind" AS ENUM ('PAYMENT', 'TOP_UP', 'COUNT');

CREATE TABLE "petty_cash_boxes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "name" TEXT NOT NULL,
    "floatAmount" DECIMAL(12,2) NOT NULL,
    "holderName" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "petty_cash_boxes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "petty_cash_boxes_organizationId_idx" ON "petty_cash_boxes"("organizationId");

CREATE TABLE "petty_cash_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "kind" "PettyCashKind" NOT NULL,
    "voucherNumber" TEXT,
    "occurredOn" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "receivedBy" TEXT,
    "topUpFrom" TEXT,
    "countedAmount" DECIMAL(12,2),
    "expectedAmount" DECIMAL(12,2),
    "expenseId" TEXT,
    "recordedByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "petty_cash_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "petty_cash_entries_expenseId_key" ON "petty_cash_entries"("expenseId");
CREATE UNIQUE INDEX "petty_cash_entries_organizationId_voucherNumber_key" ON "petty_cash_entries"("organizationId", "voucherNumber");
CREATE INDEX "petty_cash_entries_boxId_occurredOn_idx" ON "petty_cash_entries"("boxId", "occurredOn");
ALTER TABLE "petty_cash_entries" ADD CONSTRAINT "petty_cash_entries_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "petty_cash_boxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "platform_petty_cash_entries" (
    "id" TEXT NOT NULL,
    "kind" "PettyCashKind" NOT NULL,
    "voucherNumber" TEXT,
    "occurredOn" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "accountId" TEXT,
    "description" TEXT,
    "receivedBy" TEXT,
    "topUpFrom" TEXT,
    "countedAmount" DECIMAL(12,2),
    "expectedAmount" DECIMAL(12,2),
    "entryId" TEXT,
    "recordedById" TEXT,
    "recordedByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_petty_cash_entries_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "platform_petty_cash_entries_voucherNumber_key" ON "platform_petty_cash_entries"("voucherNumber");
CREATE INDEX "platform_petty_cash_entries_occurredOn_idx" ON "platform_petty_cash_entries"("occurredOn");

ALTER TABLE "platform_ledger_settings" ADD COLUMN IF NOT EXISTS "pettyCashFloat" DECIMAL(12,2) NOT NULL DEFAULT 0;
