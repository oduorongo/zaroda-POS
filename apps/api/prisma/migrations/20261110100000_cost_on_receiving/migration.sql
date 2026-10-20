-- What was paid per unit on a delivery received with a price (the product's cost is updated as a weighted average).
ALTER TABLE "inventory_transactions" ADD COLUMN "unitCost" DECIMAL(12,2);
