-- One extra till on the Basic plan, billed at the business's agreed price.
ALTER TABLE "plans" ADD COLUMN "maxExtraTills" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD COLUMN "extraTills" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_extraTills_check" CHECK ("extraTills" >= 0);

UPDATE "plans" SET "maxExtraTills" = 1 WHERE "tier" = 'BASIC';
