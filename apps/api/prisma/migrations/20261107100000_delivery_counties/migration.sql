-- Delivery orders are limited to the counties a shop serves (its own branch county unless it lists others).
ALTER TABLE "online_stores" ADD COLUMN "deliveryCounties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "online_orders" ADD COLUMN "deliveryCounty" TEXT;
