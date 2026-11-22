# F1 — Zaroda Shamba Foundation

Read docs/farm/00-plan.md, 05-pricing-plans.md, 06-domain-routing.md and 02-roles-permissions.md first. Mirror Zaroda
Build's foundation (apps/api/src/construction/common, construction/plans, backoffice middleware + /construction pages).

Build:
1. `industryType = 'FARM'`; a `FarmModule` with a manifest and a `FarmGuard` that refuses non-farm organisations.
2. `farm_plans` (seeded from 05-pricing-plans.md), `farm_subscriptions`, trial on signup, `@FarmFeature()` and limit
   checks (head, birds, acres, users) with upgrade messages; platform-admin can edit plans and record payments.
3. `farm_settings`, `farm_units` (layout tree with acres), `farm_enterprises`, `farm_user_roles` + `@FarmRoles()`.
4. SHAMBA_DOMAIN routing: middleware product SHAMBA, `/shamba/welcome`, `/shamba/pricing`, `/shamba/login`,
   `/shamba/signup`, `/shamba/guide`, signed-in home `/shamba` (dashboard), farm nav; Shamba pages use the ZARODA
   brand colours only (navy #0f1f45, gold #d4af37, orange #f5820a) - never green for branding.
5. Sales teams can onboard farms (team app business type list) and earn at the usual rates.
6. Migration, rls.sql (FORCE RLS on every farm_ table), seed demo farm "Uriri Dairy & Poultry Farm", tests, CHANGELOG.
