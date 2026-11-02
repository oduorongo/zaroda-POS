
---

## Construction Module (business type: CONSTRUCTION)

Specs live in `docs/construction/`. Read the relevant spec file before every task in this module.
Phase prompts live in `prompts/construction/`.

### Rules
- Construction is a **business type plugin** on top of the existing multi-tenant POS core. Reuse existing
  tenants, auth, users, products/inventory, suppliers, M-Pesa (Daraja), eTIMS and receipts. Do NOT fork them.
- All construction tables are prefixed `con_` and every row carries `tenantId`. Every query is tenant-scoped.
- Construction menus/routes only appear when `tenant.businessType = CONSTRUCTION` (or the construction feature flag is on).
- Permissions are checked server-side via guards/decorators, never only hidden in the UI.
- Money is stored as integer cents (or `numeric(14,2)`), currency KES. Never floats.
- Rates that the law can change (VAT, withholding tax, NCA levy, SHIF, Housing Levy, NSSF, retention %) live in
  `con_tax_settings` / tenant settings with an effective date. Never hard-code them.
- Every create/update/approve/delete on commercial or compliance records writes to the audit log (who, what, when, before/after).
- Approved valuations, certificates and payments are immutable: corrections are new reversing records.
- Documents (certificates, permits, drawings, photos) go to object storage with `expiresAt` where applicable;
  expiry alerts at 60/30/7 days.
- Code style: short, minimal working versions; no unnecessary comments.
- Brand: navy #1a2e5a, gold #d4af37, orange #f5820a. Mobile-first for site screens (supervisors use phones).
- Plans, limits and features come from `con_plans` (docs/construction/05-pricing-plans.md). Gate features with
  `@ConFeature()` and limits server-side; show an upgrade prompt, never a silent failure. External portal users are free.
- Construction is served at `CONSTRUCTION_DOMAIN` (build.zarodasolutions.app) via host-based middleware — see
  docs/construction/06-domain-routing.md. Never hard-code domains; construction links always use `CONSTRUCTION_DOMAIN`.
- Finish every phase with: migration, seed data for the demo tenant "Uriri Builders Ltd", and a short CHANGELOG entry.
