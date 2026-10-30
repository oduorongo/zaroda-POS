# 06 — Domain Routing

Construction is served from its own domain, from the SAME codebase and backend as the POS.

| Domain | Serves |
|---|---|
| `zarodashop.com` | POS (retail and other business types) |
| `build.zarodasolutions.app` | Construction (`businessType = CONSTRUCTION`) |

Domains come from env vars, never hard-coded: `POS_DOMAIN`, `CONSTRUCTION_DOMAIN`.
Changing the subdomain later (e.g. `jenga.`) or moving to a new domain must only need an env change.

## Rules
- Next.js `middleware.ts` reads the `host` header and sets a `product` context (`POS` | `CONSTRUCTION`).
- On `CONSTRUCTION_DOMAIN`:
  - Landing page, pricing (05-pricing-plans.md), login and signup use construction branding and copy.
  - Signup always creates tenants with `businessType = CONSTRUCTION` and starts the construction trial.
  - Only construction tenants can log in; others get a link to `POS_DOMAIN`.
- On `POS_DOMAIN`: a construction tenant logging in is redirected to `CONSTRUCTION_DOMAIN`.
- The two domains are different sites, so login cookies are NOT shared. Each domain keeps its own session cookie
  (`Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain` attribute). Do not attempt cross-domain SSO in v1.
- Backend (NestJS on Railway): add `https://build.zarodasolutions.app` to CORS allowed origins; same API URL.
- Emails, SMS, PDFs, M-Pesa callback pages and portal invite links for construction tenants use `CONSTRUCTION_DOMAIN`.
- `.app` domains are HTTPS-only; never generate `http://` links.
- `localhost` dev: allow `?product=construction` query param (dev only) to simulate the construction domain.

## Manual setup (done by the owner, not Claude Code)
1. Vercel → POS project → Settings → Domains → add `build.zarodasolutions.app`.
2. DNS for `zarodasolutions.app` → add the CNAME record Vercel shows (name `build`).
3. Vercel and Railway env vars: set `POS_DOMAIN` and `CONSTRUCTION_DOMAIN`.
