-- CreateEnum
CREATE TYPE "CommissionInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'WAIVED');

-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "commissionInvoiceId" TEXT;

-- CreateTable
CREATE TABLE "commission_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "salesTotal" DECIMAL(12,2) NOT NULL,
    "commissionTotal" DECIMAL(12,2) NOT NULL,
    "status" "CommissionInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "recordedByPlatformAdminId" TEXT,
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_invoiceNumber_key" ON "commission_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "commission_invoices_organizationId_status_idx" ON "commission_invoices"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "commission_invoices_organizationId_periodMonth_key" ON "commission_invoices"("organizationId", "periodMonth");

-- CreateIndex
CREATE INDEX "online_orders_commissionInvoiceId_idx" ON "online_orders"("commissionInvoiceId");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_commissionInvoiceId_fkey" FOREIGN KEY ("commissionInvoiceId") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_invoices" ADD CONSTRAINT "commission_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

