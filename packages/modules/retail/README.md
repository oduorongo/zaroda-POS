# @zaroda/retail-module

**This package is intentionally empty, and that's a documented deviation
from the original plan, not an oversight.**

The original Phase 1 plan (see the earlier version of this file, still in
git history) was for retail-specific features - promotions/discounts,
loyalty points, layaway - to live here as a package registering a
manifest against `ModuleRegistryService`, per DESIGN.md §3's module
contract. In practice, all three were built directly into core services
instead (`SalesService`'s discount/loyalty handling, `CustomersService`,
`LayawaysService`) during Phase 2, without ever going through this
package or the manifest contract.

**Why that happened**: those features aren't actually retail-*specific*
in the way DESIGN.md's manifest examples (a restaurant's table
management, a pharmacy's batch/expiry rules) are - a salon or pharmacy
tenant plausibly wants discounts and loyalty points too. Modeling them as
a "retail module" would have meant either duplicating them into every
other vertical's package, or having non-retail modules depend on the
retail module (violating the "core never imports from a vertical, and
verticals never import from each other" rule this contract exists to
enforce). They belong in core because they're genuinely core-general
functionality that happened to ship first, not because the module
boundary was skipped for convenience.

**What this means for the module contract's validity**: it means Retail
never actually exercised `ModuleRegistryService`/`IndustryModuleManifest`
end-to-end - Phase 1-2's features simply didn't need it. The first real,
live proof that a vertical can extend core through the manifest/hook
contract without core changes is `packages/modules/restaurant` (Phase
4), not this package. If a genuinely retail-only feature is ever
identified (e.g. something SKU/barcode-scanning-specific that a service
business would never need), it belongs here; nothing has needed it yet.
