-- Livestock valued as assets (IAS 41): costs to sell an animal as a share of its market value.
ALTER TABLE "farm_settings" ADD COLUMN "valuationSellingCostRate" DECIMAL(5,4) NOT NULL DEFAULT 0.05;
