-- eTIMS: recipes (item composition) sent to KRA. Additive only.
ALTER TABLE "etims_items" ADD COLUMN     "cpstSentKey" TEXT,
ADD COLUMN     "cpstError" TEXT;
