-- CreateEnum
CREATE TYPE "DeliveryJobStatus" AS ENUM ('OPEN', 'ASSIGNED', 'PICKED_UP', 'DELIVERED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryAudience" AS ENUM ('SHOP_RIDERS', 'EVERYONE', 'ONE_RIDER');

-- CreateEnum
CREATE TYPE "DeliveryQuoteStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DeliveryJobStatus" NOT NULL DEFAULT 'OPEN',
    "audience" "DeliveryAudience" NOT NULL,
    "targetRiderId" TEXT,
    "orderNumber" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "pickupArea" TEXT NOT NULL,
    "dropoffSummary" TEXT NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "quoteDeadline" TIMESTAMP(3) NOT NULL,
    "riderId" TEXT,
    "agreedFee" INTEGER,
    "assignedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cashCollected" INTEGER,
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_job_contacts" (
    "jobId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "buyerName" TEXT,
    "buyerPhone" TEXT NOT NULL,
    "deliveryAddress" TEXT NOT NULL,

    CONSTRAINT "delivery_job_contacts_pkey" PRIMARY KEY ("jobId")
);

-- CreateTable
CREATE TABLE "delivery_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "riderId" TEXT NOT NULL,
    "fee" INTEGER NOT NULL,
    "etaMinutes" INTEGER,
    "note" TEXT,
    "status" "DeliveryQuoteStatus" NOT NULL DEFAULT 'OFFERED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_jobs_organizationId_status_idx" ON "delivery_jobs"("organizationId", "status");

-- CreateIndex
CREATE INDEX "delivery_jobs_orderId_idx" ON "delivery_jobs"("orderId");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_quoteDeadline_idx" ON "delivery_jobs"("status", "quoteDeadline");

-- CreateIndex
CREATE INDEX "delivery_jobs_riderId_status_idx" ON "delivery_jobs"("riderId", "status");

-- CreateIndex
CREATE INDEX "delivery_quotes_jobId_idx" ON "delivery_quotes"("jobId");

-- CreateIndex
CREATE INDEX "delivery_quotes_riderId_idx" ON "delivery_quotes"("riderId");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_quotes_jobId_riderId_key" ON "delivery_quotes"("jobId", "riderId");

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "online_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_job_contacts" ADD CONSTRAINT "delivery_job_contacts_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "delivery_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_job_contacts" ADD CONSTRAINT "delivery_job_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "delivery_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_quotes" ADD CONSTRAINT "delivery_quotes_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "riders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

