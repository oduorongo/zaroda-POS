# C0 — Discovery & Plan (NO CODE)

Read CLAUDE.md and every file in docs/construction/.
Then study this repo and answer, in a new file docs/construction/00-plan.md:
1. How existing business types (retail, rental/tenant module, etc.) are registered and switched on per tenant.
2. Where auth, roles/guards, tenants, products, suppliers, stock, payments (Daraja), eTIMS, audit log and file uploads live.
3. Which of those the construction module will reuse, and any gaps (e.g. no audit log, no object storage, no stock locations).
4. Exact folder layout you will use for backend (NestJS module `construction`) and frontend (Next.js `/construction/*` routes).
5. Whether POS already has subscription/billing tables that 05-pricing-plans.md should reuse.
6. Risks and anything in the specs that conflicts with the current code.
Do NOT modify any code or run migrations. Stop after writing 00-plan.md and summarise it for me in plain English.
