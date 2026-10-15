-- CreateEnum
CREATE TYPE "RentalPlatformInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'WAIVED');

-- CreateTable
CREATE TABLE "rental_platform_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "invoiceMonth" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL,
    "billingCycle" TEXT NOT NULL,
    "occupiedUnits" INTEGER NOT NULL,
    "matchedRentTotal" DECIMAL(12,2),
    "amountDue" INTEGER NOT NULL,
    "status" "RentalPlatformInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "recordedByPlatformAdminId" TEXT,
    "waivedReason" TEXT,
    "reminderStage" INTEGER NOT NULL DEFAULT 0,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_platform_invoices_invoiceNumber_key" ON "rental_platform_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "rental_platform_invoices_organizationId_status_idx" ON "rental_platform_invoices"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rental_platform_invoices_organizationId_kind_invoiceMonth_key" ON "rental_platform_invoices"("organizationId", "kind", "invoiceMonth");

-- AddForeignKey
ALTER TABLE "rental_platform_invoices" ADD CONSTRAINT "rental_platform_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
