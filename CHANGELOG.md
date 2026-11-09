# Changelog

## Team portal moved to the back office (2026-11-09)

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
