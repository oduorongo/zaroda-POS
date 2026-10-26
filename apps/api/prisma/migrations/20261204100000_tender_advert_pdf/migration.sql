-- Tender adverts: the school can attach its own tender document (PDF). Additive only.
ALTER TABLE "tender_adverts" ADD COLUMN     "pdfKey" TEXT,
ADD COLUMN     "pdfName" TEXT;
