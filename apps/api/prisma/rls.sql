-- ZARODA POS — Row-Level Security policies.
--
-- Prisma has no RLS DSL, so this file is applied separately from
-- `prisma migrate dev` (see prisma/README.md for the run order). It is the
-- actual tenant-isolation boundary described in DESIGN.md §2 — a bug in an
-- application query's WHERE clause cannot leak another tenant's rows,
-- because Postgres itself refuses to return them.
--
-- Convention: every tenant-owned table gets `ENABLE ROW LEVEL SECURITY`
-- plus a `USING` policy scoping SELECT/UPDATE/DELETE, and a `WITH CHECK`
-- policy on the same clause scoping INSERT/UPDATE. Tables that carry
-- organization_id directly filter on it; tables that only carry a foreign
-- key to an org-scoped parent filter via an EXISTS subquery through that
-- parent, so isolation holds even at the line-item/payment level.
--
-- The API's request-scoped interceptor issues:
--   SET LOCAL app.current_tenant = '<organization-id>';
-- at the start of every transaction (see src/common/tenant-context). Internal
-- admin tooling connects as a separate Postgres role with BYPASSRLS and never
-- serves tenant-facing requests.

-- ── Direct organization_id ──────────────────────────────────────────────

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON branches
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

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
CREATE POLICY tenant_isolation ON org_users
  USING (
    organization_id = current_setting('app.current_tenant', true)::uuid
    OR current_setting('app.current_tenant', true) IS NULL
  )
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON categories
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE tax_classes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tax_classes
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON products
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sales
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  USING (organization_id = current_setting('app.current_tenant', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_tenant', true)::uuid);

-- ── Scoped via branch_id -> branches.organization_id ────────────────────

ALTER TABLE terminals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON terminals
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = terminals.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = terminals.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_items
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_items.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_items.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shifts
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = shifts.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = shifts.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inventory_transactions
  USING (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_transactions.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM branches b WHERE b.id = inventory_transactions.branch_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

-- ── Scoped via terminal_id -> branches.organization_id ──────────────────

ALTER TABLE cashier_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cashier_sessions
  USING (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t.branch_id
                 WHERE t.id = cashier_sessions.terminal_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t.branch_id
                 WHERE t.id = cashier_sessions.terminal_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE sync_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sync_outbox
  USING (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t.branch_id
                 WHERE t.id = sync_outbox.terminal_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM terminals t JOIN branches b ON b.id = t.branch_id
                 WHERE t.id = sync_outbox.terminal_id
                 AND b.organization_id = current_setting('app.current_tenant', true)::uuid));

-- ── Scoped via product_id -> products.organization_id ───────────────────

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_variants
  USING (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id
                 AND p.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM products p WHERE p.id = product_variants.product_id
                 AND p.organization_id = current_setting('app.current_tenant', true)::uuid));

-- ── Scoped via variant_id -> products.organization_id ────────────────────

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON batches
  USING (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
                 WHERE v.id = batches.variant_id
                 AND p.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM product_variants v JOIN products p ON p.id = v.product_id
                 WHERE v.id = batches.variant_id
                 AND p.organization_id = current_setting('app.current_tenant', true)::uuid));

-- ── Scoped via sale_id -> sales.organization_id ──────────────────────────

ALTER TABLE sale_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_line_items
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_line_items.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_line_items.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sale_payments
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON discounts
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = discounts.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = discounts.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid));

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refunds
  USING (EXISTS (SELECT 1 FROM sales s WHERE s.id = refunds.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = refunds.sale_id
                 AND s.organization_id = current_setting('app.current_tenant', true)::uuid));

-- ── organizations itself ─────────────────────────────────────────────────
-- A tenant may only ever see its own organization row (not a child table,
-- so it filters on id directly rather than organization_id).

-- Same pre-auth exception as org_users above, and for the same reason:
-- login needs to resolve organization name/id before a tenant is set.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organizations
  USING (
    id = current_setting('app.current_tenant', true)::uuid
    OR current_setting('app.current_tenant', true) IS NULL
  )
  WITH CHECK (id = current_setting('app.current_tenant', true)::uuid);

-- ── users itself ──────────────────────────────────────────────────────────
-- Deliberately NOT tenant-scoped: a user account can belong to multiple
-- organizations (org_users is the join table, and IS tenant-scoped above).
-- The application layer restricts which user rows are readable per request
-- by only ever looking users up via an org_users row already filtered by
-- the policies above - never by scanning `users` directly with tenant trust.
