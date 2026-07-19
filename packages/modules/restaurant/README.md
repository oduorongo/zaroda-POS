# Restaurant vertical module

**This package is intentionally empty - the actual implementation lives at
`apps/api/src/restaurant/`, not here.**

DESIGN.md §3 describes vertical modules as separate `packages/modules/<vertical>`
packages depending on core, never the reverse. Building that as a *literal*
separately-compiled pnpm package (its own `package.json`, `tsconfig.json`,
build step, workspace-linked into `apps/api`) is real infrastructure work -
build ordering, path resolution, a second compile step - that every other
"module" in this codebase (Sales, Inventory, Layaways, Customers...) never
needed, because they all live directly under `apps/api/src/*` as ordinary
NestJS modules within the one deployable (DESIGN.md §1: "modular monolith,
one deployable").

**The pragmatic call made here**: enforce the *dependency-direction* rule
that actually matters (core services never import from `restaurant/`;
`restaurant/` imports core services like `SalesService` freely) as a
logical/code-review boundary within the single `apps/api` compile, rather
than standing up a second physical package for a boundary the existing
codebase doesn't otherwise use. `apps/api/src/restaurant/` registers a
manifest with `ModuleRegistryService` exactly per the contract - the
*contract* is honored; only its physical packaging is pragmatically
simplified to match how everything else in this repo is actually built.

If a second vertical after this one reveals a real need for physical
package separation (e.g. wanting to compile/deploy a module independently,
or open-source one vertical without the others), that's the point to
revisit this - not before, on the theory it might matter later.
