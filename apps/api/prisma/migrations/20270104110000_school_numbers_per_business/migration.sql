-- School documents are numbered per business (SO-2026-0001 in every business), so the numbers are unique per business, not across all.
DROP INDEX IF EXISTS "school_contracts_contractNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "school_contracts_organizationId_contractNumber_key" ON "school_contracts"("organizationId", "contractNumber");
DROP INDEX IF EXISTS "school_orders_orderNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "school_orders_organizationId_orderNumber_key" ON "school_orders"("organizationId", "orderNumber");
DROP INDEX IF EXISTS "school_deliveries_deliveryNoteNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "school_deliveries_organizationId_deliveryNoteNumber_key" ON "school_deliveries"("organizationId", "deliveryNoteNumber");
DROP INDEX IF EXISTS "supplier_invoices_invoiceNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_invoices_organizationId_invoiceNumber_key" ON "supplier_invoices"("organizationId", "invoiceNumber");
DROP INDEX IF EXISTS "supplier_credit_notes_creditNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_credit_notes_organizationId_creditNumber_key" ON "supplier_credit_notes"("organizationId", "creditNumber");
DROP INDEX IF EXISTS "supplier_payments_receiptNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payments_organizationId_receiptNumber_key" ON "supplier_payments"("organizationId", "receiptNumber");
DROP INDEX IF EXISTS "school_quotes_quoteNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "school_quotes_organizationId_quoteNumber_key" ON "school_quotes"("organizationId", "quoteNumber");
