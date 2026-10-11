# Launching the Online Shop - step by step

A plain-language plan for taking the online shop from "works on my computer" to
"live for real businesses". It lists what changes, in what order, how to check
each step, and how to undo it. **Nothing here has been done yet.**

> No passwords, keys or secret values belong in this file (the repository is
> public). Setting *names* only.

---

## 0. Three words, explained

- **Branch** - a separate copy of the code to work on without touching the live
  system. The online shop lives on `feature/online-shop-settings`.
- **Pull request (PR)** - a request on GitHub saying "please bring this branch
  into `main`". You review it, then click **Merge**.
- **`main`** - the branch your live system is built from. Whatever is on `main`
  gets deployed by Render (the API) and Vercel (the websites).

---

## 1. What we found out (read-only look at the live system)

| Fact | Why it matters |
|---|---|
| Live database is **13 MB**: 10 businesses, 7 products, 44 sales, 2 subscriptions | Small. Copying, restoring and migrating are all quick |
| **31** database changes ("migrations") applied, all finished cleanly | The new ones simply continue the list |
| **0** online-shop tables exist on live | Nothing is half-done |
| **6** migrations are waiting for the online shop (below), plus 1 for the parked M-Pesa fix | All are *additions* - new tables, new columns, one new list value, one unique index. Nothing is removed or rewritten |
| Row-level security is **off** for `subscriptions` and `subscription_payments` | The parked `fix/billing-rls` branch turns it on |
| No live payment carries an M-Pesa provider reference | The parked M-Pesa fix's unique index cannot clash with existing data |

The 6 migrations for the online shop, in order:

1. `20261008090000` online shop settings
2. `20261008120000` product online listing and photos
3. `20261008150000` buyers and online orders
4. `20261009100000` commission invoices
5. `20261009120000` invoice online payment and Tuma request ids
6. `20261011100000` shopper sign-in by email (email column, optional phone)

The parked M-Pesa fix has one more, `20260927120000` (a unique index on the M-Pesa
reference). Its date is **earlier** than the shop migrations, so **when it is merged,
rename its folder to a date after the latest applied one** (for example
`20261020120000_unique_sale_payment_provider_reference`) - Prisma expects new
migrations to sort after applied ones.

**Why additive changes matter:** the *old* live code ignores tables and columns it
doesn't know about. So the database can be updated **first**, while the live
system keeps running unchanged, and the new code is deployed **afterwards**.

**Built-in safety:** the add-on is OFF for every business by default. Even after
everything is live, **nobody sees any change** until you switch the Online Shop
add-on on for a specific business in the platform admin.

---

## 2. The order of work

Each phase ends with a check. Don't start the next phase until the check passes.

### Phase A - Safety net (about 10 minutes, you)

1. **Neon dashboard -> your project -> Branches -> Create branch** from `main`,
   named `before-online-shop`. This is an instant, full copy of today's database -
   your undo button.
2. Write down today's date/time. (Neon can also rewind to a point in time, but only
   for a short window - the branch is the reliable one.)

*Check:* the branch shows up in Neon with data in it.

### Phase B - Rehearsal on a copy - **DONE (2026-10-11)**

Results, on a Neon copy holding identical data to live (10 businesses, 44 sales):

- All 5 shop migrations applied; Prisma then reported the database up to date.
- All **61 existing tables kept exactly the same row counts**; 7 new tables; row-level
  security grew from 55 to 62 tables; the restricted app user could use every new table.
- The API started on the copy; the **100-check end-to-end test passed except one check**,
  which found a real (older) bug - creating an already-existing plan tier returned a 500;
  it now returns a clear 409 (fixed in the release candidate).
- **108 isolation checks passed** (every business sees exactly its own rows in 9 tables,
  as the restricted app user) and a query with no business selected saw nothing.
- The copy was proved to be a separate database from live before anything was applied.

*Original plan for this phase:*

Run the whole thing on the copy first, so any surprise happens there.

1. In Neon, make a second branch from `main`, named `rehearsal`.
2. Save its two connection strings into a private file on your computer (never in
   chat) - Claude will tell you the exact file and format.
3. Claude applies the 6 migrations and `rls.sql` to the copy, starts the API against
   it locally, and runs the 90-check end-to-end test on real-shaped data.
4. Delete the `rehearsal` branch.

*Check:* migrations apply, the end-to-end test passes, your existing 10 businesses'
data still looks right.

### Phase C - Accounts and settings - **DONE (2026-10-11)**

- **Resend:** `zarodashop.com` verified; a real test email from `billing@zarodashop.com` was
  accepted by Resend.
- **Render:** the 8 new settings were pasted (their names should be visible in Render ->
  Environment). The live API stayed healthy afterwards.
- **Shopper sign-in no longer needs SMS:** shoppers sign in with an emailed 6-digit code
  (default); an SMS option appears automatically once Africa's Talking is configured.
- Still to do when ready: `CORS_ORIGIN` (only if it already exists on Render, append
  `,https://shop.zarodashop.com`); the school system's own Resend sender for teachers.
- Addresses: API `https://api.zarodashop.com`, back office `https://app.zarodashop.com`,
  platform admin `https://admin.zarodashop.com`, terminal `https://pos.zarodashop.com`,
  shop `https://shop.zarodashop.com` (new).

*Original plan for this phase:*

**Resend (email) - do this first, it takes DNS time.**
- Verify a sending domain in Resend (for example `zarodashop.com`): Resend gives
  you a few DNS records to add where you manage the domain.
- Until a domain is verified, Resend's test sender (`onboarding@resend.dev`) can
  **only deliver to the Resend account owner's own address**. Invoice emails to
  businesses would silently fail.
- **Likely side-finding:** the same limit may be why a teacher's password-reset email
  never arrived in the school system. Check the school API's `RESEND_FROM` on Render.

**Render -> the API service (`zaroda-POS`) -> Environment.** Add these names
(values: ask Claude to generate the two random ones privately):

| Setting | What it is |
|---|---|
| `BUYER_JWT_SECRET` | **Required - the API will not start without it.** Random, long |
| `SECRETS_ENCRYPTION_KEY` | Random 32 bytes. Encrypts each business's Tuma key. **Never change it later** - businesses would have to reconnect Tuma |
| `PUBLIC_API_BASE_URL` | The API's own public address (Tuma sends payment callbacks here) |
| `BACKOFFICE_BASE_URL` | The back office address, for the "Pay now" button in emails |
| `TUMA_EMAIL`, `TUMA_API_KEY` | Zaroda's own Tuma account (same one the school system uses) |
| `RESEND_API_KEY`, `RESEND_FROM` | Email, with a verified-domain sender |
| `CORS_ORIGIN` | **Add** the storefront's address to what is already there - do not replace it |
| `STORAGE_*` | Photo storage (Cloudflare R2). Optional at first: photo upload will say "not configured" |

**Paste values with no surrounding quotes** - Render keeps quotes as part of the value
(this is what broke the deploy earlier).

*Check:* every name saved, no quotes, no spaces.

### Phase D - Bring the code in (you click, Claude prepares)

Do the three branches **one at a time**, smallest first, checking after each.

**D1. `fix/billing-rls`** (turns on row-level security for billing tables)
1. Claude updates the branch and opens it for review; you merge the PR on GitHub.
2. **Then** apply the security rules to the live database (Claude gives you the one
   command; it can be re-run safely).
3. *Check:* sign up a new test business; open **platform admin -> Billing**; record a
   test payment. Any of these failing means the policy needs a tweak - undo by
   restoring the Neon branch (or re-running the older `rls.sql`).

**D2. The Online Shop (`feature/online-shop-settings`)** - the big one
1. Claude updates the branch with the newest `main`, runs every test, and opens it
   for review. You read the summary and merge the PR.
2. **Before Render finishes deploying:** apply the 6 migrations and `rls.sql` to the
   live database. Safe order: database first, code second (see section 1).
3. Render builds and deploys automatically. Vercel redeploys the back office and
   platform admin.
4. *Check:* `/health` and `/ready` on the live API say ok; log in to the POS and
   ring up a test sale; log in to platform admin; log in to the back office. The
   new **Online Shop** tile appears but shows "contact Zaroda" - correct.

**D3. `fix/mpesa-callback-verification`** (POS till payments via Safaricom Daraja)
- **Not needed for the Online Shop** - the shop uses Tuma, not Daraja. (An earlier
  note said it had to go first; that is no longer true.)
- Live shows no Daraja payments today, so this is low-risk, but it changes how
  till M-Pesa payments are verified. Merge it when you intend to turn on Daraja,
  after a Safaricom sandbox test. One more migration (a unique index) runs with it.

### Phase E - The storefront website (about 30 minutes, you)

1. **Vercel -> Create Project** -> the `zaroda-POS` repository, named
   `zaroda-pos-storefront`, **Root Directory** `apps/storefront`.
2. Environment: `NEXT_PUBLIC_API_URL` (the live API address) and
   `NEXT_PUBLIC_SITE_URL` (the storefront's own address).
3. Choose its address - for example `shop.zarodashop.com` - and add the DNS record
   Vercel asks for. Put that address into Render's `CORS_ORIGIN`, and into the
   back office's `NEXT_PUBLIC_STOREFRONT_URL` on Vercel. Redeploy both.
4. *Check:* the marketplace page opens and says "No shops are open yet".

### Phase F - Go live with one business (about 30 minutes, you + Claude)

1. In **platform admin**, open one real business (start with your own) and switch the
   **Online Shop add-on** on.
2. As that business: connect Tuma, add a product marked "show online", choose a
   branch, go live.
3. Place a **KES 1** order from a phone, pay it, accept it, complete it. The real
   callback should reach the live API.
4. When happy, switch it on for more businesses, one at a time.

### Follow-ups found while rehearsing

- **Demo account:** live still has `owner@demo.zaroda.pos` with the public default
  password `password123` (it is in the seed file). Its business ("Demo Retail Co", holding
  43 of the 44 sales, so test data) is deactivated, which is the only reason it cannot log
  in. Change that password or remove the account on live, so a future reactivation cannot
  expose it.
- Plan creation duplicate tier: fixed (409 instead of 500).
- Resend / teacher emails: see Phase C.

---

## 3. If something goes wrong

| Problem | Undo |
|---|---|
| Live API won't start after a deploy | Render -> the service -> **Deploys** -> pick the previous good one -> **Rollback**. The database changes are additions, so the old code still works with them |
| Website broken after a deploy | Vercel -> **Deployments** -> previous one -> **Promote to Production** |
| A security-rule change blocks something | Re-apply the old `rls.sql`, or restore the `before-online-shop` Neon branch |
| Data looks wrong | Restore from the `before-online-shop` Neon branch |
| Online shop misbehaves for a business | Switch its add-on **off** in platform admin: the shop disappears immediately, its settings are kept |
| Everything online-shop related | Add-on OFF for all businesses = feature invisible. The rest of the POS is unaffected |

---

## 4. Known gaps (not blockers, but know them)

- **Text messages (SMS)** are untested: shop alerts to the shop (a new paid order) need
  Africa's Talking configured. Shopper sign-in no longer depends on it (email codes).
- **Photo storage** (Cloudflare R2) is untested.
- **Tuma status checks cost KES 1 each**, so they are only a backup. If Tuma's
  callback is slow, a shopper can press "I've paid - check now" (limited), and the
  shop can **Mark as paid** by hand with the M-Pesa code.
- **Tuma callbacks are unsigned.** Protection is the secret address plus checking
  the callback's contents; a question to Tuma about signing is open.
- **The invoice scheduler needs the API to stay awake** (a Render plan that does not
  sleep). Turn it off with `COMMISSION_SCHEDULER=off`.
- **Riders** (delivery) are not built; shops arrange delivery themselves.
