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
