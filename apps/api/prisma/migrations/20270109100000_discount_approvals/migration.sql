-- A supervisor's PIN-checked approval of one discount, used once by the sale that carries it.
CREATE TABLE "discount_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "saleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "discount_approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "discount_approvals_organizationId_createdAt_idx" ON "discount_approvals"("organizationId", "createdAt");
