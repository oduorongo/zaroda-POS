-- CreateEnum
CREATE TYPE "RentalInvoiceKind" AS ENUM ('RENT', 'DEPOSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "RentalPaymentMethod" AS ENUM ('CASH', 'BANK', 'MPESA', 'TUMA', 'DARAJA', 'OTHER');

-- AlterTable
ALTER TABLE "rental_leases" ADD COLUMN     "depositRefunded" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "rental_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "kind" "RentalInvoiceKind" NOT NULL,
    "periodMonth" DATE,
    "description" TEXT,
    "amountDue" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dueDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RentalPaymentMethod" NOT NULL,
    "reference" TEXT,
    "paidAt" DATE NOT NULL,
    "note" TEXT,
    "receiptNumber" TEXT NOT NULL,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_payment_allocations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "rental_invoices_organizationId_idx" ON "rental_invoices"("organizationId");

-- CreateIndex
CREATE INDEX "rental_invoices_leaseId_dueDate_idx" ON "rental_invoices"("leaseId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "rental_invoices_leaseId_kind_periodMonth_key" ON "rental_invoices"("leaseId", "kind", "periodMonth");

-- CreateIndex
CREATE INDEX "rental_payments_organizationId_idx" ON "rental_payments"("organizationId");

-- CreateIndex
CREATE INDEX "rental_payments_leaseId_paidAt_idx" ON "rental_payments"("leaseId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "rental_payments_organizationId_reference_key" ON "rental_payments"("organizationId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "rental_payments_organizationId_receiptNumber_key" ON "rental_payments"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "rental_payment_allocations_organizationId_idx" ON "rental_payment_allocations"("organizationId");

-- CreateIndex
CREATE INDEX "rental_payment_allocations_paymentId_idx" ON "rental_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "rental_payment_allocations_invoiceId_idx" ON "rental_payment_allocations"("invoiceId");

-- AddForeignKey
ALTER TABLE "rental_invoices" ADD CONSTRAINT "rental_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_invoices" ADD CONSTRAINT "rental_invoices_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "rental_leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payments" ADD CONSTRAINT "rental_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payments" ADD CONSTRAINT "rental_payments_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "rental_leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payment_allocations" ADD CONSTRAINT "rental_payment_allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payment_allocations" ADD CONSTRAINT "rental_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "rental_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payment_allocations" ADD CONSTRAINT "rental_payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "rental_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

