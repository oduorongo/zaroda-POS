-- ZARODA POS — Row-Level Security policies.
--
-- Prisma has no RLS DSL, so this file is applied separately from
-- `prisma migrate dev` (see prisma/README.md for the run order). It is the
-- actual tenant-isolation boundary described in DESIGN.md §2 — a bug in an
-- application query's WHERE clause cannot leak another tenant's rows,
-- because Postgres itself refuses to return them.
--
-- Column names are camelCase and double-quoted throughout because Prisma
-- field names (organizationId, branchId, ...) were not given explicit
-- @map("snake_case") overrides in schema.prisma - only table names were
-- (@@map). Postgres lower-cases unquoted identifiers, so every reference to
-- a camelCase column here MUST be quoted or it silently resolves to the
-- (non-existent) all-lowercase name instead of erroring loudly.
--
-- Convention: every tenant-owned table gets `ENABLE ROW LEVEL SECURITY`
-- plus a `USING` policy scoping SELECT/UPDATE/DELETE, and a `WITH CHECK`
-- policy on the same clause scoping INSERT/UPDATE. Tables that carry
-- organizationId directly filter on it; tables that only carry a foreign
-- key to an org-scoped parent filter via an EXISTS subquery through that
-- parent, so isolation holds even at the line-item/payment level.
--
-- The API's request-scoped interceptor issues:
--   SELECT set_config('app.current_tenant', '<organization-id>', true);
-- at the start of every transaction (see TenantScopedPrismaService). Internal
-- admin tooling connects as a separate Postgres role with BYPASSRLS and never
-- serves tenant-facing requests.
--
-- Every CREATE POLICY is preceded by a matching DROP POLICY IF EXISTS
-- (Phase 3 DR-runbook hardening) so this entire file can be re-run
-- blindly against an already-provisioned database - `ALTER TABLE ...
-- ENABLE/FORCE` are already no-ops if already applied, but a bare CREATE
-- POLICY errors on a name collision, which is exactly what happened
-- every time a new table was added earlier in this project (worked
-- around each time with a hand-rolled temp file containing just the new
-- table's policy). That workaround doesn't exist during an actual
-- disaster recovery restore where a human needs one command that just
-- works, not tribal knowledge of which tables are already covered.

-- ── Direct organizationId ────────────────────────────────────────────────

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON branches;
CREATE POLICY tenant_isolation ON branches
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON categories;
CREATE POLICY tenant_isolation ON categories
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE tax_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tax_classes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tax_classes;
CREATE POLICY tenant_isolation ON tax_classes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON products;
CREATE POLICY tenant_isolation ON products
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sales;
CREATE POLICY tenant_isolation ON sales
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE mpesa_stk_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE mpesa_stk_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON mpesa_stk_requests;
CREATE POLICY tenant_isolation ON mpesa_stk_requests
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- org_users needs a deliberate, narrow exception: login has to search across
-- ALL organizations a user belongs to BEFORE a tenant is established (that's
-- inherent to "find which org this email/PIN belongs to", not a leak - the
-- alternative, a separate BYPASSRLS role for auth lookups, is more moving
-- parts than a pilot needs). The exception only ever widens SELECT, and only
-- when no tenant has been set yet in this transaction; WITH CHECK (governing
-- INSERT/UPDATE) stays strict, so nothing can be written without a tenant.
-- The instant a request establishes a tenant (TenantScopedPrismaService.run),
-- the OR's right-hand side is false and full isolation applies as normal.
ALTER TABLE org_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON org_users;
CREATE POLICY tenant_isolation ON org_users
  USING (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via branchId -> branches."organizationId" ─────────────────────

ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
ALTER TABLE terminals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON terminals;
CREATE POLICY tenant_isolation ON terminals
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = terminals."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = terminals."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory_items;
CREATE POLICY tenant_isolation ON inventory_items
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_items."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_items."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON shifts;
CREATE POLICY tenant_isolation ON shifts
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = shifts."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = shifts."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON inventory_transactions;
CREATE POLICY tenant_isolation ON inventory_transactions
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_transactions."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_transactions."branchId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via terminalId -> branches."organizationId" ────────────────────

ALTER TABLE cashier_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cashier_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON cashier_sessions;
CREATE POLICY tenant_isolation ON cashier_sessions
  USING (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t."branchId"
                 WHERE t.id = cashier_sessions."terminalId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t."branchId"
                 WHERE t.id = cashier_sessions."terminalId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_outbox FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sync_outbox;
CREATE POLICY tenant_isolation ON sync_outbox
  USING (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t."branchId"
                 WHERE t.id = sync_outbox."terminalId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t."branchId"
                 WHERE t.id = sync_outbox."terminalId"
                 AND b."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via productId -> products."organizationId" ─────────────────────

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_variants;
CREATE POLICY tenant_isolation ON product_variants
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE product_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_images FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON product_images;
CREATE POLICY tenant_isolation ON product_images
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_images."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_images."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via variantId -> products."organizationId" ──────────────────────

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON batches;
CREATE POLICY tenant_isolation ON batches
  USING (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v."productId"
                 WHERE v.id = batches."variantId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v."productId"
                 WHERE v.id = batches."variantId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via saleId -> sales."organizationId" ────────────────────────────

ALTER TABLE sale_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sale_line_items;
CREATE POLICY tenant_isolation ON sale_line_items
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_line_items."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_line_items."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sale_payments;
CREATE POLICY tenant_isolation ON sale_payments
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON discounts;
CREATE POLICY tenant_isolation ON discounts
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = discounts."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = discounts."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON refunds;
CREATE POLICY tenant_isolation ON refunds
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = refunds."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = refunds."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

-- ── Direct organizationId (Phase 2: stock transfers/takes) ────────────────

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_transfers;
CREATE POLICY tenant_isolation ON stock_transfers
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE stock_takes ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_takes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_takes;
CREATE POLICY tenant_isolation ON stock_takes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via stockTakeId -> stock_takes."organizationId" ────────────────

ALTER TABLE stock_take_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_take_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON stock_take_lines;
CREATE POLICY tenant_isolation ON stock_take_lines
  USING (EXISTS (SELECT 1 FROM stock_takes st WHERE st.id = stock_take_lines."stockTakeId"
                 AND st."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM stock_takes st WHERE st.id = stock_take_lines."stockTakeId"
                 AND st."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE low_stock_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE low_stock_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON low_stock_alerts;
CREATE POLICY tenant_isolation ON low_stock_alerts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON customers;
CREATE POLICY tenant_isolation ON customers
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE layaways ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaways FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON layaways;
CREATE POLICY tenant_isolation ON layaways
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via layawayId -> layaways."organizationId" ──────────────────────

ALTER TABLE layaway_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaway_line_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON layaway_line_items;
CREATE POLICY tenant_isolation ON layaway_line_items
  USING (EXISTS (SELECT 1 FROM layaways l WHERE l.id = layaway_line_items."layawayId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM layaways l WHERE l.id = layaway_line_items."layawayId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE layaway_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE layaway_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON layaway_payments;
CREATE POLICY tenant_isolation ON layaway_payments
  USING (EXISTS (SELECT 1 FROM layaways l WHERE l.id = layaway_payments."layawayId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM layaways l WHERE l.id = layaway_payments."layawayId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)));

-- ── Restaurant module (Phase 4, packages/modules/restaurant) ──────────────

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_tables;
CREATE POLICY tenant_isolation ON restaurant_tables
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via saleId -> sales."organizationId" ────────────────────────────

ALTER TABLE restaurant_sale_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_sale_tables FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_sale_tables;
CREATE POLICY tenant_isolation ON restaurant_sale_tables
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = restaurant_sale_tables."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = restaurant_sale_tables."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE restaurant_sale_tips ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_sale_tips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_sale_tips;
CREATE POLICY tenant_isolation ON restaurant_sale_tips
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = restaurant_sale_tips."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = restaurant_sale_tips."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE kitchen_stations ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_stations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_stations;
CREATE POLICY tenant_isolation ON kitchen_stations
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via saleId -> sales."organizationId", or (a ticket from an open bill, which has no sale) via
-- tabId -> restaurant_tabs."organizationId" ──────────────────────────────────

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_tickets;
CREATE POLICY tenant_isolation ON kitchen_tickets
  USING (
    EXISTS (SELECT 1 FROM sales s WHERE s.id = kitchen_tickets."saleId"
            AND s."organizationId" = current_setting('app.current_tenant', true))
    OR EXISTS (SELECT 1 FROM restaurant_tabs t WHERE t.id = kitchen_tickets."tabId"
            AND t."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (
    EXISTS (SELECT 1 FROM sales s WHERE s.id = kitchen_tickets."saleId"
            AND s."organizationId" = current_setting('app.current_tenant', true))
    OR EXISTS (SELECT 1 FROM restaurant_tabs t WHERE t.id = kitchen_tickets."tabId"
            AND t."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via ticketId -> kitchen_tickets -> its sale, or its open bill ────

ALTER TABLE kitchen_ticket_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_ticket_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_ticket_lines;
CREATE POLICY tenant_isolation ON kitchen_ticket_lines
  USING (EXISTS (SELECT 1 FROM kitchen_tickets kt
                 LEFT JOIN sales s ON s.id = kt."saleId"
                 LEFT JOIN restaurant_tabs t ON t.id = kt."tabId"
                 WHERE kt.id = kitchen_ticket_lines."ticketId"
                 AND coalesce(s."organizationId", t."organizationId") = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM kitchen_tickets kt
                 LEFT JOIN sales s ON s.id = kt."saleId"
                 LEFT JOIN restaurant_tabs t ON t.id = kt."tabId"
                 WHERE kt.id = kitchen_ticket_lines."ticketId"
                 AND coalesce(s."organizationId", t."organizationId") = current_setting('app.current_tenant', true)));

-- ── Scoped via productId -> products."organizationId" ──────────────────────

ALTER TABLE pharmacy_product_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_product_flags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pharmacy_product_flags;
CREATE POLICY tenant_isolation ON pharmacy_product_flags
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = pharmacy_product_flags."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = pharmacy_product_flags."productId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via saleId -> sales."organizationId" ────────────────────────────

ALTER TABLE pharmacy_sale_prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE pharmacy_sale_prescriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON pharmacy_sale_prescriptions;
CREATE POLICY tenant_isolation ON pharmacy_sale_prescriptions
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = pharmacy_sale_prescriptions."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = pharmacy_sale_prescriptions."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE salon_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_resources FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salon_resources;
CREATE POLICY tenant_isolation ON salon_resources
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE salon_appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_appointments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salon_appointments;
CREATE POLICY tenant_isolation ON salon_appointments
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via saleId -> sales."organizationId" ────────────────────────────

ALTER TABLE salon_appointment_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE salon_appointment_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON salon_appointment_sales;
CREATE POLICY tenant_isolation ON salon_appointment_sales
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = salon_appointment_sales."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = salon_appointment_sales."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via variantId -> products."organizationId" ──────────────────────

ALTER TABLE recipe_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_ingredients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON recipe_ingredients;
CREATE POLICY tenant_isolation ON recipe_ingredients
  USING (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v."productId"
                 WHERE v.id = recipe_ingredients."variantId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v."productId"
                 WHERE v.id = recipe_ingredients."variantId"
                 AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via saleLineItemId -> sale_line_items.saleId -> sales."organizationId" ─

ALTER TABLE sale_line_item_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_line_item_ingredients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON sale_line_item_ingredients;
CREATE POLICY tenant_isolation ON sale_line_item_ingredients
  USING (EXISTS (SELECT 1 FROM sale_line_items sli JOIN sales s ON s.id = sli."saleId"
                 WHERE sli.id = sale_line_item_ingredients."saleLineItemId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sale_line_items sli JOIN sales s ON s.id = sli."saleId"
                 WHERE sli.id = sale_line_item_ingredients."saleLineItemId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

-- ── Purchasing (suppliers, purchase orders) ────────────────────────────────

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON suppliers;
CREATE POLICY tenant_isolation ON suppliers
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_orders;
CREATE POLICY tenant_isolation ON purchase_orders
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via purchaseOrderId -> purchase_orders."organizationId" ────────

ALTER TABLE purchase_order_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_line_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON purchase_order_line_items;
CREATE POLICY tenant_isolation ON purchase_order_line_items
  USING (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_line_items."purchaseOrderId"
                 AND po."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM purchase_orders po WHERE po.id = purchase_order_line_items."purchaseOrderId"
                 AND po."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE waste_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON waste_logs;
CREATE POLICY tenant_isolation ON waste_logs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via wasteLogId -> waste_logs."organizationId" ──────────────────

ALTER TABLE waste_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_ingredients FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON waste_ingredients;
CREATE POLICY tenant_isolation ON waste_ingredients
  USING (EXISTS (SELECT 1 FROM waste_logs wl WHERE wl.id = waste_ingredients."wasteLogId"
                 AND wl."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM waste_logs wl WHERE wl.id = waste_ingredients."wasteLogId"
                 AND wl."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE repackagings ENABLE ROW LEVEL SECURITY;
ALTER TABLE repackagings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON repackagings;
CREATE POLICY tenant_isolation ON repackagings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON production_orders;
CREATE POLICY tenant_isolation ON production_orders
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE service_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_jobs;
CREATE POLICY tenant_isolation ON service_jobs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via jobId -> service_jobs."organizationId" ──────────────────────

ALTER TABLE service_job_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_job_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON service_job_sales;
CREATE POLICY tenant_isolation ON service_job_sales
  USING (EXISTS (SELECT 1 FROM service_jobs sj WHERE sj.id = service_job_sales."jobId"
                 AND sj."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM service_jobs sj WHERE sj.id = service_job_sales."jobId"
                 AND sj."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE payroll_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll_profiles;
CREATE POLICY tenant_isolation ON payroll_profiles
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll_runs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payroll_runs;
CREATE POLICY tenant_isolation ON payroll_runs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Scoped via payrollRunId -> payroll_runs."organizationId" ───────────────

ALTER TABLE payslips ENABLE ROW LEVEL SECURITY;
ALTER TABLE payslips FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON payslips;
CREATE POLICY tenant_isolation ON payslips
  USING (EXISTS (SELECT 1 FROM payroll_runs pr WHERE pr.id = payslips."payrollRunId"
                 AND pr."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM payroll_runs pr WHERE pr.id = payslips."payrollRunId"
                 AND pr."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE roster_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_shifts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON roster_shifts;
CREATE POLICY tenant_isolation ON roster_shifts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Online shop settings (marketplace add-on).
ALTER TABLE online_stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_stores FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON online_stores;
CREATE POLICY tenant_isolation ON online_stores
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Deliberate, narrow public exception: the storefront and buyer checkout
-- must find a shop by its slug before any tenant is known. A transaction
-- opts in with set_config('app.public_catalog', 'on', true) (only
-- PublicShopService / OnlineOrdersService do), and even then sees only
-- shops that are paid for AND published. SELECT only - permissive policies
-- OR together, so this never widens what can be written. Callers select
-- only public columns; the TUMA key is encrypted regardless.
DROP POLICY IF EXISTS public_catalog_read ON online_stores;
CREATE POLICY public_catalog_read ON online_stores
  FOR SELECT
  USING (current_setting('app.public_catalog', true) = 'on'
         AND "addonActive" AND "isPublished");

-- Online orders belong to two parties: the business (app.current_tenant)
-- and the buyer who placed it (app.current_buyer, set by buyer-facing
-- requests from the verified buyer JWT - see BuyerAuthGuard). Either may
-- see the order; neither sees anyone else's.
ALTER TABLE online_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON online_orders;
CREATE POLICY tenant_isolation ON online_orders
  USING ("organizationId" = current_setting('app.current_tenant', true)
         OR "buyerId" = current_setting('app.current_buyer', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true)
              OR "buyerId" = current_setting('app.current_buyer', true));

ALTER TABLE online_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON online_order_lines;
CREATE POLICY tenant_isolation ON online_order_lines
  USING (EXISTS (SELECT 1 FROM online_orders o WHERE o.id = online_order_lines."orderId"
                 AND (o."organizationId" = current_setting('app.current_tenant', true)
                      OR o."buyerId" = current_setting('app.current_buyer', true))))
  WITH CHECK (EXISTS (SELECT 1 FROM online_orders o WHERE o.id = online_order_lines."orderId"
                 AND (o."organizationId" = current_setting('app.current_tenant', true)
                      OR o."buyerId" = current_setting('app.current_buyer', true))));

-- Commission invoices: the business sees its own; a platform admin reads
-- and records payments across tenants one tenant at a time (set_config per
-- tenant), the same way it reads branches.
ALTER TABLE commission_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON commission_invoices;
CREATE POLICY tenant_isolation ON commission_invoices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- buyers / buyer_otps: deliberately NOT tenant-scoped, same reasoning as
-- `users` below - one buyer shops at many businesses with one login, and
-- an OTP is checked before any business is involved. The application
-- only ever reads a buyer row by the id in a verified buyer JWT or by the
-- phone number being verified (BuyerAuthService).

-- ── organizations itself ─────────────────────────────────────────────────
-- A tenant may only ever see its own organization row (not a child table,
-- so it filters on id directly rather than organizationId). Same pre-auth
-- exception as org_users above, for the same reason: login needs to resolve
-- organization name/id before a tenant is set.

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON organizations;
CREATE POLICY tenant_isolation ON organizations
  USING (
    id = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (id = current_setting('app.current_tenant', true));

-- ── users itself ──────────────────────────────────────────────────────────
-- Deliberately NOT tenant-scoped: a user account can belong to multiple
-- organizations (org_users is the join table, and IS tenant-scoped above).
-- The application layer restricts which user rows are readable per request
-- by only ever looking users up via an org_users row already filtered by
-- the policies above - never by scanning `users` directly with tenant trust.

-- ── platform billing tables ───────────────────────────────────────────────
-- plans: deliberately NO RLS policy - a global price list with no
-- organizationId, read by the public pricing endpoint and platform admin.
--
-- subscriptions / subscription_payments: platform-owned records, but each
-- row belongs to exactly one tenant, so they get the same shape of policy
-- as organizations above. Platform admin never sets app.current_tenant for
-- billing (recordPayment, setSuspension, the billing list), so the
-- "no tenant set" arm keeps its full access, for writes too - unlike
-- organizations, whose writes platform admin always makes with the tenant
-- set. What this adds is defence in depth: any transaction that HAS a
-- tenant set (every tenant-facing request, plus self-registration and
-- platform onboarding, which set it before creating the subscription) can
-- only see or write that tenant's own billing rows, instead of relying
-- solely on "no tenant-facing endpoint queries these".

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscriptions;
CREATE POLICY tenant_isolation ON subscriptions
  USING (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

ALTER TABLE subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON subscription_payments;
CREATE POLICY tenant_isolation ON subscription_payments
  USING (
    NULLIF(current_setting('app.current_tenant', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_payments."subscriptionId"
        AND s."organizationId" = current_setting('app.current_tenant', true)
    )
  )
  WITH CHECK (
    NULLIF(current_setting('app.current_tenant', true), '') IS NULL
    OR EXISTS (
      SELECT 1 FROM subscriptions s
      WHERE s.id = subscription_payments."subscriptionId"
        AND s."organizationId" = current_setting('app.current_tenant', true)
    )
  );

-- ── riders / rider_otps ───────────────────────────────────────────────────
-- Deliberately NO row-level security, same reason as buyers / buyer_otps: a rider
-- signs in once and works for many businesses, so there is no single tenant to scope
-- by. The access rules live in RidersService: a rider only ever reads or changes the
-- row of their own verified id; a business only the riders whose organizationId is its
-- own (plus, later, approved pool riders through a narrow view); a platform admin the
-- rest. Both tables are on rls-coverage.spec.ts's exclusion list.

-- ── Delivery jobs, quotes and contacts ────────────────────────────────────
-- Four parties touch these: the business (app.current_tenant), the buyer of the order
-- (app.current_buyer), and riders (app.current_rider, set only from a verified rider token,
-- see DeliveryRiderService). What each may see:
--   delivery_jobs      business: its own. Buyer: the job of their own order. Rider: the jobs
--                      assigned to them, plus OPEN jobs they are allowed to quote on (an
--                      approved rider; their own business's riders, or the shared pool when the
--                      job is open to everyone; or the one rider a business picked).
--   delivery_quotes    business: its own. Buyer: quotes on their own order's job. Rider: ONLY
--                      their own quotes - never a competitor's.
--   delivery_job_contacts  business: its own. Rider: only for the job assigned to them. The
--                      buyer's name, phone and address are never visible to a rider who has not
--                      been chosen. (The buyer already knows their own details.)
-- Only the business and the buyer may create or change jobs; a rider may change a job only
-- once it is assigned to them, and may only write quotes of their own on a job they can see.
ALTER TABLE delivery_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_jobs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON delivery_jobs;
CREATE POLICY tenant_isolation ON delivery_jobs
  USING ("organizationId" = current_setting('app.current_tenant', true)
         OR EXISTS (SELECT 1 FROM online_orders o WHERE o.id = delivery_jobs."orderId"
                    AND o."buyerId" = current_setting('app.current_buyer', true))
         OR "riderId" = current_setting('app.current_rider', true)
         OR (status = 'OPEN'
             AND EXISTS (SELECT 1 FROM riders r
                         WHERE r.id = current_setting('app.current_rider', true)
                           AND r.status = 'APPROVED'
                           AND ((audience = 'EVERYONE' AND (r."organizationId" IS NULL OR r."organizationId" = delivery_jobs."organizationId"))
                                OR (audience = 'SHOP_RIDERS' AND r."organizationId" = delivery_jobs."organizationId")
                                OR (audience = 'ONE_RIDER' AND delivery_jobs."targetRiderId" = r.id)))))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true)
              OR EXISTS (SELECT 1 FROM online_orders o WHERE o.id = delivery_jobs."orderId"
                         AND o."buyerId" = current_setting('app.current_buyer', true))
              OR "riderId" = current_setting('app.current_rider', true));

ALTER TABLE delivery_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON delivery_quotes;
CREATE POLICY tenant_isolation ON delivery_quotes
  USING ("organizationId" = current_setting('app.current_tenant', true)
         OR "riderId" = current_setting('app.current_rider', true)
         OR EXISTS (SELECT 1 FROM online_orders o JOIN delivery_jobs j ON j."orderId" = o.id
                    WHERE j.id = delivery_quotes."jobId"
                      AND o."buyerId" = current_setting('app.current_buyer', true)))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true)
              OR EXISTS (SELECT 1 FROM online_orders o JOIN delivery_jobs j ON j."orderId" = o.id
                         WHERE j.id = delivery_quotes."jobId"
                           AND o."buyerId" = current_setting('app.current_buyer', true))
              OR ("riderId" = current_setting('app.current_rider', true)
                  AND EXISTS (SELECT 1 FROM delivery_jobs j WHERE j.id = delivery_quotes."jobId" AND j.status = 'OPEN')));

ALTER TABLE delivery_job_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_job_contacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON delivery_job_contacts;
CREATE POLICY tenant_isolation ON delivery_job_contacts
  USING ("organizationId" = current_setting('app.current_tenant', true)
         OR EXISTS (SELECT 1 FROM delivery_jobs j WHERE j.id = delivery_job_contacts."jobId"
                    AND j."riderId" = current_setting('app.current_rider', true)
                    AND j.status IN ('ASSIGNED', 'PICKED_UP', 'DELIVERED')))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Marketing teams (sales_teams, sales_agents, sales_earnings, sales_payouts, sales_payout_settings) ───────────────────────────
-- Platform-level tables with no tenant, like riders: the platform owner manages teams and their
-- leaders; a leader manages their own team; a member sees only their own work. The rules live in
-- SalesTeamsService / SalesAgentService (every query there is scoped by the verified agent's team or
-- id), and both tables are on rls-coverage.spec.ts's exclusion list. A business's own row only gains
-- the nullable salesTeamId / salesAgentId columns, which its own RLS policy already covers.

-- ── Rental / property management module ───────────────────────────────────

ALTER TABLE rental_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_properties;
CREATE POLICY tenant_isolation ON rental_properties
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_units ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_units FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_units;
CREATE POLICY tenant_isolation ON rental_units
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_tenants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_tenants;
CREATE POLICY tenant_isolation ON rental_tenants
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_leases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_leases;
CREATE POLICY tenant_isolation ON rental_leases
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_invoices;
CREATE POLICY tenant_isolation ON rental_invoices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_payments;
CREATE POLICY tenant_isolation ON rental_payments
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_payment_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_payment_allocations;
CREATE POLICY tenant_isolation ON rental_payment_allocations
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_settings;
CREATE POLICY tenant_isolation ON rental_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_payment_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_payment_requests;
CREATE POLICY tenant_isolation ON rental_payment_requests
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_maintenance_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_maintenance_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_maintenance_requests;
CREATE POLICY tenant_isolation ON rental_maintenance_requests
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_expenses;
CREATE POLICY tenant_isolation ON rental_expenses
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_meter_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_meter_readings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_meter_readings;
CREATE POLICY tenant_isolation ON rental_meter_readings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_reminder_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_reminder_logs;
CREATE POLICY tenant_isolation ON rental_reminder_logs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_caretaker_properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_caretaker_properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_caretaker_properties;
CREATE POLICY tenant_isolation ON rental_caretaker_properties
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE rental_platform_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_platform_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_platform_invoices;
CREATE POLICY tenant_isolation ON rental_platform_invoices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Rental tenant sign-in (rental_tenant_otps + one extra rule on rental_tenants) ──
-- rental_tenant_otps has deliberately NO row-level security, like rider_otps: a sign-in
-- attempt has no business behind it yet (listed in rls-coverage.spec.ts's exclusions).
-- A tenant signs in by email and may rent from several landlords, so finding "my tenant
-- records" has to cross businesses. That is allowed ONLY through this extra, read-only
-- rule: it matches the rows whose email equals app.current_tenant_email, a setting the API
-- sets only from a verified tenant token (RentalTenantPortalService). It is added alongside
-- the normal tenant_isolation rule (rules are OR-ed), never instead of it. Everything else
-- the tenant sees (leases, invoices, payments) is then read inside the owning business's
-- own context, filtered to that tenant record.
DROP POLICY IF EXISTS tenant_email_access ON rental_tenants;
CREATE POLICY tenant_email_access ON rental_tenants
  FOR SELECT
  USING (email IS NOT NULL AND lower(email) = current_setting('app.current_tenant_email', true));

-- The same read-only rule for a tenant who signs in by text message: matches the rows whose normalized phone equals
-- app.current_tenant_phone, set only from a verified tenant token. Alongside tenant_isolation, never instead of it.
DROP POLICY IF EXISTS tenant_phone_access ON rental_tenants;
CREATE POLICY tenant_phone_access ON rental_tenants
  FOR SELECT
  USING ("phoneNormalized" IS NOT NULL AND "phoneNormalized" = current_setting('app.current_tenant_phone', true));

-- ── Houses to let (rental adverts) ─────────────────────────────────────────
-- A landlord's advert for a vacant unit, plus its photos. Tenant-isolated like every rental table, with ONE
-- deliberate, narrow public exception: the public "Houses to let" pages list adverts across all landlords, so a
-- request opts in with set_config('app.public_listings', 'on', true) (only PublicHousesService does) and then sees
-- only adverts that are switched on AND paid for (paidUntil in the future). SELECT only -
-- permissive policies OR together, so this never widens what can be written. The advert carries its own area,
-- rent and contact details, so no unit, property or tenant row is ever readable through it.
ALTER TABLE rental_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_listings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_listings;
CREATE POLICY tenant_isolation ON rental_listings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

DROP POLICY IF EXISTS public_listings_read ON rental_listings;
CREATE POLICY public_listings_read ON rental_listings
  FOR SELECT
  USING (current_setting('app.public_listings', true) = 'on'
         AND "isActive" AND "blockedAt" IS NULL AND "paidUntil" > now());

ALTER TABLE rental_listing_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_listing_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_listing_photos;
CREATE POLICY tenant_isolation ON rental_listing_photos
  USING (EXISTS (SELECT 1 FROM rental_listings l WHERE l.id = rental_listing_photos."listingId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM rental_listings l WHERE l.id = rental_listing_photos."listingId"
                 AND l."organizationId" = current_setting('app.current_tenant', true)));

-- Photos of an advert the public may see (the subquery is itself subject to the policy above).
DROP POLICY IF EXISTS public_listings_read ON rental_listing_photos;
CREATE POLICY public_listings_read ON rental_listing_photos
  FOR SELECT
  USING (current_setting('app.public_listings', true) = 'on'
         AND EXISTS (SELECT 1 FROM rental_listings l WHERE l.id = rental_listing_photos."listingId"));

-- A landlord's KES 100 advert payments (to ZARODA's Tuma account). Tenant-isolated; the public never reads them.
-- Tuma's callback arrives with no signed-in user and sets app.current_tenant from the organisation id in its
-- HMAC-protected URL, like the rental invoice callback.
ALTER TABLE rental_listing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE rental_listing_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON rental_listing_payments;
CREATE POLICY tenant_isolation ON rental_listing_payments
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Which kitchen station prepares each dish (used for orders from a table QR code). Tenant-isolated like every restaurant table.
ALTER TABLE restaurant_dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_dishes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_dishes;
CREATE POLICY tenant_isolation ON restaurant_dishes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Hotel rooms ──────────────────────────────────────────────────────────────
-- Room types, their photos and bookings are ordinary tenant-isolated tables. The public Hotels pages and a guest's
-- booking page read them inside that business's own tenant context (resolved from the shop's public link, or from the
-- organisation id inside the guest's secret), so no public exception is needed.
ALTER TABLE hotel_room_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_room_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_room_types;
CREATE POLICY tenant_isolation ON hotel_room_types
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_room_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_room_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_room_photos;
CREATE POLICY tenant_isolation ON hotel_room_photos
  USING (EXISTS (SELECT 1 FROM hotel_room_types t WHERE t.id = hotel_room_photos."roomTypeId"
                 AND t."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM hotel_room_types t WHERE t.id = hotel_room_photos."roomTypeId"
                 AND t."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE room_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON room_bookings;
CREATE POLICY tenant_isolation ON room_bookings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Table reservations: tenant-isolated like every restaurant table. The marketplace form and a guest's own page read and
-- write them inside the restaurant's own tenant context (found from the shop's public link, or from the organisation id inside
-- the guest's secret), so no public exception is needed.
ALTER TABLE table_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_reservations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON table_reservations;
CREATE POLICY tenant_isolation ON table_reservations
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── expenses: money the business spent that is not stock ──────────────────
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON expenses;
CREATE POLICY tenant_isolation ON expenses
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── School suppliers: schools, orders, invoices, payments, document numbers ─────────────────
ALTER TABLE school_portals ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_portals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_portals;
CREATE POLICY tenant_isolation ON school_portals
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- The school portal address ("/schools/<slug>") must be found before any business is known: a request opts in with
-- set_config('app.public_school_portal', 'on', true) and then sees only portals that are switched on. SELECT only.
DROP POLICY IF EXISTS public_school_portal_read ON school_portals;
CREATE POLICY public_school_portal_read ON school_portals
  FOR SELECT
  USING (current_setting('app.public_school_portal', true) = 'on' AND enabled);

ALTER TABLE supplier_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_schools FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_schools;
CREATE POLICY tenant_isolation ON supplier_schools
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_orders;
CREATE POLICY tenant_isolation ON school_orders
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE supplier_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_invoices;
CREATE POLICY tenant_isolation ON supplier_invoices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE supplier_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_payments;
CREATE POLICY tenant_isolation ON supplier_payments
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE document_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_counters FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON document_counters;
CREATE POLICY tenant_isolation ON document_counters
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_order_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_order_lines;
CREATE POLICY tenant_isolation ON school_order_lines
  USING (EXISTS (SELECT 1 FROM school_orders p WHERE p.id = school_order_lines."orderId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_orders p WHERE p.id = school_order_lines."orderId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE supplier_invoice_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_invoice_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_invoice_lines;
CREATE POLICY tenant_isolation ON supplier_invoice_lines
  USING (EXISTS (SELECT 1 FROM supplier_invoices p WHERE p.id = supplier_invoice_lines."invoiceId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_invoices p WHERE p.id = supplier_invoice_lines."invoiceId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE supplier_payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_payment_allocations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_payment_allocations;
CREATE POLICY tenant_isolation ON supplier_payment_allocations
  USING (EXISTS (SELECT 1 FROM supplier_payments p WHERE p.id = supplier_payment_allocations."paymentId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_payments p WHERE p.id = supplier_payment_allocations."paymentId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Restaurant open tabs: running bills per table, settings ─────────────────

ALTER TABLE restaurant_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tabs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_tabs;
CREATE POLICY tenant_isolation ON restaurant_tabs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE restaurant_tab_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tab_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_tab_lines;
CREATE POLICY tenant_isolation ON restaurant_tab_lines
  USING (EXISTS (SELECT 1 FROM restaurant_tabs p WHERE p.id = restaurant_tab_lines."tabId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM restaurant_tabs p WHERE p.id = restaurant_tab_lines."tabId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE restaurant_tab_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tab_sales FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_tab_sales;
CREATE POLICY tenant_isolation ON restaurant_tab_sales
  USING (EXISTS (SELECT 1 FROM restaurant_tabs p WHERE p.id = restaurant_tab_sales."tabId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM restaurant_tabs p WHERE p.id = restaurant_tab_sales."tabId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE restaurant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON restaurant_settings;
CREATE POLICY tenant_isolation ON restaurant_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Hotel front desk: rooms, assignments, folios ────────────────────────────

ALTER TABLE hotel_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_rooms FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_rooms;
CREATE POLICY tenant_isolation ON hotel_rooms
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_folios ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_folios FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_folios;
CREATE POLICY tenant_isolation ON hotel_folios
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_folio_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_folio_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_folio_entries;
CREATE POLICY tenant_isolation ON hotel_folio_entries
  USING (EXISTS (SELECT 1 FROM hotel_folios p WHERE p.id = hotel_folio_entries."folioId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM hotel_folios p WHERE p.id = hotel_folio_entries."folioId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE hotel_room_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_room_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_room_assignments;
CREATE POLICY tenant_isolation ON hotel_room_assignments
  USING (EXISTS (SELECT 1 FROM room_bookings p WHERE p.id = hotel_room_assignments."bookingId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM room_bookings p WHERE p.id = hotel_room_assignments."bookingId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- ── Hotel operations: settings, taxes, rates, guests, night audits, messages ─────

ALTER TABLE hotel_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_settings;
CREATE POLICY tenant_isolation ON hotel_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_taxes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_taxes;
CREATE POLICY tenant_isolation ON hotel_taxes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_rate_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_rate_cards;
CREATE POLICY tenant_isolation ON hotel_rate_cards
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_seasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_seasons;
CREATE POLICY tenant_isolation ON hotel_seasons
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_meal_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_meal_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_meal_prices;
CREATE POLICY tenant_isolation ON hotel_meal_prices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_guests ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_guests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_guests;
CREATE POLICY tenant_isolation ON hotel_guests
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_night_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_night_audits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_night_audits;
CREATE POLICY tenant_isolation ON hotel_night_audits
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE hotel_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE hotel_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON hotel_notifications;
CREATE POLICY tenant_isolation ON hotel_notifications
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Receiving stock and paying suppliers
ALTER TABLE goods_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON goods_receipts;
CREATE POLICY tenant_isolation ON goods_receipts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE goods_receipt_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipt_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON goods_receipt_lines;
CREATE POLICY tenant_isolation ON goods_receipt_lines
  USING (EXISTS (SELECT 1 FROM goods_receipts r WHERE r.id = goods_receipt_lines."receiptId" AND r."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM goods_receipts r WHERE r.id = goods_receipt_lines."receiptId" AND r."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE supplier_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_bills FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_bills;
CREATE POLICY tenant_isolation ON supplier_bills
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE supplier_bill_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_bill_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_bill_payments;
CREATE POLICY tenant_isolation ON supplier_bill_payments
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Supplier credit notes
ALTER TABLE supplier_bill_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_bill_credits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_bill_credits;
CREATE POLICY tenant_isolation ON supplier_bill_credits
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- KRA eTIMS: the business's switch and its devices (the code lists are KRA's own data, shared, and have no tenant)
ALTER TABLE etims_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_settings;
CREATE POLICY tenant_isolation ON etims_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE etims_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_devices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_devices;
CREATE POLICY tenant_isolation ON etims_devices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- KRA eTIMS: how each product option is known to KRA
ALTER TABLE etims_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_items;
CREATE POLICY tenant_isolation ON etims_items
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- KRA eTIMS: sales and credit notes on their way to KRA
ALTER TABLE etims_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_documents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_documents;
CREATE POLICY tenant_isolation ON etims_documents
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- School supplier: each drop of goods to a school, and what was in it
ALTER TABLE school_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_deliveries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_deliveries;
CREATE POLICY tenant_isolation ON school_deliveries
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_delivery_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_delivery_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_delivery_lines;
CREATE POLICY tenant_isolation ON school_delivery_lines
  USING (EXISTS (SELECT 1 FROM school_deliveries p WHERE p.id = school_delivery_lines."deliveryId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_deliveries p WHERE p.id = school_delivery_lines."deliveryId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- School supplier: credit notes to schools
ALTER TABLE supplier_credit_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_credit_notes;
CREATE POLICY tenant_isolation ON supplier_credit_notes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE supplier_credit_note_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_credit_note_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_credit_note_lines;
CREATE POLICY tenant_isolation ON supplier_credit_note_lines
  USING (EXISTS (SELECT 1 FROM supplier_credit_notes p WHERE p.id = supplier_credit_note_lines."creditNoteId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM supplier_credit_notes p WHERE p.id = supplier_credit_note_lines."creditNoteId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- School supplier: quotations to schools
ALTER TABLE school_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_quotes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_quotes;
CREATE POLICY tenant_isolation ON school_quotes
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_quote_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_quote_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_quote_lines;
CREATE POLICY tenant_isolation ON school_quote_lines
  USING (EXISTS (SELECT 1 FROM school_quotes p WHERE p.id = school_quote_lines."quoteId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_quotes p WHERE p.id = school_quote_lines."quoteId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- School supplier: tenders and contracts
ALTER TABLE school_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_tenders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_tenders;
CREATE POLICY tenant_isolation ON school_tenders
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_tender_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_tender_checks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_tender_checks;
CREATE POLICY tenant_isolation ON school_tender_checks
  USING (EXISTS (SELECT 1 FROM school_tenders p WHERE p.id = school_tender_checks."tenderId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_tenders p WHERE p.id = school_tender_checks."tenderId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE school_tender_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_tender_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_tender_lines;
CREATE POLICY tenant_isolation ON school_tender_lines
  USING (EXISTS (SELECT 1 FROM school_tenders p WHERE p.id = school_tender_lines."tenderId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_tenders p WHERE p.id = school_tender_lines."tenderId" AND p."organizationId" = current_setting('app.current_tenant', true)));

ALTER TABLE school_compliance_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_compliance_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_compliance_docs;
CREATE POLICY tenant_isolation ON school_compliance_docs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_contracts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_contracts;
CREATE POLICY tenant_isolation ON school_contracts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_contract_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_contract_variations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_contract_variations;
CREATE POLICY tenant_isolation ON school_contract_variations
  USING (EXISTS (SELECT 1 FROM school_contracts p WHERE p.id = school_contract_variations."contractId" AND p."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM school_contracts p WHERE p.id = school_contract_variations."contractId" AND p."organizationId" = current_setting('app.current_tenant', true)));

-- School supplier: what happened to the retention held on an invoice
ALTER TABLE supplier_retention_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_retention_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON supplier_retention_events;
CREATE POLICY tenant_isolation ON supplier_retention_events
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- School supplier: bad-debt rules, write-offs and the recorded provision
ALTER TABLE school_bad_debt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_bad_debt_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_bad_debt_settings;
CREATE POLICY tenant_isolation ON school_bad_debt_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_write_offs ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_write_offs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_write_offs;
CREATE POLICY tenant_isolation ON school_write_offs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_provision_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_provision_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_provision_entries;
CREATE POLICY tenant_isolation ON school_provision_entries
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- School supplier: cash-flow forecast settings and planned items
ALTER TABLE school_cashflow_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_cashflow_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_cashflow_settings;
CREATE POLICY tenant_isolation ON school_cashflow_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE school_cashflow_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_cashflow_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_cashflow_items;
CREATE POLICY tenant_isolation ON school_cashflow_items
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ── Tender adverts ────────────────────────────────────────────────────────
-- tender_buyers / tender_adverts: deliberately NO row-level security, same reason as buyers and riders: a school
-- posts adverts for every school-supplier business to see, so there is no single tenant to scope by. The access
-- rules live in the services: a school only ever reads or changes its own account and adverts (by the id in its
-- verified token); suppliers read open adverts only through SchoolTenderBoardService; the platform admin the rest.
-- Both tables are on rls-coverage.spec.ts's exclusion list.
--
-- school_tender_notices: what each supplier did with an advert - its own, like any tenant table.
ALTER TABLE school_tender_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE school_tender_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON school_tender_notices;
CREATE POLICY tenant_isolation ON school_tender_notices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- eTIMS: Z reports and the count of receipt copies
ALTER TABLE etims_z_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_z_reports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_z_reports;
CREATE POLICY tenant_isolation ON etims_z_reports
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE etims_receipt_prints ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_receipt_prints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_receipt_prints;
CREATE POLICY tenant_isolation ON etims_receipt_prints
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- eTIMS: KRA notices and imported items
ALTER TABLE etims_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_notices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_notices;
CREATE POLICY tenant_isolation ON etims_notices
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE etims_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE etims_imports FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON etims_imports;
CREATE POLICY tenant_isolation ON etims_imports
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Accounting: chart of accounts, journals, ledger settings and postings
ALTER TABLE ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_accounts;
CREATE POLICY tenant_isolation ON ledger_accounts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE ledger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_settings;
CREATE POLICY tenant_isolation ON ledger_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journal_entries;
CREATE POLICY tenant_isolation ON journal_entries
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON journal_lines;
CREATE POLICY tenant_isolation ON journal_lines
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE ledger_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE ledger_postings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ledger_postings;
CREATE POLICY tenant_isolation ON ledger_postings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- ZARODA's own books (platform_ledger_* / platform_journal_*): no organizationId. Readable and writable only when NO tenant is set
-- (the platform admin and the platform posting pass), so no tenant-facing request can ever see ZARODA's accounts.
ALTER TABLE platform_ledger_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ledger_accounts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_ledger_accounts;
CREATE POLICY tenant_isolation ON platform_ledger_accounts
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NULL);

ALTER TABLE platform_ledger_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ledger_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_ledger_settings;
CREATE POLICY tenant_isolation ON platform_ledger_settings
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NULL);

ALTER TABLE platform_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_journal_entries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_journal_entries;
CREATE POLICY tenant_isolation ON platform_journal_entries
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NULL);

ALTER TABLE platform_journal_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_journal_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_journal_lines;
CREATE POLICY tenant_isolation ON platform_journal_lines
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NULL);

ALTER TABLE platform_ledger_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_ledger_postings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON platform_ledger_postings;
CREATE POLICY tenant_isolation ON platform_ledger_postings
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NULL);

-- ── Construction (con_*) ──────────────────────────────────────────────────
-- con_plans / con_coupons: deliberately NO RLS policy - a global price list and discount codes with no organizationId, like plans.
-- con_subscriptions / con_subscription_payments: same shape as subscriptions - the tenant itself, or no tenant set (platform admin billing).

ALTER TABLE con_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_subscriptions;
CREATE POLICY tenant_isolation ON con_subscriptions
  USING (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

ALTER TABLE con_subscription_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_subscription_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_subscription_payments;
CREATE POLICY tenant_isolation ON con_subscription_payments
  USING (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  )
  WITH CHECK (
    "organizationId" = current_setting('app.current_tenant', true)
    OR NULLIF(current_setting('app.current_tenant', true), '') IS NULL
  );

ALTER TABLE con_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_roles;
CREATE POLICY tenant_isolation ON con_roles
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_user_roles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_user_roles;
CREATE POLICY tenant_isolation ON con_user_roles
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_project_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_project_members;
CREATE POLICY tenant_isolation ON con_project_members
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_company_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_company_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_company_registrations;
CREATE POLICY tenant_isolation ON con_company_registrations
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_compliance_docs ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_compliance_docs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_compliance_docs;
CREATE POLICY tenant_isolation ON con_compliance_docs
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_category_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_category_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_category_limits;
CREATE POLICY tenant_isolation ON con_category_limits
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_tax_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_tax_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_tax_settings;
CREATE POLICY tenant_isolation ON con_tax_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_alerts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_alerts;
CREATE POLICY tenant_isolation ON con_alerts
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Construction C2

ALTER TABLE con_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_settings;
CREATE POLICY tenant_isolation ON con_settings
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_staff_accreditations ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_staff_accreditations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_staff_accreditations;
CREATE POLICY tenant_isolation ON con_staff_accreditations
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_parties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_parties;
CREATE POLICY tenant_isolation ON con_parties
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_tenders ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_tenders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_tenders;
CREATE POLICY tenant_isolation ON con_tenders
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_projects FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_projects;
CREATE POLICY tenant_isolation ON con_projects
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_project_parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_project_parties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_project_parties;
CREATE POLICY tenant_isolation ON con_project_parties
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_project_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_project_permits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_project_permits;
CREATE POLICY tenant_isolation ON con_project_permits
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_milestones FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_milestones;
CREATE POLICY tenant_isolation ON con_milestones
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_bq_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_bq_sections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_bq_sections;
CREATE POLICY tenant_isolation ON con_bq_sections
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_bq_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_bq_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_bq_items;
CREATE POLICY tenant_isolation ON con_bq_items
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

-- Construction C3

ALTER TABLE con_site_diaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_site_diaries FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_site_diaries;
CREATE POLICY tenant_isolation ON con_site_diaries
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_site_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_site_photos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_site_photos;
CREATE POLICY tenant_isolation ON con_site_photos
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_site_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_site_instructions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_site_instructions;
CREATE POLICY tenant_isolation ON con_site_instructions
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_workers FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_workers;
CREATE POLICY tenant_isolation ON con_workers
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_muster ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_muster FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_muster;
CREATE POLICY tenant_isolation ON con_muster
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_toolbox_talks ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_toolbox_talks FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_toolbox_talks;
CREATE POLICY tenant_isolation ON con_toolbox_talks
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_ppe_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_ppe_issues FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_ppe_issues;
CREATE POLICY tenant_isolation ON con_ppe_issues
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_permits_to_work ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_permits_to_work FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_permits_to_work;
CREATE POLICY tenant_isolation ON con_permits_to_work
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));

ALTER TABLE con_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE con_incidents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON con_incidents;
CREATE POLICY tenant_isolation ON con_incidents
  USING ("organizationId" = current_setting('app.current_tenant', true))
  WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
