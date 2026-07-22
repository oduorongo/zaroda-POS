-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('SALARY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateTable
CREATE TABLE "payroll_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "baseSalary" DECIMAL(12,2),
    "hourlyRate" DECIMAL(12,2),
    "kraPin" TEXT,
    "nssfNumber" TEXT,
    "shifNumber" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "payType" "PayType" NOT NULL,
    "hoursWorked" DECIMAL(8,2),
    "grossPay" DECIMAL(12,2) NOT NULL,
    "payeTax" DECIMAL(12,2) NOT NULL,
    "nssfDeduction" DECIMAL(12,2) NOT NULL,
    "shifDeduction" DECIMAL(12,2) NOT NULL,
    "housingLevy" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_profiles_orgUserId_key" ON "payroll_profiles"("orgUserId");

-- CreateIndex
CREATE INDEX "payroll_profiles_organizationId_idx" ON "payroll_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "payroll_runs_organizationId_idx" ON "payroll_runs"("organizationId");

-- CreateIndex
CREATE INDEX "payslips_payrollRunId_idx" ON "payslips"("payrollRunId");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_payrollRunId_orgUserId_key" ON "payslips"("payrollRunId", "orgUserId");

-- AddForeignKey
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_profiles" ADD CONSTRAINT "payroll_profiles_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "org_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "org_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
