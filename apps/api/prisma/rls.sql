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

-- ── Scoped via saleId -> sales."organizationId" ────────────────────────────

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_tickets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_tickets;
CREATE POLICY tenant_isolation ON kitchen_tickets
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = kitchen_tickets."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = kitchen_tickets."saleId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

-- ── Scoped via ticketId -> kitchen_tickets.saleId -> sales."organizationId" ─

ALTER TABLE kitchen_ticket_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE kitchen_ticket_lines FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON kitchen_ticket_lines;
CREATE POLICY tenant_isolation ON kitchen_ticket_lines
  USING (EXISTS (SELECT 1 FROM kitchen_tickets kt JOIN sales s ON s.id = kt."saleId"
                 WHERE kt.id = kitchen_ticket_lines."ticketId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)))
  WITH CHECK (EXISTS (SELECT 1 FROM kitchen_tickets kt JOIN sales s ON s.id = kt."saleId"
                 WHERE kt.id = kitchen_ticket_lines."ticketId"
                 AND s."organizationId" = current_setting('app.current_tenant', true)));

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
