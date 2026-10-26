-- School supplier: retention - a share of an invoice the school holds back until released (set per school or contract), with its release date, follow-up and history. Additive only.
-- CreateEnum
CREATE TYPE "RetentionEventKind" AS ENUM ('HELD', 'RELEASE_REQUESTED', 'RELEASED', 'UPDATED');

-- AlterTable
ALTER TABLE "school_contracts" ADD COLUMN     "retentionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionReleaseDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "supplier_invoices" ADD COLUMN     "retentionAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionDisputeNote" TEXT,
ADD COLUMN     "retentionDisputed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionHeld" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionNote" TEXT,
ADD COLUMN     "retentionReleaseDate" DATE,
ADD COLUMN     "retentionRequestedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "supplier_schools" ADD COLUMN     "retentionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "retentionReleaseDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "supplier_retention_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "kind" "RetentionEventKind" NOT NULL,
    "amount" DECIMAL(12,2),
    "note" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "supplier_retention_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_retention_events_invoiceId_idx" ON "supplier_retention_events"("invoiceId");

-- CreateIndex
CREATE INDEX "supplier_retention_events_organizationId_idx" ON "supplier_retention_events"("organizationId");

-- AddForeignKey
ALTER TABLE "supplier_retention_events" ADD CONSTRAINT "supplier_retention_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_retention_events" ADD CONSTRAINT "supplier_retention_events_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
