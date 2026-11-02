-- Construction C2: settings, staff accreditation, parties, tenders, projects, project parties, permits, milestones, BQ. Additive only.

-- CreateEnum
CREATE TYPE "ConTenderStatus" AS ENUM ('PREPARING', 'SUBMITTED', 'WON', 'LOST', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ConPartyKind" AS ENUM ('CLIENT', 'ARCHITECT', 'QS', 'ENGINEER', 'SUBCONTRACTOR', 'OTHER');

-- CreateEnum
CREATE TYPE "ConFormOfContract" AS ENUM ('JBC', 'FIDIC', 'PPADA', 'SIMPLE');

-- CreateEnum
CREATE TYPE "ConProjectStatus" AS ENUM ('PLANNING', 'ACTIVE', 'PRACTICAL_COMPLETION', 'DLP', 'CLOSED');

-- CreateEnum
CREATE TYPE "ConPermitType" AS ENUM ('NCA_PROJECT_REG', 'COUNTY_APPROVAL', 'BUILDING_PERMIT', 'NEMA_EIA', 'DOSHS_REG', 'OCCUPANCY');

-- CreateEnum
CREATE TYPE "ConPermitStatus" AS ENUM ('PENDING', 'APPLIED', 'APPROVED', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "ConRuleMode" AS ENUM ('BLOCK', 'WARN');

-- CreateTable
CREATE TABLE "con_settings" (
    "organizationId" TEXT NOT NULL,
    "ncaProjectRegRule" "ConRuleMode" NOT NULL DEFAULT 'BLOCK',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_settings_pkey" PRIMARY KEY ("organizationId")
);

-- CreateTable
CREATE TABLE "con_staff_accreditations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "cardNo" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_staff_accreditations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_parties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "ConPartyKind" NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "kraPin" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_tenders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "ref" TEXT,
    "title" TEXT NOT NULL,
    "procuringEntity" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "agpoReserved" BOOLEAN NOT NULL DEFAULT false,
    "worksClass" "ConWorksClass" NOT NULL,
    "estValue" DECIMAL(16,2) NOT NULL,
    "closingAt" TIMESTAMP(3),
    "bidBond" DECIMAL(14,2),
    "bidBondExpiresAt" DATE,
    "status" "ConTenderStatus" NOT NULL DEFAULT 'PREPARING',
    "capOverrideReason" TEXT,
    "capOverrideBy" TEXT,
    "outcomeNote" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_projects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientId" TEXT,
    "tenderId" TEXT,
    "worksClass" "ConWorksClass" NOT NULL,
    "contractSum" DECIMAL(16,2) NOT NULL,
    "revisedSum" DECIMAL(16,2),
    "formOfContract" "ConFormOfContract" NOT NULL DEFAULT 'JBC',
    "startDate" DATE,
    "completionDate" DATE,
    "dlpMonths" INTEGER NOT NULL DEFAULT 12,
    "retentionRate" DECIMAL(5,2) NOT NULL DEFAULT 10,
    "retentionLimit" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "county" TEXT,
    "location" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "status" "ConProjectStatus" NOT NULL DEFAULT 'PLANNING',
    "capOverrideReason" TEXT,
    "capOverrideBy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_project_parties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "role" "ConPartyKind" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_project_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_project_permits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" "ConPermitType" NOT NULL,
    "status" "ConPermitStatus" NOT NULL DEFAULT 'PENDING',
    "refNo" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "notes" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_project_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_milestones" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "percentComplete" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_bq_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_bq_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_bq_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" DECIMAL(14,3) NOT NULL,
    "rate" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_bq_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_staff_accreditations_orgUserId_key" ON "con_staff_accreditations"("orgUserId");

-- CreateIndex
CREATE INDEX "con_staff_accreditations_organizationId_idx" ON "con_staff_accreditations"("organizationId");

-- CreateIndex
CREATE INDEX "con_parties_organizationId_kind_idx" ON "con_parties"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "con_tenders_organizationId_status_idx" ON "con_tenders"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "con_projects_tenderId_key" ON "con_projects"("tenderId");

-- CreateIndex
CREATE INDEX "con_projects_organizationId_status_idx" ON "con_projects"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "con_projects_organizationId_code_key" ON "con_projects"("organizationId", "code");

-- CreateIndex
CREATE INDEX "con_project_parties_organizationId_idx" ON "con_project_parties"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_project_parties_projectId_partyId_role_key" ON "con_project_parties"("projectId", "partyId", "role");

-- CreateIndex
CREATE INDEX "con_project_permits_organizationId_idx" ON "con_project_permits"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_project_permits_projectId_type_key" ON "con_project_permits"("projectId", "type");

-- CreateIndex
CREATE INDEX "con_milestones_organizationId_idx" ON "con_milestones"("organizationId");

-- CreateIndex
CREATE INDEX "con_milestones_projectId_idx" ON "con_milestones"("projectId");

-- CreateIndex
CREATE INDEX "con_bq_sections_organizationId_idx" ON "con_bq_sections"("organizationId");

-- CreateIndex
CREATE INDEX "con_bq_sections_projectId_idx" ON "con_bq_sections"("projectId");

-- CreateIndex
CREATE INDEX "con_bq_items_organizationId_idx" ON "con_bq_items"("organizationId");

-- CreateIndex
CREATE INDEX "con_bq_items_sectionId_idx" ON "con_bq_items"("sectionId");

-- AddForeignKey
ALTER TABLE "con_project_members" ADD CONSTRAINT "con_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_settings" ADD CONSTRAINT "con_settings_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_staff_accreditations" ADD CONSTRAINT "con_staff_accreditations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_staff_accreditations" ADD CONSTRAINT "con_staff_accreditations_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_parties" ADD CONSTRAINT "con_parties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_tenders" ADD CONSTRAINT "con_tenders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_projects" ADD CONSTRAINT "con_projects_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_projects" ADD CONSTRAINT "con_projects_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "con_parties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_projects" ADD CONSTRAINT "con_projects_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "con_tenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_parties" ADD CONSTRAINT "con_project_parties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_parties" ADD CONSTRAINT "con_project_parties_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_parties" ADD CONSTRAINT "con_project_parties_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "con_parties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_permits" ADD CONSTRAINT "con_project_permits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_project_permits" ADD CONSTRAINT "con_project_permits_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_milestones" ADD CONSTRAINT "con_milestones_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_milestones" ADD CONSTRAINT "con_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_bq_sections" ADD CONSTRAINT "con_bq_sections_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_bq_sections" ADD CONSTRAINT "con_bq_sections_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_bq_items" ADD CONSTRAINT "con_bq_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_bq_items" ADD CONSTRAINT "con_bq_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "con_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "con_bq_items" ADD CONSTRAINT "con_bq_items_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "con_bq_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

