-- Customers: an optional KRA PIN, sent to KRA with a sale and printed on the receipt as the buyer PIN. Additive only.
ALTER TABLE "customers" ADD COLUMN     "kraPin" TEXT;
