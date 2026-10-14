-- One provider transaction (e.g. an M-Pesa checkoutRequestId) may settle at
-- most one sale. If this fails on an existing database, find the duplicates
-- first:
--   SELECT "providerReference", count(*) FROM "sale_payments"
--   WHERE "providerReference" IS NOT NULL
--   GROUP BY 1 HAVING count(*) > 1;

-- CreateIndex
CREATE UNIQUE INDEX "sale_payments_providerReference_key" ON "sale_payments"("providerReference");
