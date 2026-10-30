# 02 — Construction Roles & Permissions

Roles are tenant-scoped. A user can hold different roles on different projects
(`con_project_members`: userId, projectId, role). Company-level roles apply to all projects.

## Company-level roles (internal)
| Code | Role | Typical holder |
|---|---|---|
| `CON_DIRECTOR` | Director / Owner | Company director, signs contracts |
| `CON_CONTRACTS_MGR` | Contracts Manager | Oversees all projects |
| `CON_QS` | Contractor's Quantity Surveyor | BQ, valuations, variations, subcontract accounts |
| `CON_ACCOUNTANT` | Accountant / Finance | Payments, payroll, eTIMS invoices, tax |
| `CON_PROCUREMENT` | Procurement Officer | LPOs, suppliers, plant hire |
| `CON_COMPLIANCE` | Compliance / Admin Officer | NCA, KRA, permits, insurance documents |
| `CON_SHE_OFFICER` | Safety, Health & Environment Officer | OSHA registers, incidents, toolbox talks |

## Project-level roles (internal)
| Code | Role | Notes |
|---|---|---|
| `CON_PROJECT_MGR` | Project Manager | Full control of assigned projects |
| `CON_SITE_ENGINEER` | Site Engineer | Technical, measurements, site instructions |
| `CON_SITE_SUPERVISOR` | Site Supervisor / Foreman | Must hold valid NCA site-supervisor accreditation |
| `CON_STOREKEEPER` | Site Storekeeper | GRN, issues, site stock |
| `CON_TIMEKEEPER` | Timekeeper | Muster roll |

## External roles (portal, read-mostly)
| Code | Role | Can do |
|---|---|---|
| `CON_CLIENT` | Client / Developer | View progress, photos, IPCs; approve payments |
| `CON_CONSULTANT_ARCH` | Client's Architect / Project Manager | Issue site instructions, approve variations |
| `CON_CONSULTANT_QS` | Client's QS | Certify valuations → IPC |
| `CON_CONSULTANT_ENG` | Client's Engineer (structural/civil/M&E) | Inspections, instructions |
| `CON_SUBCONTRACTOR` | Subcontractor | Submit own valuations, view own payments |

## Permission matrix
Legend: **F** full, **A** approve, **C** create/edit, **V** view, — none.

| Area | DIR | CM | PM | QS | ACC | PROC | COMP | SHE | ENG | SUP | STORE | TIME | CLIENT | C-QS | C-ARCH | SUB |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Company compliance docs | F | V | V | V | V | V | F | V | — | — | — | — | — | — | — | — |
| Tenders & bids | F | F | V | C | V | V | C | — | — | — | — | — | — | — | — | — |
| Projects & contracts | F | F | C | C | V | V | V | V | V | V | — | — | V | V | V | — |
| BQ | F | F | V | F | V | V | — | — | V | V | — | — | V | V | V | own |
| Site diary & photos | V | V | A | V | — | — | — | V | C | C | — | — | V | V | V | — |
| Labour & muster roll | V | V | A | — | V | — | V | V | V | C | — | C | — | — | — | — |
| Safety registers | V | V | V | — | — | — | V | F | C | C | — | — | — | — | — | — |
| Requisitions | V | A | A | V | V | V | — | — | C | C | C | — | — | — | — | — |
| LPOs | A | A | A | V | V | C | — | — | — | — | — | — | — | — | — | — |
| GRN / site stock | V | V | V | V | V | V | — | — | — | V | C | — | — | — | — | — |
| Plant & fuel | V | V | A | — | V | C | — | V | V | C | C | — | — | — | — | — |
| Valuations | A | A | V | C | V | — | — | — | V | — | — | — | V | A (certify) | V | own C |
| Variations | A | A | C | C | V | — | — | — | C | — | — | — | V | V | A | — |
| IPCs / invoices / eTIMS | A | V | V | C | F | — | — | — | — | — | — | — | V | V | — | — |
| Payroll & M-Pesa payouts | A | V | V | — | F | — | — | — | — | — | — | — | — | — | — | — |
| Subcontract accounts | A | A | V | F | C | — | — | — | — | — | — | — | — | — | — | own V |
| Reports | F | F | own proj | C | F | V | V | V | V | — | — | — | own proj | own proj | own proj | — |
| Users & roles | F | — | — | — | — | — | — | — | — | — | — | — | — | — | — | — |

## Enforcement rules
- Server-side `@ConRoles(...)` decorator + `ConProjectGuard` checks project membership.
- Segregation of duties: the person who **creates** an LPO, valuation or payroll run cannot **approve** it.
- Approval limits: tenant setting per role (e.g. PM approves LPOs up to KES X; above goes to Director).
- `CON_SITE_SUPERVISOR` can only be assigned if the user's NCA accreditation is valid; warn 30 days before expiry.
- External users only ever see projects they are members of.
