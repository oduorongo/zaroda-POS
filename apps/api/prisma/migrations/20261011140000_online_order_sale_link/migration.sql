-- An accepted online order is also written as an ordinary till sale, so online revenue shows in
-- Sales, Reports and profit. This links the order to that sale. Additive: one nullable column, no
-- existing row changes.
ALTER TABLE "online_orders" ADD COLUMN "saleId" TEXT;
CREATE UNIQUE INDEX "online_orders_saleId_key" ON "online_orders"("saleId");
ALTER TABLE "online_orders" ADD CONSTRAINT "online_orders_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;
