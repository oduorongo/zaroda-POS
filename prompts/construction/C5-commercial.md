# C5 — Commercial: Valuations, IPCs, Variations, Retention, Subcontracts

Specs: 01 (section 7), 03 (BQ & commercial), 04 (retention, KRA, immutability).
Build:
1. Valuations measured against BQ items + approved variations + materials on site; auto-calc retention (rate & cap from project), advance recovery, less previous certified, net due.
2. Flow DRAFT → SUBMITTED → CERTIFIED (by client's QS) → PAID. Certified = locked; corrections via a new reversing valuation.
3. Variations register linked to site instructions; approved variations update revisedSum.
4. Retention ledger with release actions (practical completion %, end of DLP).
5. Certified IPC → invoice through the EXISTING eTIMS integration; record WHT/withholding-VAT certificates and reconcile payment received (M-Pesa/bank).
6. Subcontracts with their own valuations and retention.
7. Printable IPC/valuation PDF.
Write unit tests for the valuation maths (retention cap, previous certified, variations). Finish: migration, seed 2 certified valuations, CHANGELOG.
