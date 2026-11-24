# Changelog

## Rentals only for rental businesses (2026-11-24)

- The Rentals server now refuses any business that is not a rental business (like Build already does): properties, tenants, rent, adverts, short stays, M-Pesa settings and the Rentals plan. A farm, shop or contractor gets "This is only for rental businesses (ZARODA RENTALS)." The business type is remembered for a minute, so this adds no database trip to most requests.
- Public pages (houses to let, short-stay booking), the tenant portal and payment callbacks are unchanged.
- The Rentals screen sends another kind of business to its own home (a farm to Shamba) instead of the shop Sales page.
- No DB step.

## Zaroda Shamba F3: milk, eggs and other produce (2026-11-24)

- Milk: a milking sheet for phones. Pick the day and milking (morning, midday, evening), type each cow's (or group's) litres and what it was for: for sale, calves, home or poured away. Each milking can be recorded once per cow; corrections are voids that keep the record.
- Eggs: each flock's day (good, cracked and small eggs, feed eaten, birds died), with lay %. Deaths come off the flock's count; voiding gives them back.
- Produce becomes POS stock: milk for sale and good eggs (as trays) go into the stock of the chosen branch as PRODUCTION movements, so the till sells them. "Make milk and egg products" creates Fresh milk (per litre) and Eggs (tray of 30) for a new farm.
- Withdrawal blocks sale: milk or eggs from an animal or flock under a treatment withdrawal are saved as withheld and never reach stock, even if marked for sale.
- Other produce (honey, manure, fish...) is recorded and, when a product is chosen, put into stock.
- Yields & produce: milk, eggs, lay %, feed and deaths by day (30), week (12) and month (12), with bars, and each cow's litres a day over 30 days.
- All records and voids are audit-logged. Herdsmen and managers record; only managers void or change the settings; people limited to some units see only their animals and flocks.
- Demo farm: two weeks of milkings and egg records (the treated cow's milk withheld), 12 kg of honey, and the produce in stock.
- DB: migration 20270115100000_shamba_production (4 tables), then apply-rls. Run BOTH before merging. Checks: scripts/e2e-shamba-production.js (27 pass on a freshly seeded farm).

## Password reset options (2026-11-24)

- "Forgot password?" on the sign-in page: a 6-digit code goes to the account's email (15 minutes, 5 tries, works once, 3 codes an hour). The page answers the same whether or not the email has an account.
- "My password" at the bottom of every sidebar (shops, Build, Rentals, Shamba): change your own password with the current one.
- Staff > "Set password": an owner can set the password of anyone but an owner; a manager can set it for staff below manager. Refused for someone who also works for another business (they use Forgot password).
- Every change is written to the audit log of each business the person belongs to.
- DB: migration 20270114100000_password_reset_codes (new table, no tenant RLS like users). Run migrate deploy BEFORE merging; apply-rls only adds a comment.

## KRA eTIMS in the platform admin (2026-11-24)

- New platform admin page "KRA eTIMS": save ZARODA's GavaConnect consumer key and secret for test and live (secret stored encrypted, never shown again), with "Save and test" and "Test connection" asking KRA's gateway for a token. Saved keys replace the ETIMS_*_CONSUMER_* server settings within a minute; those stay as the fallback.
- Every business with eTIMS listed: on/off, test or live, PIN, each branch device's status and last error, and documents sent / waiting / refused / needing a person.
- "Allow live" per business (after KRA certification). The business then sees "Switch to live" on its eTIMS page; switching needs every branch disconnected first, because each device key belongs to one KRA system. Live can only be withdrawn while the business is back on test. All admin actions are audit-logged.
- DB: migration 20270113100000_etims_platform_admin, then apply-rls (adds a read-only platform policy on etims_settings). Run BOTH before merging.

## One sign-in and a role-based sidebar (2026-11-23)

- One sign-in for everyone at the main address (zarodashop.com/login opens it): shops, hotels, Build, Rentals and Shamba. Each person lands on their own home. The Build, Rentals and Shamba addresses keep their welcome, pricing, guide and sign-up pages. Their sign-in and working screens move to the main address once POS_DOMAIN is set; sign-up hands the new session over without asking for the password again.
- A scrollable left sidebar (a slide-out drawer on phones) replaces the top menus. It lists only what the person's role and business type allow (lib/menu.ts), grouped (Main, Your business, Stock, Customers, People, Money, Help). Home tiles follow the same list.
- Supervisors and cashiers can now sign in on the web. Supervisors see Sales, Shifts, Reports, Inventory, Stock count, Waste, Customers, Lipa polepole, Roster, Online orders and their business screens. Cashiers see Home, Sales (their own sales only, enforced by the API) and Guide. Any other address sends them home. Construction and farms keep their own role lists.
- No DB step. Set POS_DOMAIN=app.zarodashop.com on the back office (Vercel) to move sign-in onto the main address.

## Zaroda Shamba F2: livestock and husbandry (2026-11-22)

- Animals one by one (ear tag unique per farm, breed, sex, birth, mother/father or semen code, bought or born) and groups/flocks with a head count and its history (born, bought, died, sold, slaughtered, culled, moved out, corrections; never below zero). Head and bird limits now count toward the plan, refused with an upgrade message.
- Drugs with milk/meat/egg withdrawal days (prescription-only ones recorded by the vet or farm manager). Health records (sick, treated, vaccinated, dewormed, dipped, checked) set withdrawal dates: the animal or flock shows "Withheld", and selling or slaughtering it is refused until the meat withdrawal ends. Wrong entries are voided with a reason, never deleted.
- Vaccination/deworming/dipping programmes (Mkulima and up): every animal and flock of that kind gets its dose on the due list; recording the dose schedules the next. Daily SMS then email reminders 7, 3 and 1 days before, on the day and once when overdue (FARM_REMINDERS=off turns them off).
- Breeding: heat, service/AI (expected birth by species; drying off 60 days before for cows), pregnancy checks, drying off, births registering each young one with its mother and sire, abortions. Weights and body condition. Moves between units; sold/died/slaughtered/culled/lost with amount, buyer and permit. Unit-limited staff (e.g. the herdsman) see and record only their pens. Everything audit-logged.
- Back office (mobile-first): /shamba/animals, /shamba/animals/[id], /shamba/groups/[id], /shamba/health; dashboard tiles for overdue, due this week, births in 30 days and withheld produce.
- Migration 20270112100000_shamba_livestock (9 tables, 7 enums) + rls.sql (9 farm tables): run migrate deploy then apply-rls BEFORE merging. Demo farm seed adds a herd, flocks, drugs, programmes, a cow under withdrawal and a cow in calf. Tests: src/farm/farm-livestock.util.spec.ts (11), scripts/e2e-shamba-livestock.js (26 checks).

## Zaroda Shamba F1: farm management foundation (2026-11-22)

- New business type FARM (Zaroda Shamba, docs/farm). Plans in farm_plans seeded from 05-pricing-plans.md (Kienyeji free, Mkulima 1,000, Farmer 2,500, Commercial 6,500, Estate quote); new farms get a 14-day Farmer trial; read-only once lapsed.
- FarmGuard + @FarmRoles/@FarmFeature; acres (fields and paddocks) and users (people with a farm role) limits refuse with an upgrade message. Farm settings, layout units (blocks, fields, paddocks, pens, poultry houses, ponds, stores, feed mill), enterprises and farm roles (owner, manager, herdsman, vet, crops officer, feed miller, storekeeper, sales, auditor; optionally limited to units). Everything audit-logged.
- Back office: SHAMBA_DOMAIN routing (shamba.zarodasolutions.app; ?product=shamba locally), Shamba welcome, pricing, guide, sign-up and sign-in, and /shamba, /shamba/layout, /shamba/enterprises, /shamba/staff. FARM businesses signing in on the POS address are sent to Shamba. Team members can sign up farms.
- Migration 20270111100000_shamba_foundation (6 tables, 4 enums, plans) + rls.sql (5 farm tables): run migrate deploy then apply-rls BEFORE merging. Demo farm: pnpm --filter api seed:farm (owner@shamba.demo / password123). Tests: src/farm/farm-plans.util.spec.ts, scripts/e2e-shamba.js (14 checks).

## Petty cash, for businesses and for ZARODA (2026-11-19)

- Businesses (every type): /petty-cash. Boxes per branch with a float and a keeper; vouchers (PCV-) that are also Expenses paid with PETTY_CASH (so profit, the VAT return and the books include them), refused above what the box holds; top-ups from the till, M-Pesa or bank (default: back to the float); counts (shortage = cost, surplus = other income); voids with a reason (a voucher's expense is removed; a top-up only while unspent); a printable petty cash book with balances brought and carried forward. Petty-cash expenses cannot be changed or deleted on Expenses. Audit-logged.
- Books: new account 1005 Petty cash (counts as money in the cash flow); top-ups and counts post as source PETTY_CASH; voided ones are reversed.
- ZARODA: Petty cash tab in ZARODA's books: vouchers (ZPCV-) charged to any ZARODA cost account except income tax, top-ups, counts, a float setting, the book; each posted at once as an automatic entry (cannot be reversed by hand), voiding reverses it. Platform-admin audit log.
- Migration 20270106100000_petty_cash (3 tables, an enum, platform_ledger_settings.pettyCashFloat); run `prisma migrate deploy` then `apply-rls` BEFORE merging. Test: scripts/e2e-petty-cash.js (42 checks).

## ZARODA's books: tax and tithe before net profit (2026-11-19)

- ZARODA's profit and loss now runs: income, less expenses = profit before tax; less income tax (new account 6800) = profit after tax; less the tithe (20% of the profit after tax, nothing in a loss) = net profit. The rate is a setting on the books page (0-100%).
- The tithe is worked out from the books, not posted. The balance sheet shows it owed under 2200 Tithe set aside, not yet given (and keeps it out of the owners' profit); giving it is a journal (debit 2200, credit the bank or M-Pesa).
- Migration 20270105100000_platform_tithe (platform_ledger_settings.titheRate, default 20). No RLS step. e2e-ledger.js now 179 checks.

## School uniforms: a business type that makes uniforms with tailors (2026-11-18)

- New business type at sign-up: "School uniforms" (`UNIFORM_MAKER`). It has every school supplier screen (schools, price list, orders, invoices, quotes, tenders, school-term plans) plus **Tailoring**.
- Tailoring: tailors (not staff logins); jobs (TJ- numbers) give a tailor N pieces of one size, and the materials (the piece's recipe x N) leave stock at once, refused if short; hand-ins of good and rejected pieces put good pieces into stock at materials share + pay per piece (weighted into the piece's cost) and earn the tailor the rate; close a job early with a reason, or cancel one nothing came back on (materials return); tailor payments (cash, M-Pesa, bank; voided, never edited), balances, advances and statements. Everything audit-logged.
- Books: work handed in posts Stock / Owed to tailors (new account 2160); payments post Owed to tailors / cash, M-Pesa or bank; a voided payment is reversed.
- "Made in advance" (`madeAhead`) on items: the recipe is then a bill of materials used when the item is made, and a sale takes the item itself. Recipes on everything else are used at sale as before. Sets are items whose recipe is finished pieces: the till, the online shop and school deliveries take the pieces (and a delivered set is costed from them; the order screen shows how many complete sets the pieces make). Items made by production orders are marked made in advance too, which stops a sale of a finished good also taking its raw materials.
- Fix: school order, delivery note, invoice, credit note, receipt, quote and contract numbers were unique across ALL businesses while each business numbers from 0001, so a second school supplier's first document failed. They are now unique per business.
- Sales team training businesses gain "Vazi Bora Uniforms": materials, shirts and shorts by size with their materials and tailor rates, a full set, two tailors (a finished job with a reject, partly paid; a job still open), and two weeks of till sales. Teams get it by pressing "Create training accounts" again.
- Migrations 20270104100000_uniform_maker (5 new tables, enum values, variant columns) and 20270104110000_school_numbers_per_business; run `prisma migrate deploy` then `apply-rls` BEFORE merging. Test: scripts/e2e-uniform-maker.js (62 checks).

## School joining link (2026-11-17)

- A school supplier shares a joining link (`/schools/<slug>/join`, copy / WhatsApp / text / email on Schools). The school fills in its details and chooses its own PIN; it waits as PENDING (no sign-in, no orders) until the supplier approves or turns it down. The supplier is emailed; the school is texted/emailed on approval. "Stop new schools joining" switches the link off.
- A school can join any number of suppliers with the same email and phone; each supplier keeps its own record, PIN and credit terms.
- The joining form refuses a school already registered (or waiting) with that supplier by phone or by name; names are compared ignoring case, punctuation, "the", "school" and short forms (Sec., Sch., Pri., St.).
- Migration 20270103100000_school_join_link (enum value SchoolStatus PENDING, school_portals.joinEnabled). No new tables. Test: scripts/e2e-school-join.js (27 checks).

## Online shop for training (demo) shops; user guide (2026-11-17)

- Training businesses are hidden from the tenant list, so their Online Shop could not be switched on. The sales team page in the platform admin now has "Switch on online shop" / "switch off" beside each practice shop (not rentals or construction). It uses the same switch as a real tenant.
- Practice shops never appear in the public shop directory or the hotels list, so real shoppers cannot order from them. They open from their own link for demos once their payments are set up (Tuma or M-Pesa), like any shop.
- User guide (POS): where the shop is (estate + map pin), how far it delivers (km / counties / all Kenya), and how shoppers order now (no account needed, private order link, remembered details, location check, Buy again). No DB step.

## Shops placed by estate and map pin; delivery by distance, county or all Kenya (2026-11-17)

- A shop sets its shopping centre or estate (shown and searchable) and a map pin ("Use my location" while standing in the shop) under Online shop settings, and chooses how far it delivers: within N km of the pin (boda riders), whole counties (as before, the default), or anywhere in Kenya (hardware and big items by vehicle).
- Shoppers tap "Use my location" (kept on the phone) or pick a county: shops are listed nearest first with the distance, and each card says whether it delivers to them. Checkout for a km-based shop asks for the shopper's location; the server checks the distance again (straight line), and a km shop without a pin yet falls back to its counties. A Kenya-wide shop offers all 47 counties.
- The shopper's location is stored on a delivery order (`deliveryLat/deliveryLng`) only when they shared it.
- Migration `20270102100000_shop_location_reach` (columns only, no RLS change): migrate deploy BEFORE merge.

## Shorter online checkout (2026-11-17)

- No account needed to order: a shopper gives only their M-Pesa number and pays. The M-Pesa prompt proves the phone is theirs. They follow the order through a private link (`/orders/<id>?k=...`, only a hash kept, page sends no referrer), also saved on that phone under My orders, including choosing a rider and the delivery code. New public endpoints under `/public/orders` (create, view, pay again, check, cancel, delivery, choose rider), throttled per address; a number gets at most 3 unpaid guest orders per shop at a time. Guest orders are never joined to an account by phone number (accounts are not phone-verified), so a guest's address can't leak to someone who registered their number.
- One short checkout screen: pick-up/delivery as two buttons, the M-Pesa number and name shown as text with "Change" once known, note hidden behind "+ Add a note", far-pickup tick box replaced by a warning line. The phone remembers name, number, pick-up/delivery, county and address; signed-in shoppers' name is saved to their account.
- "Buy again" on finished orders puts the same items back in the cart at today's prices (sold-out items left out) and opens checkout.
- No DB step.

## Zaroda School subscriptions in ZARODA's books (2027-01-01 migration)

- Zaroda School now reports every school's successful subscription payment (marketer or not) to `POST /sales-sync/school` (`receipts`). They are stored in `school_subscription_receipts` and posted to ZARODA's own books (platform admin > Accounts) as money in "M-Pesa and Tuma" and income in the new account 4090 "Zaroda School subscriptions" (source "Zaroda School subscription", memo shows the school and M-Pesa receipt). Payments before the books' start date are not posted, like every other source.
- Migration `20270101100000_school_subscription_receipts` (platform-level, no RLS policy, on the RLS exclusion list): migrate deploy BEFORE merge. Merge this BEFORE the Zaroda School change that sends receipts (the POS refuses unknown fields).

## School commission is yearly (2026-11-16)

- Schools pay a year at a time, so a team member earns the team's subscription share, all at once, on a school's first year only: its first payment plus any streams added in the 10 months after it. The renewal earns nothing and schools give no onboarding bonus. The earning window starts at the first payment, so a long free period never costs the member.
- Fix: a school is credited from its sign-up date, not from when the POS first heard of it, so payments made before the first sync still earn. No DB step.

## Shareable team sign-in card (2026-11-16)

- When a team leader or member is added, or their password is reset (platform admin team page, and a leader's Members page), the sign-in card shows the full Team app sign-in link with the email and temporary password. Each has its own Copy button, plus Copy all and Share (phone share menu; WhatsApp on a computer). Shared `CredentialsCard` in @zaroda/ui. No DB step.

## Sales teams earn on Zaroda School (2026-11-16)

- Team members get a Zaroda School sign-up link (Team app > Schools, `SCHOOL_APP_URL/auth/signup?agent=<member id>`). A school that signs up through it, or names the member's phone/email as marketer, is credited to that member for good.
- Zaroda School reports those schools and their subscription payments to `POST /sales-sync/school` (header `x-sales-sync-key` = `SCHOOL_SALES_SYNC_KEY`, 24+ chars). Repeat-safe: a school is never moved, a payment is stored once.
- The earnings engine treats each school like a business: same team rates, leader override, bonus on the second payment, earning window and cap; nothing earned while the school is suspended. Earnings show app "School" in the Team app and platform admin.
- Migration `20261231100000_school_sales_teams` (tables `sales_schools`, `sales_school_payments`; platform-level, no RLS policy, on the RLS exclusion list). Run migrate deploy BEFORE merge. The Zaroda School side (sending the reports) is a separate change in that repo.

## Gold lines on the ribbons (2026-11-10)

- Every app's top ribbon has a gold line along its bottom edge and the bottom "Powered by" ribbon one along its top edge, dividing them from the page (shared TopRibbon/BottomRibbon, plus the Construction headers). No DB step.

## School supplier price shown per year (2026-11-09)

- The school supplier plan is KES 12,000 a year. The pricing page showed it as "School Supplier (per term) ... /365d", which read as 12,000 each term. Plan renamed "School Supplier" (migration `20261230100000_school_supplier_plan_name`, data only), price shown "/year" with its own tagline; platform admin labels say "/year". The year's fee is still split 50/30/20 across terms (Term 1 / 2 / 3), unchanged.

## ZARODA Team app (2026-11-09)

- The team portal is an installable app, "ZARODA Team" (own icon: gold Z with an orange TEAM badge, full screen, theme navy): Install button on the sign-in and home pages (Android/desktop prompt; iPhone gets the Add to Home Screen steps). public/team.webmanifest (scope /team), public/team-sw.js (caches app files only, never API calls).
- Optional own address: set TEAM_DOMAIN (e.g. team.zarodashop.com) on the back office and point the domain at it; its / and /login open the team app. Platform admin forwards old links to NEXT_PUBLIC_TEAM_URL when set, else NEXT_PUBLIC_BACKOFFICE_URL.
- The "Sales team" card is not on the public zarodashop.com page; members get the link from their leader or the platform admin.
- Adding a leader or member (platform admin or team leader), and resetting their password, now emails them the sign-in link and temporary password (Resend), and texts it too when they have a phone (Africa's Talking). The link is `TEAM_APP_URL/login` when set on the API, else `BACKOFFICE_BASE_URL/team/login`. The screen says whether it went by email/text; the password is still shown once as a fallback. No DB step.

- Sales team leaders and members now sign in at the back office (`/team/login` on app.zarodashop.com) instead of the platform admin. Same pages: home with training accounts, shops, riders, earnings, setup fees, members. Tab title "ZARODA Team".
- The platform admin's old `/team/...` addresses forward to the same page on the back office when `NEXT_PUBLIC_BACKOFFICE_URL` is set on the platform admin; the team page's "sign in at" hint uses it too.

## Sales team training accounts (2026-11-09)

- Every new sales team gets 8 training businesses, one per business type (Retail, Restaurant, Pharmacy, Salon, Hotel, School supplier, Property rentals, Construction), with sample data: products with stock, customers and two weeks of cash and M-Pesa sales for the shop types; tables (restaurant), rooms (hotel), chairs (salon), schools as customers with school prices (supplier), 2 properties / 10 units / 7 tenants on leases (rentals), and 2 projects on an active Contractor plan (construction).
- One owner login per training business, shared by the team (`<type>.<team>@training.zarodasolutions.app`). Passwords are shown once when made; the platform owner and the team leader can issue a new one. Members see the logins on their portal home page; the leader resets.
- Training businesses are marked `isDemo`: plans paid up to 2099 (never billed), not attributed to the team (no commission), left out of platform analytics, construction MRR and the main business list. Made-up customers and tenants have no phone numbers, so no text can reach a real number.
- Teams that existed before get a "Create training accounts" button on their admin page.
- Migration `20261229100000_team_training_accounts` (`organizations.isDemo`, table `sales_team_training_accounts`, platform-level like sales_teams) then apply-rls.

## Online shop for shops on another POS, plan limits, team setup fees (2026-11-03)

- Plan limits are now enforced: adding a till or branch beyond the plan is refused with an upgrade message (the system's own online-shop, front-desk, school and construction terminals do not count; what exists keeps working). The free Online Shop only plan has no tills, and its self sign-up no longer makes one. Unpaid plans are still only a warning label.
- Platform admin can change a business's plan (business page): onto a free plan nothing falls due; free to paid starts a 14-day trial; paid to paid keeps the paid-up date. Audited.
- Update stock from another POS (back office, /stock-update): upload the other system's stock list as CSV (SKU or barcode, stock and/or price; common column names such as item_code, qty and selling_price understood), preview, then apply in one go. Stock changes are stock-count movements; price changes are audited.
- Automatic sync: an owner makes a sync key (shown once, hash kept, can be switched off) and the other POS sends `PUT /stock-sync` with up to 5,000 rows; applies at once unless dryRun. New table `stock_sync_keys` (RLS, with a prefix-only lookup like construction API keys).
- Online stock buffer (Online shop settings): hold back N of each item online so it stops selling online before the other POS sells the last one. Sold-out items were already hidden from checkout.
- Team setup fees: members record the one-off setup fee they charged a business they set up and kept in cash (one per business, receipt number SF-YYYY-XXXXXX), within the range the platform owner sets per size (small / medium / large) and optionally per business type. Not an earning, never paid out. Admin page Teams > Setup fees (ranges, totals per member, void with reason); members' portal page Setup fees (leaders see the team's).
- Migration `20261228100000_stock_sync_setup_fees` (starting ranges KES 1,000-3,000 / 3,000-10,000 / 10,000-30,000) then apply-rls. Local checks: scripts/e2e-online-only.mjs (24) and e2e-online-only-admin.js (10).

## Free "Online Shop only" plan (2026-11-03)

- New plan `ONLINE_ONLY` (KES 0, no tills, 1 branch) for a shop that sells in-store on another POS: never falls due (paid-up 2099, not a trial), recording a payment on it is refused, and its online shop add-on is switched on at sign-up. ZARODA earns the 3% shopper convenience fee; sales teams earn their commission rate on those fee invoices as usual.
- Sign-up page: "I already have a POS and only want the online shop" (preset by `/signup?plan=online`); admin and sales-team onboarding can pick the plan (no tills are created). Pricing page: "Already have a POS? Online Shop only: KES 0".
- My subscription shows the free plan; the AI Business Analyser stays for paid plans only. Plan editor accepts KES 0 and 0 tills.
- Migration `20261227100000_online_only_plan` (adds the plan row; no RLS change).

## Sales team commission across every app (2026-11-02)

- Marketing teams now earn from construction and ZARODA RENTALS as well as POS and the online shop, with the same team rates everywhere: the subscription rate on each plan payment (construction plans and extra projects, rentals subscriptions) and the commission rate on each paid fee (construction payout fees, rent collection fees). Adverts and SMS bundles do not count.
- Each app is stopped only by its own unpaid plan (an unpaid POS plan no longer blocks construction earnings); the onboarding bonus is paid on the second plan payment in any app; the payout cap covers all the business's apps together.
- Every earning records its app (`sales_earnings.sourceApp`, existing rows backfilled). Team earnings admin page: app filter and earnings per app this month; members see the app on each line.
- Migration `20261226100000_sales_earning_app` (no RLS change).
- Demo team: `pnpm --filter api seed:sales-demo` makes "Demo Sales Team" with a leader and a member (fresh passwords printed each run) and assigns them Demo Retail Co and Uriri Builders Ltd.

## ZARODA RENTALS: short stays (Airbnb-style lets) (2026-11-02)

- A vacant unit can be let by the night: nightly and Friday/Saturday rates, cleaning fee, fewest nights, most guests, check-in/out times, directions, door code (encrypted), cleaner, and an owner when managed for someone else. While on, it cannot take a lease or a Houses to let advert. Comes with Starter and Pay-as-you-collect.
- Bookings direct or from Airbnb / Booking.com / other sites (their price, fee and confirmation code typed as shown). No double bookings: clashes with other bookings, hand-made blocks and booking-site calendars are refused. Check in, check out (early check-out moves the cleaning), change dates, no-show, cancel. Payments and refunds with receipt numbers, voided not deleted; payouts from the booking sites.
- Calendar sync both ways by iCal: each unit reads its Airbnb / Booking.com calendars every hour (booking sites' addresses only, https, redirects checked) and offers its own calendar link per site (busy dates only, no guest details; a new link cuts off the old).
- Night-by-night calendar for all units, cleaning list (made with each booking, due on check-out day, marked done by the caretaker or cleaner), owners with commission and monthly owner statements (nights shared across months, booking-site fees, commission, unit expenses, payable; CSV).
- Guest messages for direct bookings (confirmation, directions and door code the day before, thank-you) and a text to the cleaner at check-out: text when switched on, else email; each sent once.
- Caretakers work the calendar, bookings, payments and cleaning for their properties only. New Short stays tab in Rentals; rentals guide, welcome page and POS marketing advert updated.
- Migration `20261225100000_rental_short_stays` then apply-rls. e2e-rental-stays 69 checks.

## Construction C9: power-line contractors (2026-11-02)

- EPRA licences: the company's EPRA electrical contractor licence is a compliance document with its class (A1, A2, B, C1, C2). The highest line voltage each class covers is a company setting on the Compliance page (confirm with EPRA). Electrical tenders and projects take the line voltage; saving one without a valid EPRA licence that covers it is refused, unless the Director overrides with a reason (like the NCA cap). Electricians' EPRA licences are recorded per person on Staff, with expiry alerts at 60/30/7 days.
- Free-issue (client-supplied) materials per project: items, received / issued / returned / damaged moves, balances on hand; issuing more than is on hand is refused. Kept apart from the company's own stock. CSV download.
- Line sections (chainage from-to km) with targets for poles, stays, conductor km, transformers and services, and daily progress per section with percentages per section and for the whole line.
- Wayleaves (landowner, parcel, chainage, compensation, status, signed consent file), crossings (road, rail, river, pipeline, power line; authority approvals with expiry alerts and file), and the as-built asset register (poles, stays, transformers, switchgear, services with tag, serial and GPS; CSV for handover).
- Project page gains a "Power line" tab; the site screens gain "Line work" for phones (today's progress, record a pole with the phone's GPS, client materials). All writes audited; tables carry RLS.
- Migration `20261224100000_construction_power_lines` then apply-rls. Demo: Uriri Builders gets the Rongo-Kamagambo 11 kV REREC line. e2e-con-powerlines 55 checks.

## VAT on purchases follows eTIMS (2026-11-01)

- KRA only allows VAT on purchases to be claimed from the supplier's eTIMS invoice. VAT on a bill or expense now counts as claimable only with the supplier's KRA PIN and the eTIMS invoice number, or when the bill or expense is linked to the invoice KRA holds (then KRA's VAT figure is used and it is marked "checked with KRA"). Without them the VAT is a cost, in the books and on the VAT return.
- Expenses take the supplier's KRA PIN, name and eTIMS invoice number; bills take the eTIMS invoice number (the PIN comes from the supplier) and gain "VAT details" to add them later.
- Purchases and KRA: each supplier invoice downloaded from eTIMS shows its VAT and can be linked to its bill or expense (suggested by PIN or same amount); accepting an invoice for a delivery links that delivery's bill. Links and unlinks are audited.
- VAT return: the purchases list for iTax (supplier PIN, name, date, invoice number, value, VAT; CSV), VAT not claimable and why, KRA invoices to you not yet entered, and a warning when sales have not yet been confirmed by eTIMS.
- Merged the eTIMS purchases and stock movements work (`feat/etims-purchases-stock`) into this branch. Migration `20261221100000_vat_claims`. e2e-ledger 167 checks, e2e-etims 219.

## Accounts: cash flow, aged debtors and creditors, VAT return (2026-11-01)

- Statements gain four tabs: Cash flow (money in and out by trading / investing / financing, reconciled to cash at the start and end), Aged debtors (school invoices, construction IPCs due 30 days after certification, retention, rent) and Aged creditors (supplier bills, approved subcontractor valuations, retention we hold), each compared with the books, and the VAT return for a month (output VAT by VAT class, refunds, input VAT, withholding VAT certificates, what to pay KRA or carry forward). All download as CSV.
- Supplier bills, bills made when goods are received, and expenses can carry the VAT on their invoice or receipt. That VAT goes to a new account "VAT paid on purchases (claimable)" (1165) and not to stock or cost. "What you owe" shows VAT less what is claimable, and paying VAT uses up the claimable VAT.
- Migration `20261220100000_vat_on_purchases` (existing bills and expenses: no VAT). The new account is added to every business's chart on first use. e2e-ledger now 141 checks.

## Construction C8: add-ons, construction in the general ledger, Enterprise (2026-11-01)

- Extra project slots bought by M-Pesa from the Plan page (and offered right where a project is refused for the limit, on plans that sell them): the first period is pro-rated to the paid-up date, then slots renew with the plan. Slots can be given back while open projects still fit. Buying add-ons never moves the plan's paid-up date.
- SMS credit (100 to start): payslips and expiry alerts use one text each (two for long ones); a text that fails is given back; when credit runs out texting stops and the Director gets a notice. SMS bundles bought by M-Pesa.
- ZARODA payout fee on every M-Pesa wage payout (Daraja cost + markup, by amount band), shown on the pay run; each finished month's fees become an invoice paid by M-Pesa from the Plan page. Accounts or the Director pay add-ons.
- ZARODA admin: Construction > Price lists edits the SMS bundles and the payout fee bands (placeholder figures to replace); the billing report shows fees owed.
- General ledger: certified IPC invoices with retention held by the client in its own account, IPC payments and withholding certificates (tax credits), retention release, paid site pay runs (wages, NSSF / SHIF / Housing Levy / PAYE owed), subcontractor work approved and paid (with retention we hold), materials issued to site (at cost; wastage as a loss), and every payment to ZARODA. Site wages, materials used and subcontractors are cost of sales, so gross profit is the job's profit. Every construction entry (IPC invoices included) names its project, and the profit and loss can be run for one project. Accounts is now in the construction menu (owner and office managers). ZARODA's own books record plan, SMS and payout-fee income.
- Enterprise: branch offices (office staff see only their office's projects; new projects belong to the creator's office), custom roles made from company jobs with their own approval limit, and read-only API keys (projects, certified IPCs, reports as JSON; hash stored only, revocable, 60 requests a minute) at `/construction-api/v1`. Director only, all audited; new "Offices & API" screen.
- Fix: recording a staff member's NCA card expiry was always refused (date check was broken).
- Migrations `20261218100000_construction_addons` (+ `rls.sql`) and `20261219100000_ledger_projects` (project on journal entries; other businesses' postings are unchanged); seed adds 500 texts bought, last month's payout-fee invoice (unpaid) and a Kisumu office (used once on Enterprise). e2e now 642 checks; unit 1569.

## Construction C7: reports, dashboards and hardening (2026-11-01)

- Reports screen with eight reports: project cost vs BQ budget, cash flow, IPC & retention, material reconciliation, labour cost, compliance expiries, safety statistics (with LTIFR) and NCA category utilisation. Each can be filtered by project and dates, downloaded as Excel and printed / saved as PDF. Basic reports are on every plan; cash flow, labour, NCA and exports need Contractor or higher (402 with an upgrade prompt). A read-only (lapsed) account can still run and export them.
- Who sees what follows docs/construction/02: Director and company-wide roles see every project, project roles only their own projects. Worker personal details are never in a report.
- Director / Contracts Manager overview on Home (all open projects: certified, cost, margin, owed, retention, on site today, behind programme, approvals waiting). Project Manager dashboard as the first tab of each project. Site staff see it without the money.
- Super-admin billing report: MRR, tenants per plan by status, trials ending in 7 days, grace and suspended tenants, and sales-agent commissions (15% of first-year plan payments by default, a per-team setting, payable after the second payment).
- Hardening: a permission test checks every construction endpoint against the 02 matrix (exceptions listed with reasons), plan features against 05, audit-log coverage of every write, validation of every request field, and that only global tables bypass the tenant. Storekeepers and timekeepers no longer see contract sums, the client or consultant contacts. Paging (`take`/`skip`) on the long lists; query values (dates, GPS, project filters) are validated. New indexes on project, tenant, date and foreign-key columns.
- e2e: reports cross-checked against the database, role refusals per area, and a database-level check that no construction table shows another business's rows.
- Plain-English guide per role: `docs/construction/USER-GUIDE.md`.
- Migration `20261217100000_construction_reports` (indexes + `sales_teams.conCommissionRate`); seed adds a second, late-running project "Oyani Market Sheds".

## Construction C6: casual payroll and the external portal (2026-10-31)

- Pay runs per project and period, worked out from the muster roll (days present x daily rate, half days count half). NSSF (up to the ceiling), SHIF (with its minimum), Housing Levy and PAYE bands with personal relief all come from `con_tax_settings` in force on the last day, scaled to the pay period. New settings keys: PAYE_BAND_1-5, PERSONAL_RELIEF; NSSF and SHIF now carry their ceiling / minimum. Missing keys are added automatically for existing businesses.
- Accounts prepares, someone else approves (never the preparer). Paid by M-Pesa B2C from the business's **own** Daraja account (saved encrypted under Settings), or marked paid in cash / by an M-Pesa payment made by hand. Safaricom's results settle each line; failures are shown and can be paid again. Payslip by SMS after payment. Overlapping pay periods are refused.
- Core: `MpesaB2cClient.sendFrom()` pays from a given account (commission payouts unchanged); `MPESA_B2C_BASE_URL` points it at a test double. `AuditLogService` names non-staff actors (`portal:<id>`, `system:mpesa`) in the entry instead of `actorId`.
- External portal at `/portal` on CONSTRUCTION_DOMAIN: clients, client's QS / architect / engineer and subcontractors sign in with an emailed code (no password, free, never counted as users). They see only projects they were given. Client: progress, milestones, photos, IPCs, variations, instructions. Client's QS: certifies submitted valuations in their own name. Architect: approves or rejects variations and issues site instructions (engineer: instructions). Subcontractor: their own subcontract, valuations and payments, and submits valuations. No worker data, materials, plant, payroll or internal costs are ever returned.
- Staff (Contracts Manager, Project Manager for their projects, Director) invite and remove portal users from the project's Portal tab. New project tabs: Payroll, Portal.
- Migration `20261216100000_construction_payroll_portal` (+ `rls.sql`, with a narrow email-only read rule for portal sign-in), seed: PAY-001 paid for 15 workers, a plumbing subcontract with a paid valuation, and portal users client@, cqs@, arch@ and sub@uriri.demo. Test double `scripts/mock-daraja-b2c.js`; e2e now 470 checks.

## Construction C5: commercial - variations, valuations, IPCs, retention (2026-10-31)

- Variations register (VO-001...) linked to site instructions; priced, then approved or rejected by the Contracts Manager / Director (never by whoever raised it). Approved variations update the revised contract sum.
- Valuations against the BQ (quantity to date per item), approved variations and materials on site; retention at the project rate capped at the project limit (5% of the contract sum), advance recovery, less everything certified before = net due. Flow DRAFT (QS) → approved and sent (Contracts Manager, not the preparer) → CERTIFIED (client's QS name, ref, date) → PAID. Certified IPCs are locked; a mistake is corrected with a reversing certificate, then a fresh valuation.
- Retention ledger: deductions per IPC, release at practical completion (any share) and at the end of the defects period.
- Certified IPC → invoice through the existing eTIMS sales (sale on account, VAT from `con_tax_settings` at the certificate date). Reversing an invoiced IPC credits it (refund → eTIMS credit note).
- Money received: payments plus WHT and WHT-VAT certificates; expected withholding shown from tax settings; overpayment refused; settled IPCs become PAID.
- Subcontracts (Pro plan): each with its own valuations, retention (rate and cap), approval and payment.
- Commercial tab on each project, valuation editor/detail screen, printable IPC (print / save as PDF). Valuation maths unit-tested.
- Migration `20261215100000_construction_commercial` (+ `rls.sql`), seed: VO-001 and two certified IPCs on the demo project (IPC 1 invoiced and paid with withholding certificates, IPC 2 waiting to be invoiced); e2e now 389 checks.

## Construction C4: materials, procurement, plant (2026-10-31)

- Each project gets its own site store (a branch on the shared inventory), created the first time materials go to it. No second inventory: LPOs are purchase orders to that branch, deliveries are goods received notes, and site stock is the normal stock ledger.
- Requisition (site) → approval (Project Manager / Contracts Manager; never by whoever raised it) → LPO (procurement; a DRAFT purchase order until approved). LPO approval follows the role approval limits (Project Manager KES 500,000, Contracts Manager KES 5M, Director unlimited; off on plans without approval limits) and the creator can never approve. Printable LPO in the brand colours (print / save as PDF).
- Deliveries by the storekeeper, part deliveries welcome; damaged items stay owed; over-delivery refused. Issues from the site store to a BQ item, or as wastage (new SITE_ISSUE stock movement; WASTE for wastage); never more than is on site.
- Material reconciliation per project: BQ allowance vs ordered, delivered, used, wasted, on site, wastage % and anything unaccounted for.
- Plant register (owned or hired, per day or per hour), daily logs of hours and fuel (one per machine per day), plant cost per project.
- Phone "Store" screen on the Site menu (receive, issue, request); Materials and Plant tabs on each project; Plant register.
- Core: `PurchaseOrdersService.createInTx` can create a DRAFT order; the new tables count as product history (a product used there is archived, not deleted).
- Migration `20261214100000_construction_materials_plant` (+ `rls.sql`), seed: cement / steel / ballast flow on the demo project (REQ-001 → LPO-001 with two deliveries → issues; LPO-002 awaiting approval; excavator and mixer logs); e2e now 294 checks.

## Construction C3: site diary, labour, safety (2026-10-30)

- Site diary, one per project per day (weather, works done, delays, visitors, plant, labour from the muster): written on site, submitted, approved and locked by the Project Manager.
- Geo-tagged site photos from the phone camera (shrunk before upload, private storage, GPS when the phone allows); site instructions register (SI-001...).
- Worker register with NCA card no. and expiry (expired cards highlighted); a worker marked supervisor needs a valid card. ID numbers and phones are masked in every list and in the audit log; full only for Director, Accounts and Compliance. Active workers count toward the plan limit.
- Phone muster roll: big Present / Half / Absent buttons, mark everyone present, works with no signal (marks queue on the phone and send by themselves; safe to resend).
- Safety: toolbox talks with attendees, PPE issue register, permits-to-work (max 7 days), incident register; lost-time and fatal incidents get a DOSHS deadline (7 days / 24 hours) with due and overdue alerts. Worker NCA cards join the expiry alerts.
- Who sees workers: company-wide labour roles see all; site staff only the workers on their projects.
- Migration `20261213100000_construction_site_labour_safety` (+ `rls.sql`), seed: 15 workers and 7 days of diaries, muster and safety records on "Uriri Day Secondary Classrooms"; e2e now 231 checks.

## Construction C2: tenders, projects, permits, BQ, programme (2026-10-30)

- Tender register (Preparing → Submitted → Won/Lost/Withdrawn) with the NCA category cap check: above the cap only a Director can go ahead, with a reason that is kept. Submitting warns about an expired KRA TCC, NCA licence, bid bond or closing date.
- A won tender becomes a project (client created from the procuring entity). Projects: code, client, works class, contract sum, form of contract, dates, defects period, retention, county, site location and GPS.
- Project status flow Planning → Active → Practical completion → Defects period → Closed. Going Active is blocked without an approved NCA project registration (a Director can make it a warning) and warns about county plans, building permit, NEMA, DOSHS, WIBA cover, the client and the BQ total; closing warns without an occupancy certificate.
- Parties (client, architect, QS, engineer, subcontractor), project team with project roles; a Site Supervisor needs a valid NCA accreditation card (warning within 30 days of expiry). Site staff see only their projects.
- Permit checklist per project with private files; permits and staff NCA cards join the 60/30/7-day expiry alerts.
- BQ import from Excel (.xlsx) or CSV with a preview, errors and warnings before anything is saved; manual edit of sections and items; totals against the contract sum with the difference shown.
- Milestones with percent complete and a Gantt bar view; programme progress weighted by duration. Active projects (not closed) count toward the plan limit; Mjengo asks to upgrade to Fundi.
- Migration `20261212100000_construction_projects_bq` (+ `rls.sql`), seed project "Uriri Day Secondary Classrooms" (30-line BQ, KES 10,713,000), `exceljs` added to the API, e2e now 167 checks.

## Construction C1: foundation (2026-10-30)

- New business type `CONSTRUCTION`, served at `CONSTRUCTION_DOMAIN` with its own landing, pricing, login and signup (host-based `middleware.ts`; `?product=construction` on localhost).
- Construction roles (17, company/project/external) with approval limits per role; `ConstructionGuard` + `@ConRoles()`, `@ConFeature()`, `ConProjectGuard`; owners act as Director.
- Compliance vault: NCA registrations per works class, documents with private file storage, green/amber/red expiry badges, alerts at 60/30/7 days and on expiry (in-app, email, SMS), dashboard "Compliance health" card.
- NCA category caps and tax/statutory rates (VAT, WHT, NCA levy (off), retention, SHIF, Housing Levy, NSSF) as editable settings with effective dates; NCA cap check for later tender/project phases.
- Plans as data (`con_plans`: Mjengo (KES 1,500, 1 site, no extra projects, optional KES 3,000 setup), Fundi, Contractor, Pro, Enterprise), `con_subscriptions`, `con_coupons` (PILOT50), 14-day Contractor trial on signup, M-Pesa payment via Tuma extends the paid period, 7-day grace then read-only, user limit enforced when adding staff, upgrade prompts (HTTP 402).
- Construction screens for Materials (bags, tonnes, m³... with buying price, on the shared catalogue) and adding staff by job (office / site access set for them); Cashier and Caretaker are refused for construction businesses (API-side). Light/dark switch; brand text stays readable in dark mode.
- Super-admin "Construction" screen: edit plans and coupons, MRR and tenants per plan, extend trials, apply coupons, record payments, run expiry alerts.
- Every create/update/delete is audit-logged with before/after.
- Migration `20261211100000_construction_foundation` (+ `rls.sql` policies), demo seed `prisma/seed-construction.ts` ("Uriri Builders Ltd", NCA5 Building, NCA6 Roads, Contractor plan), tests `scripts/e2e-construction.js` (98 checks).
