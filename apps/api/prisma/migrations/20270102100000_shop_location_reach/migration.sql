-- Shops are placed by map pin and shopping centre/estate, and say how far they deliver: by distance, by county, or anywhere in Kenya.
ALTER TABLE "online_stores" ADD COLUMN "locationArea" TEXT;
ALTER TABLE "online_stores" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "online_stores" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "online_stores" ADD COLUMN "deliveryReach" TEXT NOT NULL DEFAULT 'COUNTIES';
ALTER TABLE "online_stores" ADD COLUMN "deliveryRadiusKm" INTEGER;

ALTER TABLE "online_orders" ADD COLUMN "deliveryLat" DOUBLE PRECISION;
ALTER TABLE "online_orders" ADD COLUMN "deliveryLng" DOUBLE PRECISION;
