# C2 — Tenders, Projects, Parties, Permits, BQ

Specs: 01 (sections 2–3), 03 (Tenders & projects, BQ), 04 (NCA caps, county, NEMA).
Build:
1. Tenders register with status flow; NCA category cap check (block + Director override with reason).
2. "Won" tender → creates project. Projects CRUD, parties (client/consultants/subcontractors), project members with project-level roles.
3. Project permits checklist; status change to ACTIVE checks rules in 04 (block or warn per setting).
4. BQ import from Excel (sections + items; show preview and errors before saving) and manual edit. Totals must equal contract sum or show the difference.
5. Milestones with % complete and a simple Gantt bar view.
Finish: migration, seed one active project "Uriri Day Secondary Classrooms" with a 30-line BQ, CHANGELOG. Tell me how to test.
