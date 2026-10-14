-- CreateEnum
CREATE TYPE "RentalExpenseCategory" AS ENUM ('REPAIRS', 'UTILITIES', 'RATES_AND_TAXES', 'INSURANCE', 'CARETAKER', 'MANAGEMENT_FEE', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalMaintenanceStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RentalMaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'URGENT');

-- CreateEnum
CREATE TYPE "RentalMeterKind" AS ENUM ('WATER', 'ELECTRICITY');

-- AlterTable
ALTER TABLE "rental_settings" ADD COLUMN     "paymentInstructions" TEXT,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsReminders" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "rental_maintenance_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priority" "RentalMaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RentalMaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "reportedAt" DATE NOT NULL,
    "resolvedAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_expenses" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "maintenanceId" TEXT,
    "category" "RentalExpenseCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "incurredAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_meter_readings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "leaseId" TEXT,
    "kind" "RentalMeterKind" NOT NULL,
    "readingDate" DATE NOT NULL,
    "reading" DECIMAL(12,2) NOT NULL,
    "previousReading" DECIMAL(12,2),
    "unitsUsed" DECIMAL(12,2),
    "ratePerUnit" DECIMAL(12,2),
    "chargeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_reminder_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_reminder_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_maintenance_requests_organizationId_status_idx" ON "rental_maintenance_requests"("organizationId", "status");

-- CreateIndex
CREATE INDEX "rental_maintenance_requests_propertyId_idx" ON "rental_maintenance_requests"("propertyId");

-- CreateIndex
CREATE INDEX "rental_expenses_organizationId_incurredAt_idx" ON "rental_expenses"("organizationId", "incurredAt");

-- CreateIndex
CREATE INDEX "rental_expenses_propertyId_incurredAt_idx" ON "rental_expenses"("propertyId", "incurredAt");

-- CreateIndex
CREATE INDEX "rental_meter_readings_organizationId_idx" ON "rental_meter_readings"("organizationId");

-- CreateIndex
CREATE INDEX "rental_meter_readings_unitId_kind_readingDate_idx" ON "rental_meter_readings"("unitId", "kind", "readingDate");

-- CreateIndex
CREATE UNIQUE INDEX "rental_meter_readings_unitId_kind_readingDate_key" ON "rental_meter_readings"("unitId", "kind", "readingDate");

-- CreateIndex
CREATE INDEX "rental_reminder_logs_organizationId_idx" ON "rental_reminder_logs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_reminder_logs_invoiceId_stage_channel_key" ON "rental_reminder_logs"("invoiceId", "stage", "channel");

-- AddForeignKey
ALTER TABLE "rental_maintenance_requests" ADD CONSTRAINT "rental_maintenance_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_maintenance_requests" ADD CONSTRAINT "rental_maintenance_requests_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_maintenance_requests" ADD CONSTRAINT "rental_maintenance_requests_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_maintenance_requests" ADD CONSTRAINT "rental_maintenance_requests_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "rental_tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_expenses" ADD CONSTRAINT "rental_expenses_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_expenses" ADD CONSTRAINT "rental_expenses_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_expenses" ADD CONSTRAINT "rental_expenses_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_expenses" ADD CONSTRAINT "rental_expenses_maintenanceId_fkey" FOREIGN KEY ("maintenanceId") REFERENCES "rental_maintenance_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_meter_readings" ADD CONSTRAINT "rental_meter_readings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_meter_readings" ADD CONSTRAINT "rental_meter_readings_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "rental_units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_meter_readings" ADD CONSTRAINT "rental_meter_readings_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "rental_leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_reminder_logs" ADD CONSTRAINT "rental_reminder_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

