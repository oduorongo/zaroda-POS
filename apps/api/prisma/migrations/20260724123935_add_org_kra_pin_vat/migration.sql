-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "kraPin" TEXT,
ADD COLUMN     "vatRegistered" BOOLEAN NOT NULL DEFAULT false;
