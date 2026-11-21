-- A price range on a plan (Basic: KES 1,000 - 2,500 a month per device) and the price agreed with each business.
ALTER TABLE "plans" ADD COLUMN "minPriceKes" DECIMAL(12,2);
ALTER TABLE "subscriptions" ADD COLUMN "agreedPriceKes" DECIMAL(12,2);

-- The top of the range is the plan's own price (KES 2,500 on the live Billing screen); the lowest agreed price starts at KES 1,000.
UPDATE "plans" SET "minPriceKes" = 1000 WHERE "tier" = 'BASIC' AND "minPriceKes" IS NULL AND "priceKes" >= 1000;
