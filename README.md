# ZARODA POS

Multi-industry, multi-tenant Point of Sale platform. See [DESIGN.md](./DESIGN.md)
for the architecture (module contract, entity model, ERD, offline sync
strategy) and the build roadmap.

## Status

**Phase 0 — Foundation** (in progress). Scaffolded so far:

- pnpm monorepo (`apps/api` — NestJS core; `apps/backoffice` and
  `apps/terminal-pwa` are not scaffolded yet, planned for Phase 1).
- Prisma schema for the core entity model (`apps/api/prisma/schema.prisma`).
- Row-Level Security policies for tenant isolation (`apps/api/prisma/rls.sql`)
  — see that file's comments for the login-bootstrap exception and why it's
  scoped the way it is.
- Auth: JWT login + PIN quick-login (shared-terminal cashier switching),
  RBAC guard, global `JwtAuthGuard`/`RolesGuard`.
- Tenant context: `AsyncLocalStorage`-based request scoping +
  `TenantScopedPrismaService.run()`, which sets the RLS session variable
  before every tenant-scoped query.
- `ModuleRegistryService` + `IndustryModuleManifest` — the module contract
  from DESIGN.md §3. No vertical modules registered yet (Phase 1: retail).
- CI (`.github/workflows/ci.yml`): install, `prisma generate`, typecheck,
  unit tests. E2E tests need a real database and aren't wired into CI yet.

## Getting started

```
pnpm install
cp apps/api/.env.example apps/api/.env   # then set DATABASE_URL, JWT_SECRET
```

Then see [apps/api/prisma/README.md](./apps/api/prisma/README.md) for the
database setup order (migrate → apply RLS → seed).

```
pnpm --filter api start:dev
```

## Repo layout

```
apps/
  api/              NestJS core (modular monolith)
  backoffice/        Next.js back-office UI          [Phase 1]
  terminal-pwa/       Offline-capable POS terminal    [Phase 1]
packages/
  modules/
    retail/          First vertical module            [Phase 1]
```
