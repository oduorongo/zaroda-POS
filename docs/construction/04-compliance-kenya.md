# 04 — Kenyan Compliance Rules the Software Enforces

> Rates and caps change. Everything numeric below is SEED DATA in `con_tax_settings` /
> `con_category_limits`, editable by the tenant/super-admin. Verify current figures with the
> regulator before go-live.

## National Construction Authority (NCA Act No. 41 of 2011, NCA Regulations 2014)
- **Contractor registration** per works class, categories NCA1 (unlimited) to NCA8.
  Seed caps (KES), Building / Elec-Mech specialist / Roads & Civil:
  | Cat | Building | Elec/Mech | Roads & Civil |
  |---|---|---|---|
  | NCA1 | Unlimited | Unlimited | Unlimited |
  | NCA2 | 500M | 250M | 750M |
  | NCA3 | 300M | 150M | 500M |
  | NCA4 | 200M | 100M | 300M |
  | NCA5 | 100M | 50M | 200M |
  | NCA6 | 50M | 20M | 100M |
  | NCA7 | 20M | 10M | 50M |
  | NCA8 | 10M | 5M | 20M |
  - Rule: tender/project value > cap for the firm's category in that works class → block with explanation
    (Director may override with a reason, logged).
- **Annual practising licence**: expiry tracked; alerts 60/30/7 days; dashboard red when expired.
- **Accreditation of skilled workers and site supervisors**: cards valid 3 years. Store card no. + expiry
  on `con_workers`; warn on expired cards in muster roll; supervisor role requires valid card.
- **Project registration / compliance certificate**: project cannot move to ACTIVE unless an
  `NCA_PROJECT_REG` permit is recorded (setting can make this a warning instead of a block).
- **Construction levy (0.5% on contracts above KES 5M)**: has historically been suspended and reinstated —
  keep as setting `NCA_LEVY` with `active` flag (default OFF); when ON, compute on project and show on cost report.

## County government
- Approved architectural/structural plans and building permit recorded before ACTIVE (warning).
- Occupancy certificate recorded before project CLOSED (warning).

## NEMA (EMCA 1999)
- EIA licence per project where required; expiry tracked; licence number shown on site board printout.

## Occupational Safety & Health Act 2007 / WIBA 2007 (DOSHS)
- Workplace registration per site.
- Incident register; serious/fatal incidents flagged "Report to DOSHS" with due-date reminder.
- WIBA insurance policy must be valid while project ACTIVE (alert if expired).
- Toolbox talks, PPE register, permits-to-work kept as evidence.

## KRA
- Client invoices/IPCs issued through existing **eTIMS** integration.
- **Withholding tax** on contractual payments and **withholding VAT** by designated agents
  (e.g. government): record WHT certificates received against each IPC; reconcile net received.
- **VAT** on certified works per `VAT` setting.
- Keep KRA Tax Compliance Certificate valid (expiry alerts) — needed for tenders.
- Casual payroll deductions (PAYE, SHIF, NSSF, Affordable Housing Levy) driven by settings.

## Public procurement (PPADA 2015)
- Tender register fields: bid bond/security, AGPO reservation flag, closing date.
- Performance bond and advance payment guarantee tracked with expiry on projects.

## Contract practice (JBC / FIDIC style)
- Retention: default 10% of each IPC, capped at a project limit (default 5% of contract sum); 50% released at
  practical completion, balance at end of defects liability period. All configurable per project.
- Only consultant-certified valuations become IPCs; certified records are immutable.

## Data protection (Data Protection Act 2019)
- Worker ID numbers and phones are personal data: role-restricted, masked in lists, never in external portal.
