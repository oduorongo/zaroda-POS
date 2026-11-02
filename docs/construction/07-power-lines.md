# 07 — Power-line contractors (C9)

Zaroda Build for contractors who build power lines (KPLC, REREC, KETRACO and county jobs). The contract, valuation, materials,
labour, plant and safety features already fit; this phase adds what a linear electrical job needs. Same rules as every
construction phase: `con_` tables with `organizationId` and RLS, every write audited, server-side role and plan checks.

## 1. EPRA licences
- **Company licence**: compliance-vault document type `EPRA_LICENCE` with its **class** (`A1`, `A2`, `B`, `C1`, `C2`), number and expiry
  (alerts 60/30/7 days like every vault document).
- **Classes and voltages are settings, not code** (`con_epra_classes`, per company, Director/Compliance edit): each class has
  `anyVoltage` or `maxVoltageKv`. Seeded: A1 = any voltage; the others have no line voltage set until the company confirms them
  with EPRA (the current regulations' thresholds are not hard-coded).
- **Tender / project voltage** (`voltageKv`, optional, Electrical & mechanical works only). When set, the tender or project needs a
  valid (unexpired) EPRA licence whose class covers that voltage; otherwise the same rule as the NCA cap applies: blocked unless a
  Director overrides with a reason that is kept.
- **Electricians' licences** (`con_staff_licences`): each person's EPRA licence (class, number, expiry, optional file). Compliance or
  the Director records them; expiry alerts 60/30/7 days.

## 2. Client-supplied ("free-issue") materials
Utilities issue materials (poles, conductor, transformers, insulators) that stay the client's property and are audited.
- Per project, the **items** (`con_client_items`: code, description, unit) and a ledger of **movements**
  (`con_client_material_moves`: RECEIVED from the client, ISSUED to the works (optionally to a section), RETURNED to the client,
  DAMAGED), each with quantity, date, reference (delivery / return note) and note.
- **Reconciliation** per item: received − issued − returned − damaged = on hand, and issued per section. An issue or return can
  never exceed what is on hand.
- Not company stock and not a cost: never posted to the books, never valued.

## 3. Sections and progress
- **Sections** (`con_project_sections`): code, name, chainage from/to (km), and targets: poles, stays, conductor strung (km),
  transformers, service connections.
- **Daily progress per section** (`con_section_progress`, one entry per section per day, editable that day): quantities for the same
  measures, crew, notes. Progress = sum of entries against the targets, per section and for the project.
- The company site diary stays one per project per day; section progress sits beside it.

## 4. Wayleaves, crossings and as-built records
- **Wayleaves** (`con_wayleaves`): landowner, phone, parcel/plot number, chainage, section, status (PENDING, AGREED, REFUSED, PAID),
  compensation agreed, agreed date, notes, signed consent file.
- **Crossings** (`con_crossings`): kind (ROAD, RAIL, RIVER, PIPELINE, POWER_LINE, OTHER), authority (e.g. KeNHA, KURA, KeRRA, KRC,
  WRA, county), reference, status (PENDING, APPROVED, REJECTED), approved and expiry dates (alerts 60/30/7), file.
- **As-built assets** (`con_line_assets`): kind (POLE, STAY, TRANSFORMER, SWITCHGEAR, SERVICE, OTHER), tag/number (unique per kind in
  the project), serial number, specification, section, GPS (from the phone), installed date, note. Exported as a handover register.

## 5. Who can do what (02 matrix extension)
| Area | View | Change |
|---|---|---|
| Sections & progress | CM, PM, QS, SHE, ENG, SUP | PM, ENG, SUP |
| Wayleaves & crossings | CM, PM, QS, COMP, ENG, SUP | CM, PM, COMP |
| As-built assets | CM, PM, QS, ENG, SUP | PM, ENG, SUP |
| Client materials | CM, PM, QS, ACC, PROC, ENG, SUP, STORE | PM, SUP, STORE |
| EPRA classes | (compliance area) | COMP |
| Electricians' licences | (as staff NCA cards) | COMP |

Plan features: sections, progress, wayleaves, crossings and assets with `projects`; client materials with `procurement`; EPRA with
`compliance`. No new plan or price.

## 6. Screens
- Project page: a **Power line** tab (sections and progress, wayleaves, crossings, as-built register, client materials) with CSV
  downloads of the asset register and the materials reconciliation.
- Phone: **Site → Line work**: today's progress per section, record an asset with the phone's GPS, issue client materials.
- Compliance: EPRA licence type with class; EPRA classes table. Staff: electricians' licences.
- Tender and project forms: line voltage for Electrical & mechanical works.

## 7. Demo (Uriri Builders Ltd)
An 11 kV line project with an A1 EPRA licence, three sections with targets and a week of progress, wayleaves, two crossings,
free-issue poles, conductor and a transformer, and a set of pole records with GPS.
