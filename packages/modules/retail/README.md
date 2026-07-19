# @zaroda/retail-module

Placeholder — this is where the retail vertical module (Phase 1) will live:
promotions/discount engine, loyalty points, layaway, plus a manifest
registered against `ModuleRegistryService` per the contract in
`apps/api/src/module-registry/industry-module-manifest.interface.ts`
(see DESIGN.md §3).

Not implemented yet. Phase 1 is: catalog, inventory ledger, sales pipeline
(cash + M-Pesa), shifts, core reporting, audit log, and the terminal PWA —
built as core capabilities first. Only once those exist does this package
get filled in with retail-specific extensions on top.
