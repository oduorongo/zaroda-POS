# C1 — Foundation: business type, roles, settings, compliance vault

Follow docs/construction/00-plan.md, 02-roles-permissions.md, 03-data-model.md (Compliance section), 04-compliance-kenya.md.
Build:
1. `CONSTRUCTION` business type + feature flag; construction sidebar only for those tenants.
2. All roles in 02 as seed data; `@ConRoles()` decorator, `ConProjectGuard`, approval-limit setting per role.
3. Tables: con_company_registrations, con_compliance_docs, con_category_limits (seeded caps), con_tax_settings (seeded, effective dates).
4. Compliance Vault screens: upload doc, list with expiry badges (green/amber/red), daily job sending expiry alerts at 60/30/7 days (in-app + SMS/email if already supported).
5. Construction dashboard with "Compliance health" card.
6. Plans & subscriptions per 05-pricing-plans.md: con_plans (seeded), con_subscriptions, con_coupons, `@ConFeature()` guard, limit checks helper, 14-day trial on signup, upgrade card component, M-Pesa payment extends period, GRACE/SUSPENDED read-only mode, super-admin plan editor.
7. Domain routing per 06-domain-routing.md: host middleware, construction landing/pricing/login/signup, cross-domain redirects, separate cookies, CORS, env vars, dev `?product=construction`.
8. Audit-log every create/update/delete in this phase.
Finish: migration, seed demo tenant "Uriri Builders Ltd" (NCA5 Building, NCA6 Roads) on the Contractor plan, CHANGELOG entry. Tell me how to test it.
