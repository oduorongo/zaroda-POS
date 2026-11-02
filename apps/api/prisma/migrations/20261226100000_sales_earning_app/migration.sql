-- Which app the money behind an earning came from: POS, ONLINE_SHOP, CONSTRUCTION or RENTALS.
ALTER TABLE "sales_earnings" ADD COLUMN "sourceApp" TEXT NOT NULL DEFAULT 'POS';
UPDATE "sales_earnings" SET "sourceApp" = 'ONLINE_SHOP' WHERE "kind" = 'COMMISSION_SHARE';
UPDATE "sales_earnings" e SET "sourceApp" = 'ONLINE_SHOP'
  FROM "sales_earnings" s WHERE e."kind" = 'LEADER_OVERRIDE' AND s."kind" = 'COMMISSION_SHARE' AND s."sourceId" = e."sourceId";
CREATE INDEX "sales_earnings_sourceApp_periodMonth_idx" ON "sales_earnings"("sourceApp", "periodMonth");
UPDATE "sales_earnings" e SET "sourceApp" = s."sourceApp"
  FROM "sales_earnings" s WHERE e."kind" = 'ADJUSTMENT' AND e."sourceId" LIKE s."id" || ':%';
