-- CreateEnum
CREATE TYPE "ConPayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "ConPayLineStatus" AS ENUM ('UNPAID', 'SENDING', 'PAID', 'FAILED');

-- CreateEnum
CREATE TYPE "ConPayMethod" AS ENUM ('MPESA', 'MPESA_MANUAL', 'CASH');

-- CreateTable
CREATE TABLE "con_payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "status" "ConPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "workers" INTEGER NOT NULL DEFAULT 0,
    "gross" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_payroll_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "days" DECIMAL(5,1) NOT NULL,
    "dailyRate" DECIMAL(12,2) NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "nssf" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "shif" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "housingLevy" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paye" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,
    "status" "ConPayLineStatus" NOT NULL DEFAULT 'UNPAID',
    "method" "ConPayMethod",
    "reference" TEXT,
    "requestId" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "smsSentAt" TIMESTAMP(3),

    CONSTRAINT "con_payroll_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_payout_settings" (
    "organizationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "shortcode" TEXT,
    "initiator" TEXT,
    "consumerKeyEncrypted" TEXT,
    "consumerSecretEncrypted" TEXT,
    "securityCredentialEncrypted" TEXT,
    "callbackSecret" TEXT NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_payout_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "con_portal_users" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "partyId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "role" "ConRoleCode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "invitedBy" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_portal_access" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "portalUserId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_portal_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_portal_otps" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_portal_otps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "con_payroll_runs_organizationId_idx" ON "con_payroll_runs"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_payroll_runs_projectId_number_key" ON "con_payroll_runs"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "con_payroll_lines_requestId_key" ON "con_payroll_lines"("requestId");

-- CreateIndex
CREATE INDEX "con_payroll_lines_organizationId_idx" ON "con_payroll_lines"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_payroll_lines_runId_workerId_key" ON "con_payroll_lines"("runId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "con_portal_users_organizationId_email_key" ON "con_portal_users"("organizationId", "email");

-- CreateIndex
CREATE INDEX "con_portal_access_organizationId_idx" ON "con_portal_access"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_portal_access_portalUserId_projectId_key" ON "con_portal_access"("portalUserId", "projectId");

-- CreateIndex
CREATE INDEX "con_portal_otps_email_createdAt_idx" ON "con_portal_otps"("email", "createdAt");

-- AddForeignKey
ALTER TABLE "con_payroll_runs" ADD CONSTRAINT "con_payroll_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_payroll_runs" ADD CONSTRAINT "con_payroll_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_payroll_lines" ADD CONSTRAINT "con_payroll_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_payroll_lines" ADD CONSTRAINT "con_payroll_lines_runId_fkey" FOREIGN KEY ("runId") REFERENCES "con_payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_payroll_lines" ADD CONSTRAINT "con_payroll_lines_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "con_workers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_payout_settings" ADD CONSTRAINT "con_payout_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_portal_users" ADD CONSTRAINT "con_portal_users_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_portal_users" ADD CONSTRAINT "con_portal_users_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "con_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_portal_access" ADD CONSTRAINT "con_portal_access_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_portal_access" ADD CONSTRAINT "con_portal_access_portalUserId_fkey" FOREIGN KEY ("portalUserId") REFERENCES "con_portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_portal_access" ADD CONSTRAINT "con_portal_access_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

