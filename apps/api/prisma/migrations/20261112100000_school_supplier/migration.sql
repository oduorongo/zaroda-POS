-- School suppliers: schools, price list, school orders, invoices, payments and receipts, document numbers.
-- CreateEnum
CREATE TYPE "SchoolStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SchoolOrderStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('CHEQUE', 'BANK_TRANSFER', 'MPESA', 'CASH');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('RECEIVED', 'BOUNCED');

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'CREDIT_SALE';

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "invoiceFooter" TEXT,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "onSchoolList" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "schoolPrice" DECIMAL(12,2);

-- CreateTable
CREATE TABLE "school_portals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_portals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_schools" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "address" TEXT,
    "county" TEXT,
    "creditLimit" DECIMAL(12,2),
    "creditDays" INTEGER NOT NULL DEFAULT 30,
    "status" "SchoolStatus" NOT NULL DEFAULT 'ACTIVE',
    "pinHash" TEXT,
    "pinFailCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_schools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "lpoNumber" TEXT,
    "status" "SchoolOrderStatus" NOT NULL DEFAULT 'SUBMITTED',
    "notes" TEXT,
    "deliveryAddress" TEXT,
    "requestedDate" DATE,
    "overCreditLimit" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "confirmationNote" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "deliveryNoteNumber" TEXT,
    "receivedByName" TEXT,
    "deliveryNotes" TEXT,
    "deliveredById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "quantityOrdered" DECIMAL(14,3) NOT NULL,
    "quantityConfirmed" DECIMAL(14,3),
    "quantityDelivered" DECIMAL(14,3),

    CONSTRAINT "school_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "orderId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "amountPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "variantId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "taxAmount" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2),

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "SupplierPaymentMethod" NOT NULL,
    "reference" TEXT,
    "bankName" TEXT,
    "chequeDate" DATE,
    "receivedOn" DATE NOT NULL,
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'RECEIVED',
    "bouncedAt" TIMESTAMP(3),
    "bounceReason" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_counters" (
    "organizationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "document_counters_pkey" PRIMARY KEY ("organizationId","kind","year")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_portals_organizationId_key" ON "school_portals"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "school_portals_slug_key" ON "school_portals"("slug");

-- CreateIndex
CREATE INDEX "supplier_schools_organizationId_idx" ON "supplier_schools"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_schools_organizationId_phone_key" ON "supplier_schools"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "school_orders_orderNumber_key" ON "school_orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "school_orders_deliveryNoteNumber_key" ON "school_orders"("deliveryNoteNumber");

-- CreateIndex
CREATE INDEX "school_orders_organizationId_status_idx" ON "school_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "school_orders_schoolId_idx" ON "school_orders"("schoolId");

-- CreateIndex
CREATE INDEX "school_order_lines_orderId_idx" ON "school_order_lines"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_orderId_key" ON "supplier_invoices"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_invoiceNumber_key" ON "supplier_invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "supplier_invoices_organizationId_status_idx" ON "supplier_invoices"("organizationId", "status");

-- CreateIndex
CREATE INDEX "supplier_invoices_schoolId_idx" ON "supplier_invoices"("schoolId");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_invoiceId_idx" ON "supplier_invoice_lines"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_receiptNumber_key" ON "supplier_payments"("receiptNumber");

-- CreateIndex
CREATE INDEX "supplier_payments_organizationId_receivedOn_idx" ON "supplier_payments"("organizationId", "receivedOn");

-- CreateIndex
CREATE INDEX "supplier_payments_schoolId_idx" ON "supplier_payments"("schoolId");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_paymentId_idx" ON "supplier_payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_invoiceId_idx" ON "supplier_payment_allocations"("invoiceId");

-- AddForeignKey
ALTER TABLE "school_portals" ADD CONSTRAINT "school_portals_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_schools" ADD CONSTRAINT "supplier_schools_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_orders" ADD CONSTRAINT "school_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_orders" ADD CONSTRAINT "school_orders_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_order_lines" ADD CONSTRAINT "school_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "school_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_order_lines" ADD CONSTRAINT "school_order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "school_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

