# ZARODA RENTALS: its own domain

The rentals (landlord / tenant management) module is sold as **ZARODA RENTALS** on its own site, from the SAME codebase and backend
as the POS, the same way Construction is (docs/construction/06-domain-routing.md).

| Domain | Serves |
|---|---|
| `zarodashop.com` (and `app.zarodashop.com`) | POS back office; the marketing site advertises ZARODA RENTALS |
| `rentals.zarodasolutions.app` | ZARODA RENTALS (`industryType = RENTAL`) |
| `build.zarodasolutions.app` | Construction |

Domains come from env vars only. Changing the subdomain later needs only an env change.

## What happens where
- On `RENTALS_DOMAIN`, `/` is the ZARODA RENTALS landing page, and `/pricing`, `/login` and `/signup` are its own (`apps/backoffice/app/rentals/welcome|pricing|login|signup`). The landlord's screens are `/rentals` as before, under the ZARODA RENTALS top bar.
- Signup there always creates a RENTAL business on the free Bure plan. Only landlords and their caretakers can sign in there; anyone else gets a link to the POS back office.
- On the POS domain, a landlord who signs in is sent to `RENTALS_DOMAIN` to sign in there, and any `/rentals...` address moves to the same path on `RENTALS_DOMAIN`. Sessions are per site (no shared sign-in).
- Emails to landlords about their ZARODA invoice link to `https://RENTALS_DOMAIN/rentals`.
- The marketing site (zarodashop.com) shows a ZARODA RENTALS section on the home and industries pages and a footer link, all to `NEXT_PUBLIC_RENTALS_URL`; a landlord signing up on zarodashop.com is handed to the rentals site.
- Tenants (renters) keep using the tenant portal on the online shop (`shop.zarodashop.com/tenant`) and the houses-to-let listings there.
- Local testing: `http://localhost:3003/?product=rentals` (and `?product=pos` to go back).

## Manual setup (done by the owner)
1. Vercel → the back-office project → Settings → Domains → add `rentals.zarodasolutions.app`.
2. DNS for `zarodasolutions.app` → add the CNAME record Vercel shows (name `rentals`).
3. Back-office env (Vercel): `RENTALS_DOMAIN=rentals.zarodasolutions.app` and `NEXT_PUBLIC_RENTALS_DOMAIN=rentals.zarodasolutions.app`, then redeploy.
4. API env (Railway): `RENTALS_DOMAIN=rentals.zarodasolutions.app`, and add `https://rentals.zarodasolutions.app` to `CORS_ORIGIN`.
5. Marketing site env (Vercel): `NEXT_PUBLIC_RENTALS_URL=https://rentals.zarodasolutions.app`, then redeploy.

Until steps 3-5 are done nothing moves: landlords keep using `/rentals` on the back office and the marketing links point there.
