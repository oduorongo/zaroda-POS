-- eTIMS stock movements: where the scan for movements to report has got to. Additive only.
-- AlterTable
ALTER TABLE "etims_settings" ADD COLUMN     "stockScannedAt" TIMESTAMP(3);

