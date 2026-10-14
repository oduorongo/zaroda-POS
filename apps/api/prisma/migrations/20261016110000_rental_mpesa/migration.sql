-- CreateEnum
CREATE TYPE "RentalPaymentRequestStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REVIEW');

-- CreateTable
CREATE TABLE "rental_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "paymentGateway" TEXT NOT NULL DEFAULT 'TUMA',
    "tumaEmail" TEXT,
    "tumaApiKeyEncrypted" TEXT,
    "mpesaAccountType" TEXT,
    "mpesaShortcode" TEXT,
    "mpesaTillNumber" TEXT,
    "mpesaConsumerKeyEncrypted" TEXT,
    "mpesaConsumerSecretEncrypted" TEXT,
    "mpesaPasskeyEncrypted" TEXT,
    "mpesaEnvironment" TEXT NOT NULL DEFAULT 'production',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_payment_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "leaseId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "phone" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "requestId" TEXT,
    "status" "RentalPaymentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "mpesaReceipt" TEXT,
    "paymentId" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_payment_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_settings_organizationId_key" ON "rental_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "rental_payment_requests_paymentId_key" ON "rental_payment_requests"("paymentId");

-- CreateIndex
CREATE INDEX "rental_payment_requests_organizationId_idx" ON "rental_payment_requests"("organizationId");

-- CreateIndex
CREATE INDEX "rental_payment_requests_leaseId_createdAt_idx" ON "rental_payment_requests"("leaseId", "createdAt");

-- CreateIndex
CREATE INDEX "rental_payment_requests_status_createdAt_idx" ON "rental_payment_requests"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "rental_settings" ADD CONSTRAINT "rental_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payment_requests" ADD CONSTRAINT "rental_payment_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_payment_requests" ADD CONSTRAINT "rental_payment_requests_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "rental_leases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

