# 01 — Construction Module: Domain Spec

## Target users
Kenyan building, civil and specialist (electrical/mechanical) contractors, NCA 1–NCA 8,
from small "fundi" firms running 1–2 sites to mid-size firms running many projects.

## Modules

### 1. Company Compliance Profile
- NCA registration per works class (Building, Roads & Civil, Electrical/Mechanical specialist) with category NCA1–8.
- Annual NCA practising licence (expiry), KRA PIN + Tax Compliance Certificate (expiry), business permit,
  AGPO certificate (youth/women/PWD) where held, insurance policies (CAR, public liability, WIBA).
- Document vault with expiry alerts. Dashboard "Compliance health" score.

### 2. Tenders & Bids
- Tender register (public/private, procuring entity, closing date, bid bond, value).
- Warns/blocks bidding when tender value exceeds the firm's NCA category cap for that works class.
- Bid status: Preparing → Submitted → Won/Lost. Won → converts to a Project.

### 3. Projects & Contracts
- Project: client/developer, consultants (architect, QS, engineer), site location (GPS), contract sum,
  form of contract (JBC, FIDIC, PPADA/Govt, Simple Agreement), start/completion dates, defects liability period.
- Bill of Quantities (BQ) import from Excel: sections → items (code, description, unit, qty, rate, amount).
- Project compliance checklist: NCA project registration/compliance certificate, county approved plans,
  building permit, NEMA EIA licence, DOSHS workplace registration, occupancy certificate at end.
- Programme: milestones/phases with % complete (simple Gantt).

### 4. Site Operations (mobile-first)
- Daily site diary: weather, works done, labour count, plant on site, visitors, delays, photos (geo-tagged).
- Labour: worker register with NCA accreditation card no. + expiry, ID, trade, daily rate, phone (M-Pesa).
- Daily muster roll / attendance (supervisor marks on phone, optional photo).
- Site instructions received from consultants.

### 5. Health & Safety (OSHA 2007)
- Toolbox talks log, PPE issue register per worker, permits-to-work (height, hot works, excavation),
  incident/accident register (with DOSHS reporting flag), safety inspections checklist.

### 6. Materials, Procurement & Plant
- Reuses POS inventory/products/suppliers.
- Flow: Site Requisition → Approval → LPO → GRN (delivery) → Stock at site store → Issue to work item.
- Material reconciliation per project (BQ qty vs delivered vs used vs wastage).
- Plant & equipment register (owned/hired), hire log, fuel log, maintenance.

### 7. Commercial (QS)
- Valuations (measured against BQ) → Interim Payment Certificate (IPC) once certified by client's consultant.
- Variations: instruction → priced variation order → approved → adjusts contract sum.
- Retention ledger: deducted per IPC; release of half at practical completion, balance after defects liability period.
- Advance payment + recovery, materials-on-site, fluctuations (optional).
- Invoices to client via existing eTIMS integration; withholding VAT/WHT receipts tracking.
- Subcontractors: subcontract sum, their own valuations, retention, payments.

### 8. Labour Payroll
- Weekly/fortnightly casual payroll from muster roll; statutory deductions per tax settings.
- Pay via M-Pesa B2C (Daraja) or mark cash paid; payslip by SMS.

### 9. Client / Consultant Portal (external, read-mostly)
- Client sees progress, photos, IPCs, variations; consultant certifies valuations and approves variations.

### 10. Reports
- Project cost vs budget (BQ), cash flow, IPC/retention summary, material reconciliation,
  labour cost per project, compliance expiries, safety statistics, NCA category utilisation.

### 11. Plans & Billing
Tiered subscription (Fundi, Contractor, Pro, Enterprise) by active projects, workers and features — see 05-pricing-plans.md.

## Out of scope (v1)
BIM/CAD viewing, full general ledger (lives in BOAS/POS accounting), e-procurement portal integrations.
