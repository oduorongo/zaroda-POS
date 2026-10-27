-- Accounting: chart of accounts, journal entries and lines, ledger settings, and what each source was posted as. Additive only.

-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('AUTO', 'MANUAL', 'OPENING', 'REVERSAL');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "systemKey" TEXT,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_settings" (
    "organizationId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "lockDate" DATE,
    "payrollPaidFrom" TEXT NOT NULL DEFAULT 'BANK',
    "lastPassAt" TIMESTAMP(3),
    "lastPassNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "entryDate" DATE NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "memo" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "branchId" TEXT,
    "reversesId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_postings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "entryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_postings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organizationId_code_key" ON "ledger_accounts"("organizationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_organizationId_systemKey_key" ON "ledger_accounts"("organizationId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversesId_key" ON "journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_entryDate_idx" ON "journal_entries"("organizationId", "entryDate");

-- CreateIndex
CREATE INDEX "journal_entries_organizationId_sourceType_sourceId_idx" ON "journal_entries"("organizationId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_organizationId_number_key" ON "journal_entries"("organizationId", "number");

-- CreateIndex
CREATE INDEX "journal_lines_organizationId_accountId_idx" ON "journal_lines"("organizationId", "accountId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_postings_organizationId_sourceType_sourceId_key" ON "ledger_postings"("organizationId", "sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_postings" ADD CONSTRAINT "ledger_postings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
