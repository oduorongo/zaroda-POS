-- Construction C9: power-line contractors (docs/construction/07). RLS for every new table is in rls.sql.

-- CreateEnum
CREATE TYPE "ConClientMoveKind" AS ENUM ('RECEIVED', 'ISSUED', 'RETURNED', 'DAMAGED');

-- CreateEnum
CREATE TYPE "ConWayleaveStatus" AS ENUM ('PENDING', 'AGREED', 'REFUSED', 'PAID');

-- CreateEnum
CREATE TYPE "ConCrossingKind" AS ENUM ('ROAD', 'RAIL', 'RIVER', 'PIPELINE', 'POWER_LINE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConCrossingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConLineAssetKind" AS ENUM ('POLE', 'STAY', 'TRANSFORMER', 'SWITCHGEAR', 'SERVICE', 'OTHER');

-- AlterEnum
ALTER TYPE "ConDocType" ADD VALUE 'EPRA_LICENCE';

-- AlterTable
ALTER TABLE "con_compliance_docs" ADD COLUMN     "epraClass" TEXT;

-- AlterTable
ALTER TABLE "con_tenders" ADD COLUMN     "voltageKv" DECIMAL(8,2);

-- AlterTable
ALTER TABLE "con_projects" ADD COLUMN     "voltageKv" DECIMAL(8,2);

-- CreateTable
CREATE TABLE "con_epra_classes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "anyVoltage" BOOLEAN NOT NULL DEFAULT false,
    "maxVoltageKv" DECIMAL(8,2),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_epra_classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_staff_licences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT 'EPRA',
    "licenceClass" TEXT NOT NULL,
    "licenceNo" TEXT NOT NULL,
    "expiresAt" DATE NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_staff_licences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_client_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_client_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_client_material_moves" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "kind" "ConClientMoveKind" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "sectionId" TEXT,
    "moveDate" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "con_client_material_moves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_project_sections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fromKm" DECIMAL(9,3),
    "toKm" DECIMAL(9,3),
    "targetPoles" INTEGER NOT NULL DEFAULT 0,
    "targetStays" INTEGER NOT NULL DEFAULT 0,
    "targetConductorKm" DECIMAL(9,3) NOT NULL DEFAULT 0,
    "targetTransformers" INTEGER NOT NULL DEFAULT 0,
    "targetServices" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_project_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_section_progress" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "poles" INTEGER NOT NULL DEFAULT 0,
    "stays" INTEGER NOT NULL DEFAULT 0,
    "conductorKm" DECIMAL(9,3) NOT NULL DEFAULT 0,
    "transformers" INTEGER NOT NULL DEFAULT 0,
    "services" INTEGER NOT NULL DEFAULT 0,
    "crew" TEXT,
    "notes" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_section_progress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_wayleaves" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT,
    "landowner" TEXT NOT NULL,
    "phone" TEXT,
    "parcelNo" TEXT,
    "chainageKm" DECIMAL(9,3),
    "status" "ConWayleaveStatus" NOT NULL DEFAULT 'PENDING',
    "compensation" DECIMAL(14,2),
    "agreedAt" DATE,
    "notes" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_wayleaves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_crossings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT,
    "kind" "ConCrossingKind" NOT NULL,
    "authority" TEXT NOT NULL,
    "refNo" TEXT,
    "status" "ConCrossingStatus" NOT NULL DEFAULT 'PENDING',
    "approvedAt" DATE,
    "expiresAt" DATE,
    "notes" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "fileType" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_crossings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "con_line_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT,
    "kind" "ConLineAssetKind" NOT NULL,
    "tag" TEXT NOT NULL,
    "serialNo" TEXT,
    "spec" TEXT,
    "lat" DECIMAL(9,6),
    "lng" DECIMAL(9,6),
    "installedAt" DATE,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "con_line_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "con_epra_classes_organizationId_code_key" ON "con_epra_classes"("organizationId", "code");

-- CreateIndex
CREATE INDEX "con_staff_licences_organizationId_idx" ON "con_staff_licences"("organizationId");

-- CreateIndex
CREATE INDEX "con_staff_licences_orgUserId_idx" ON "con_staff_licences"("orgUserId");

-- CreateIndex
CREATE INDEX "con_client_items_organizationId_idx" ON "con_client_items"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_client_items_projectId_code_key" ON "con_client_items"("projectId", "code");

-- CreateIndex
CREATE INDEX "con_client_material_moves_organizationId_idx" ON "con_client_material_moves"("organizationId");

-- CreateIndex
CREATE INDEX "con_client_material_moves_projectId_itemId_idx" ON "con_client_material_moves"("projectId", "itemId");

-- CreateIndex
CREATE INDEX "con_project_sections_organizationId_idx" ON "con_project_sections"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_project_sections_projectId_code_key" ON "con_project_sections"("projectId", "code");

-- CreateIndex
CREATE INDEX "con_section_progress_organizationId_idx" ON "con_section_progress"("organizationId");

-- CreateIndex
CREATE INDEX "con_section_progress_projectId_date_idx" ON "con_section_progress"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "con_section_progress_sectionId_date_key" ON "con_section_progress"("sectionId", "date");

-- CreateIndex
CREATE INDEX "con_wayleaves_organizationId_idx" ON "con_wayleaves"("organizationId");

-- CreateIndex
CREATE INDEX "con_wayleaves_projectId_idx" ON "con_wayleaves"("projectId");

-- CreateIndex
CREATE INDEX "con_crossings_organizationId_idx" ON "con_crossings"("organizationId");

-- CreateIndex
CREATE INDEX "con_crossings_projectId_idx" ON "con_crossings"("projectId");

-- CreateIndex
CREATE INDEX "con_line_assets_organizationId_idx" ON "con_line_assets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "con_line_assets_projectId_kind_tag_key" ON "con_line_assets"("projectId", "kind", "tag");

-- AddForeignKey
ALTER TABLE "con_client_material_moves" ADD CONSTRAINT "con_client_material_moves_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "con_client_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

