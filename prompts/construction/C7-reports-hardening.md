# C7 — Reports, Dashboards, Hardening

Specs: 01 (section 10) and all others.
Build:
1. Reports (screen + PDF + Excel export): project cost vs BQ budget, cash flow, IPC & retention summary, material reconciliation, labour cost per project, compliance expiries, safety statistics, NCA category utilisation.
2. Super-admin billing report: MRR, tenants per plan, trials ending, suspended tenants, agent commissions due (05-pricing-plans.md).
3. Director dashboard across projects; PM dashboard per project.
4. Hardening: tenant-isolation check on every con_ query, role tests for every endpoint in 02, audit log coverage, input validation, pagination, indexes on tenantId/projectId/date.
5. Test every plan gate and limit. Update CHANGELOG and write docs/construction/USER-GUIDE.md (short, plain English, per role).
Give me a final checklist of anything not finished.
