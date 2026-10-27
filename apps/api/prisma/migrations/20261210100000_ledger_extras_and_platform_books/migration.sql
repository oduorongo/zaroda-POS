-- Accounting, part 2: how a tenant's deposit was handed back, and ZARODA's own books (platform-level tables, no row-level security, like plans). Additive only.

-- AlterTable
ALTER TABLE "rental_leases" ADD COLUMN     "depositRefundMethod" TEXT;

-- CreateTable
CREATE TABLE "platform_ledger_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "systemKey" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ledger_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "startDate" DATE NOT NULL,
    "lockDate" DATE,
    "lastPassAt" TIMESTAMP(3),
    "lastPassNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_ledger_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_journal_entries" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "entryDate" DATE NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "memo" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "organizationId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_journal_lines" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "platform_journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_ledger_postings" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_accounts_code_key" ON "platform_ledger_accounts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_accounts_systemKey_key" ON "platform_ledger_accounts"("systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "platform_journal_entries_number_key" ON "platform_journal_entries"("number");

-- CreateIndex
CREATE UNIQUE INDEX "platform_journal_entries_reversesId_key" ON "platform_journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "platform_journal_entries_entryDate_idx" ON "platform_journal_entries"("entryDate");

-- CreateIndex
CREATE INDEX "platform_journal_entries_sourceType_sourceId_idx" ON "platform_journal_entries"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "platform_journal_lines_accountId_idx" ON "platform_journal_lines"("accountId");

-- CreateIndex
CREATE INDEX "platform_journal_lines_entryId_idx" ON "platform_journal_lines"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_ledger_postings_sourceType_sourceId_key" ON "platform_ledger_postings"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "platform_journal_entries" ADD CONSTRAINT "platform_journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "platform_journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_journal_lines" ADD CONSTRAINT "platform_journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "platform_journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_journal_lines" ADD CONSTRAINT "platform_journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "platform_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
