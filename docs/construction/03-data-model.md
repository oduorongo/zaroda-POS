# 03 — Construction Data Model (TypeORM, Neon Postgres)

All tables: `id uuid pk`, `tenantId uuid` (indexed, FK tenants), `createdAt`, `updatedAt`, `createdBy`.
Money: `numeric(14,2)`. Enums as Postgres enums. Reuse existing: `tenants`, `users`, `products`,
`suppliers`, `stock_movements`, `payments`, `etims_invoices`, `audit_logs`.

## Compliance
- `con_company_registrations` — worksClass (BUILDING|ROADS_CIVIL|ELEC_MECH|...), ncaCategory (1–8), regNo, licenceExpiresAt
- `con_compliance_docs` — type (NCA_CERT|NCA_LICENCE|KRA_TCC|BUSINESS_PERMIT|AGPO|INSURANCE_CAR|INSURANCE_PL|WIBA|OTHER), refNo, fileUrl, issuedAt, expiresAt, projectId nullable
- `con_category_limits` — worksClass, ncaCategory, maxValue (seeded; editable — NCA revises caps)
- `con_tax_settings` — key (VAT|WHT_CONTRACTOR|WHT_VAT|NCA_LEVY|RETENTION_DEFAULT|SHIF|HOUSING_LEVY|NSSF), rate, threshold, effectiveFrom

## Tenders & projects
- `con_tenders` — title, procuringEntity, worksClass, estValue, closingAt, bidBond, status
- `con_projects` — code, name, clientId, worksClass, contractSum, revisedSum, formOfContract, startDate, completionDate, dlpMonths, retentionRate, retentionLimit, lat, lng, county, status (PLANNING|ACTIVE|PRACTICAL_COMPLETION|DLP|CLOSED)
- `con_parties` — kind (CLIENT|ARCHITECT|QS|ENGINEER|SUBCONTRACTOR), name, kraPin, phone, email
- `con_project_members` — projectId, userId, role
- `con_project_permits` — projectId, type (NCA_PROJECT_REG|COUNTY_APPROVAL|BUILDING_PERMIT|NEMA_EIA|DOSHS_REG|OCCUPANCY), refNo, fileUrl, issuedAt, expiresAt, status
- `con_milestones` — projectId, name, startDate, endDate, percentComplete, sortOrder

## BQ & commercial
- `con_bq_sections` — projectId, code, name
- `con_bq_items` — sectionId, code, description, unit, qty, rate, amount
- `con_valuations` — projectId, number, periodEnd, grossToDate, materialsOnSite, retention, advanceRecovery, previousCertified, netDue, status (DRAFT|SUBMITTED|CERTIFIED|PAID), certifiedBy, certifiedAt
- `con_valuation_lines` — valuationId, bqItemId nullable, variationId nullable, qtyToDate, amountToDate
- `con_variations` — projectId, ref, instructionRef, description, amount, status (PROPOSED|PRICED|APPROVED|REJECTED), approvedBy
- `con_retention_ledger` — projectId, valuationId nullable, type (DEDUCT|RELEASE), amount
- `con_subcontracts` — projectId, partyId, scope, sum, retentionRate
- `con_sub_valuations` — subcontractId, number, grossToDate, retention, netDue, status

## Site
- `con_site_diaries` — projectId, date (unique per project), weather, worksDone, delays, visitors, labourCount
- `con_site_photos` — projectId, diaryId nullable, fileUrl, lat, lng, takenAt, caption
- `con_site_instructions` — projectId, number, issuedBy (partyId), description, date, variationId nullable

## Labour
- `con_workers` — name, idNo, phone, trade, ncaCardNo, ncaExpiresAt, dailyRate, isSupervisor
- `con_muster` — projectId, workerId, date, status (PRESENT|ABSENT|HALF), hours
- `con_payroll_runs` — projectId, periodStart, periodEnd, status (DRAFT|APPROVED|PAID)
- `con_payroll_lines` — runId, workerId, days, gross, deductions jsonb, net, paymentRef

## Safety
- `con_toolbox_talks` — projectId, date, topic, attendeeIds
- `con_ppe_issues` — workerId, item, issuedAt
- `con_permits_to_work` — projectId, type (HEIGHT|HOT_WORK|EXCAVATION|CONFINED|ELECTRICAL), validFrom, validTo, issuedBy
- `con_incidents` — projectId, occurredAt, severity (NEAR_MISS|MINOR|LOST_TIME|FATAL), description, workerId nullable, reportedToDoshs bool, reportedAt

## Materials & plant
- `con_requisitions` — projectId, number, status (DRAFT|SUBMITTED|APPROVED|REJECTED|ORDERED)
- `con_requisition_lines` — requisitionId, productId, qty, bqItemId nullable
- `con_lpos` — projectId, supplierId, number, total, status (DRAFT|APPROVED|SENT|PART_RECEIVED|RECEIVED|CANCELLED)
- `con_lpo_lines` — lpoId, productId, qty, rate
- `con_grns` — lpoId, receivedAt, receivedBy, deliveryNoteNo
- `con_grn_lines` — grnId, productId, qty
- `con_site_stock` — projectId, productId, qty (derived from stock_movements with `locationType=SITE`)
- `con_material_issues` — projectId, productId, qty, bqItemId nullable, issuedTo
- `con_plant` — name, regNo, ownership (OWNED|HIRED), hireRate, supplierId nullable
- `con_plant_logs` — plantId, projectId, date, hours, fuelLitres, operator

## Key relationships
Project 1–n BQ sections 1–n items. Valuation n–1 Project, lines → BQ items/variations.
Requisition → LPO → GRN → site stock → material issue → BQ item (cost tracking).
Muster → payroll run → M-Pesa B2C payment (existing payments table).
