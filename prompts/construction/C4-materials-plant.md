# C4 — Materials, Procurement, Plant

Specs: 01 (section 6), 02 (requisitions/LPO/GRN rows), 03 (Materials & plant).
REUSE existing products, suppliers and stock movements — add a SITE stock location per project, do not duplicate inventory.
Build:
1. Requisition → approval (approval limits, creator cannot approve) → LPO (printable PDF, brand colours) → GRN (part deliveries).
2. Site stock per project; material issues linked to BQ items.
3. Material reconciliation report: BQ qty vs ordered vs delivered vs issued vs balance, wastage %.
4. Plant register (owned/hired), daily plant logs with hours and fuel; plant cost per project.
Finish: migration, seed cement/steel/ballast flow for the demo project, CHANGELOG. Tell me how to test.
