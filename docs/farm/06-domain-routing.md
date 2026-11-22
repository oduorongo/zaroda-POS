# 06 — Zaroda Shamba: Domain Routing

Zaroda Shamba is served from its own address, from the SAME codebase and API as the POS (as Build and Rentals are).

| Domain | Serves |
|---|---|
| `zarodashop.com` / `app.zarodashop.com` | POS (retail and other business types) |
| `build.zarodasolutions.app` | Zaroda Build (`CONSTRUCTION`) |
| `rentals.zarodasolutions.app` | ZARODA RENTALS (`RENTAL`) |
| `shamba.zarodasolutions.app` | Zaroda Shamba (`FARM`) |

The address comes from env, never hard-coded: `SHAMBA_DOMAIN` (and `NEXT_PUBLIC_SHAMBA_DOMAIN` in the back office).

## Rules
- The back office `middleware.ts` adds the product `SHAMBA`: on `SHAMBA_DOMAIN`, `/`, `/login`, `/signup`, `/pricing`
  and `/guide` show Shamba's own pages (`/shamba/welcome`, `/shamba/login`...), and signed-in farms land on `/shamba`.
- Signup there always creates `industryType = 'FARM'` and starts the Shamba trial.
- A FARM business signing in on the POS address is sent to `SHAMBA_DOMAIN`; a non-farm business signing in on Shamba
  gets a link to the POS.
- Sessions are per address (no cross-domain sign-in).
- API: add `https://shamba.zarodasolutions.app` to `CORS_ORIGIN` on Render.
- Emails, SMS, PDFs and payment pages for farms use `SHAMBA_DOMAIN`.
- `localhost`: `?product=shamba` switches to Shamba for testing.

## Manual setup (done by the owner)
1. Vercel → back office project → Settings → Domains → add `shamba.zarodasolutions.app`.
2. name.com DNS for `zarodasolutions.app` → CNAME `shamba` → the value Vercel shows.
3. Vercel env: `SHAMBA_DOMAIN=shamba.zarodasolutions.app` and `NEXT_PUBLIC_SHAMBA_DOMAIN` (same), then Redeploy the
   live deployment (Vercel skips back-office builds without code changes).
4. Render env: add the address to `CORS_ORIGIN`; set `SHAMBA_DOMAIN`.
