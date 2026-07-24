-- CreateEnum
CREATE TYPE "StkRequestStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "mpesa_stk_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "checkoutRequestId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "status" "StkRequestStatus" NOT NULL DEFAULT 'PENDING',
    "mpesaReceiptNumber" TEXT,
    "resultDesc" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpesa_stk_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_stk_requests_checkoutRequestId_key" ON "mpesa_stk_requests"("checkoutRequestId");

-- CreateIndex
CREATE INDEX "mpesa_stk_requests_organizationId_idx" ON "mpesa_stk_requests"("organizationId");

-- AddForeignKey
ALTER TABLE "mpesa_stk_requests" ADD CONSTRAINT "mpesa_stk_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
