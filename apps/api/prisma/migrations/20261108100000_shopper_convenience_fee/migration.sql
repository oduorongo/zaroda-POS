-- Shoppers pay a convenience fee at checkout; the shop collects it and sends the day's total to Zaroda (daily fee invoices).
ALTER TABLE "online_orders" ADD COLUMN "convenienceFee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "commission_invoices" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'MONTHLY';
