-- Marketing teams: teams of people who onboard businesses and riders and earn commission on what they
-- generate. Platform-level tables (no tenant); see the SalesTeam comment in schema.prisma.

-- CreateEnum
CREATE TYPE "SalesAgentRole" AS ENUM ('LEADER', 'MEMBER');

-- CreateEnum
CREATE TYPE "SalesAgentStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SalesTeamStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "salesAgentId" TEXT,
ADD COLUMN     "salesTeamId" TEXT;

-- AlterTable
ALTER TABLE "riders" ADD COLUMN     "salesAgentId" TEXT,
ADD COLUMN     "salesTeamId" TEXT;

-- CreateTable
CREATE TABLE "sales_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "status" "SalesTeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "memberShareRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "leaderOverrideRate" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "onboardingBonusKes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_agents" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "SalesAgentRole" NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "status" "SalesAgentStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_agents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sales_teams_name_key" ON "sales_teams"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_agents_email_key" ON "sales_agents"("email");

-- CreateIndex
CREATE INDEX "sales_agents_teamId_idx" ON "sales_agents"("teamId");

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_salesTeamId_fkey" FOREIGN KEY ("salesTeamId") REFERENCES "sales_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "riders" ADD CONSTRAINT "riders_salesAgentId_fkey" FOREIGN KEY ("salesAgentId") REFERENCES "sales_agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_agents" ADD CONSTRAINT "sales_agents_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "sales_teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
