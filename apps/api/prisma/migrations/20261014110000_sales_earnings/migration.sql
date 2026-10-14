-- What marketing teams earn: an append-only ledger of commission shares, leader overrides and onboarding
-- bonuses, and the payouts recorded against it. Platform-level tables (no tenant); see the SalesEarning
-- comment in schema.prisma.

-- CreateEnum
CREATE TYPE "SalesEarningKind" AS ENUM ('COMMISSION_SHARE', 'LEADER_OVERRIDE', 'ONBOARDING_BONUS');

-- CreateEnum
CREATE TYPE "SalesEarningStatus" AS ENUM ('ACCRUED', 'PAID');

-- CreateTable
CREATE TABLE "sales_earnings" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "kind" "SalesEarningKind" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "baseKes" DECIMAL(12,2) NOT NULL,
    "rate" DECIMAL(5,4),
    "amountKes" DECIMAL(12,2) NOT NULL,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "periodMonth" TEXT NOT NULL,
    "status" "SalesEarningStatus" NOT NULL DEFAULT 'ACCRUED',
    "payoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_payouts" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "amountKes" DECIMAL(12,2) NOT NULL,
    "throughMonth" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "recordedByPlatformAdminId" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_earnings_agentId_status_idx" ON "sales_earnings"("agentId", "status");

-- CreateIndex
CREATE INDEX "sales_earnings_teamId_periodMonth_idx" ON "sales_earnings"("teamId", "periodMonth");

-- CreateIndex
CREATE UNIQUE INDEX "sales_earnings_kind_sourceId_key" ON "sales_earnings"("kind", "sourceId");

-- CreateIndex
CREATE INDEX "sales_payouts_agentId_idx" ON "sales_payouts"("agentId");

-- AddForeignKey
ALTER TABLE "sales_earnings" ADD CONSTRAINT "sales_earnings_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_earnings" ADD CONSTRAINT "sales_earnings_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "sales_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_earnings" ADD CONSTRAINT "sales_earnings_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "sales_payouts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_payouts" ADD CONSTRAINT "sales_payouts_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "sales_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
