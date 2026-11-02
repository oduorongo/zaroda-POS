-- Construction C4: project site branch, requisitions, LPOs (on purchase orders), material issues and budgets, plant and plant logs; SITE_ISSUE stock movement. Additive only.

-- CreateEnum
CREATE TYPE "ConRequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConLpoStatus" AS ENUM ('AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ConIssueKind" AS ENUM ('USED', 'WASTED');

-- CreateEnum
CREATE TYPE "ConPlantOwnership" AS ENUM ('OWNED', 'HIRED');

-- CreateEnum
CREATE TYPE "ConRateUnit" AS ENUM ('HOUR', 'DAY');

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'SITE_ISSUE';

-- AlterTable
ALTER TABLE "con_projects" ADD COLUMN     "branchId" TEXT;

-- CreateTable
CREATE TABLE "con_requisitions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ConRequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "neededBy" DATE,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_requisition_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requisitionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "bqItemId" TEXT,
    "note" TEXT,

    CONSTRAINT "con_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_lpos" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "requisitionId" TEXT,
    "number" TEXT NOT NULL,
    "status" "ConLpoStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "total" DECIMAL(16,2) NOT NULL,
    "deliverBy" DATE,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_lpos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_material_issues" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "kind" "ConIssueKind" NOT NULL DEFAULT 'USED',
    "bqItemId" TEXT,
    "issuedTo" TEXT,
    "note" TEXT,
    "issuedAt" DATE NOT NULL,
    "issuedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_material_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_material_budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_material_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_plant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regNo" TEXT,
    "ownership" "ConPlantOwnership" NOT NULL,
    "hireRate" DECIMAL(12,2),
    "rateUnit" "ConRateUnit" NOT NULL DEFAULT 'DAY',
    "supplierId" TEXT,
    "projectId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_plant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_plant_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hours" DECIMAL(5,1) NOT NULL,
    "fuelLitres" DECIMAL(8,2),
    "fuelCost" DECIMAL(12,2),
    "operator" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_plant_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "con_requisitions_projectId_status_idx" ON "con_requisitions"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "con_requisitions_organizationId_number_key" ON "con_requisitions"("organizationId", "number");

-- CreateIndex
CREATE INDEX "con_requisition_lines_organizationId_idx" ON "con_requisition_lines"("organizationId");

-- CreateIndex
CREATE INDEX "con_requisition_lines_requisitionId_idx" ON "con_requisition_lines"("requisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "con_lpos_purchaseOrderId_key" ON "con_lpos"("purchaseOrderId");

-- CreateIndex
CREATE INDEX "con_lpos_projectId_idx" ON "con_lpos"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "con_lpos_organizationId_number_key" ON "con_lpos"("organizationId", "number");

-- CreateIndex
CREATE INDEX "con_material_issues_organizationId_idx" ON "con_material_issues"("organizationId");

-- CreateIndex
CREATE INDEX "con_material_issues_projectId_variantId_idx" ON "con_material_issues"("projectId", "variantId");

-- CreateIndex
CREATE INDEX "con_material_budgets_organizationId_idx" ON "con_material_budgets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_material_budgets_projectId_variantId_key" ON "con_material_budgets"("projectId", "variantId");

-- CreateIndex
CREATE INDEX "con_plant_organizationId_idx" ON "con_plant"("organizationId");

-- CreateIndex
CREATE INDEX "con_plant_logs_organizationId_idx" ON "con_plant_logs"("organizationId");

-- CreateIndex
CREATE INDEX "con_plant_logs_projectId_date_idx" ON "con_plant_logs"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "con_plant_logs_plantId_date_key" ON "con_plant_logs"("plantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "con_projects_branchId_key" ON "con_projects"("branchId");

-- AddForeignKey
ALTER TABLE "con_projects" ADD CONSTRAINT "con_projects_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisitions" ADD CONSTRAINT "con_requisitions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisitions" ADD CONSTRAINT "con_requisitions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisition_lines" ADD CONSTRAINT "con_requisition_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisition_lines" ADD CONSTRAINT "con_requisition_lines_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "con_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisition_lines" ADD CONSTRAINT "con_requisition_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_requisition_lines" ADD CONSTRAINT "con_requisition_lines_bqItemId_fkey" FOREIGN KEY ("bqItemId") REFERENCES "con_bq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_lpos" ADD CONSTRAINT "con_lpos_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_lpos" ADD CONSTRAINT "con_lpos_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_lpos" ADD CONSTRAINT "con_lpos_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_lpos" ADD CONSTRAINT "con_lpos_requisitionId_fkey" FOREIGN KEY ("requisitionId") REFERENCES "con_requisitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_issues" ADD CONSTRAINT "con_material_issues_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_issues" ADD CONSTRAINT "con_material_issues_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_issues" ADD CONSTRAINT "con_material_issues_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_issues" ADD CONSTRAINT "con_material_issues_bqItemId_fkey" FOREIGN KEY ("bqItemId") REFERENCES "con_bq_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_budgets" ADD CONSTRAINT "con_material_budgets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_budgets" ADD CONSTRAINT "con_material_budgets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_material_budgets" ADD CONSTRAINT "con_material_budgets_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant" ADD CONSTRAINT "con_plant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant" ADD CONSTRAINT "con_plant_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant" ADD CONSTRAINT "con_plant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant_logs" ADD CONSTRAINT "con_plant_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant_logs" ADD CONSTRAINT "con_plant_logs_plantId_fkey" FOREIGN KEY ("plantId") REFERENCES "con_plant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_plant_logs" ADD CONSTRAINT "con_plant_logs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

