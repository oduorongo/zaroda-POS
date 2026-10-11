-- Shoppers can sign in with an emailed code (the default - free, needs no SMS) as well as an
-- SMS code. So a buyer may have an email, a phone, or both, and a one-time code is addressed
-- to an "identifier" over a "channel". Every change is additive or relaxes a rule; the data
-- already in these tables (none on live yet) is preserved.
ALTER TABLE "buyers" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "buyers" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "buyers_email_key" ON "buyers"("email");

ALTER TABLE "buyer_otps" RENAME COLUMN "phone" TO "identifier";
ALTER TABLE "buyer_otps" ADD COLUMN "channel" TEXT NOT NULL DEFAULT 'SMS';
ALTER INDEX "buyer_otps_phone_createdAt_idx" RENAME TO "buyer_otps_identifier_createdAt_idx";
