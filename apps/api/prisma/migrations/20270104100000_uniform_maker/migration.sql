-- Uniform makers: tailors, tailoring jobs, hand-ins and payments; "made ahead" items and the tailor's rate per piece.

ALTER TYPE "InventoryTxnType" ADD VALUE IF NOT EXISTS 'TAILORING';

ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "madeAhead" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "product_variants" ADD COLUMN IF NOT EXISTS "tailorRate" DECIMAL(12,2);

CREATE TYPE "TailorJobStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE "TailorPaymentMethod" AS ENUM ('CASH', 'MPESA', 'BANK');

CREATE TABLE "tailors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "idNumber" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tailors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tailors_organizationId_idx" ON "tailors"("organizationId");

CREATE TABLE "tailor_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "ratePerPiece" DECIMAL(12,2) NOT NULL,
    "materialsCost" DECIMAL(12,2) NOT NULL,
    "quantityGood" INTEGER NOT NULL DEFAULT 0,
    "quantityRejected" INTEGER NOT NULL DEFAULT 0,
    "status" "TailorJobStatus" NOT NULL DEFAULT 'OPEN',
    "dueDate" DATE,
    "notes" TEXT,
    "createdByName" TEXT,
    "closedAt" TIMESTAMP(3),
    "closeNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tailor_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "tailor_jobs_organizationId_jobNumber_key" ON "tailor_jobs"("organizationId", "jobNumber");
CREATE INDEX "tailor_jobs_organizationId_idx" ON "tailor_jobs"("organizationId");
CREATE INDEX "tailor_jobs_tailorId_idx" ON "tailor_jobs"("tailorId");
ALTER TABLE "tailor_jobs" ADD CONSTRAINT "tailor_jobs_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tailor_jobs" ADD CONSTRAINT "tailor_jobs_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tailor_job_materials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(12,2),
    CONSTRAINT "tailor_job_materials_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tailor_job_materials_jobId_idx" ON "tailor_job_materials"("jobId");
ALTER TABLE "tailor_job_materials" ADD CONSTRAINT "tailor_job_materials_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "tailor_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tailor_job_materials" ADD CONSTRAINT "tailor_job_materials_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "tailor_hand_ins" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "goodQty" INTEGER NOT NULL,
    "rejectedQty" INTEGER NOT NULL DEFAULT 0,
    "labourAmount" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "notes" TEXT,
    "receivedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tailor_hand_ins_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tailor_hand_ins_organizationId_createdAt_idx" ON "tailor_hand_ins"("organizationId", "createdAt");
CREATE INDEX "tailor_hand_ins_jobId_idx" ON "tailor_hand_ins"("jobId");
ALTER TABLE "tailor_hand_ins" ADD CONSTRAINT "tailor_hand_ins_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "tailor_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "tailor_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tailorId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "TailorPaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidOn" DATE NOT NULL,
    "notes" TEXT,
    "recordedByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tailor_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tailor_payments_organizationId_paidOn_idx" ON "tailor_payments"("organizationId", "paidOn");
CREATE INDEX "tailor_payments_tailorId_idx" ON "tailor_payments"("tailorId");
ALTER TABLE "tailor_payments" ADD CONSTRAINT "tailor_payments_tailorId_fkey" FOREIGN KEY ("tailorId") REFERENCES "tailors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Production orders already treat their item's recipe as a bill of materials: those items are made ahead and stocked.
UPDATE "product_variants" SET "madeAhead" = true WHERE "id" IN (SELECT DISTINCT "variantId" FROM "production_orders");
