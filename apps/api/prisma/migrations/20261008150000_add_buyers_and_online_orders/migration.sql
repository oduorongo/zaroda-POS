-- CreateEnum
CREATE TYPE "OnlineOrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'ACCEPTED', 'READY', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FulfilmentType" AS ENUM ('PICKUP', 'DELIVERY');

-- AlterEnum
ALTER TYPE "InventoryTxnType" ADD VALUE 'ONLINE_SALE';

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_otps" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "status" "OnlineOrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "fulfilmentType" "FulfilmentType" NOT NULL,
    "deliveryAddress" TEXT,
    "buyerNote" TEXT,
    "buyerName" TEXT,
    "buyerPhone" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "shopSlug" TEXT NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "amountDue" INTEGER NOT NULL,
    "commissionRate" DECIMAL(5,4) NOT NULL,
    "commissionAmount" DECIMAL(12,2),
    "paymentPhone" TEXT NOT NULL,
    "paymentDeadline" TIMESTAMP(3) NOT NULL,
    "tumaPaymentId" TEXT,
    "paymentAttemptedAt" TIMESTAMP(3),
    "mpesaReceiptNumber" TEXT,
    "paidAt" TIMESTAMP(3),
    "lastPaymentError" TEXT,
    "stockCommitted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "online_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "online_order_lines" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "online_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "buyers_phone_key" ON "buyers"("phone");

-- CreateIndex
CREATE INDEX "buyer_otps_phone_createdAt_idx" ON "buyer_otps"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_orderNumber_key" ON "online_orders"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "online_orders_mpesaReceiptNumber_key" ON "online_orders"("mpesaReceiptNumber");

-- CreateIndex
CREATE INDEX "online_orders_organizationId_status_idx" ON "online_orders"("organizationId", "status");

-- CreateIndex
CREATE INDEX "online_orders_buyerId_createdAt_idx" ON "online_orders"("buyerId", "createdAt");

-- CreateIndex
CREATE INDEX "online_orders_branchId_status_idx" ON "online_orders"("branchId", "status");

-- CreateIndex
CREATE INDEX "online_order_lines_orderId_idx" ON "online_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "online_order_lines_variantId_idx" ON "online_order_lines"("variantId");

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "online_order_lines" ADD CONSTRAINT "online_order_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

