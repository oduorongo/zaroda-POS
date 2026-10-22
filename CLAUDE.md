# CLAUDE.md

Rules for every session in this repo (ZARODA POS: NestJS API in `apps/api`, Next.js apps in `apps/*`, shared UI in `packages/ui`, pnpm workspaces). Background: `README.md`, `DESIGN.md`, `apps/api/prisma/README.md`, `apps/api/prisma/rls.sql`.

## Security and tenancy

- Every tenant-owned table carries `organizationId`, or reaches it through a parent. It MUST get a matching entry in `apps/api/prisma/rls.sql`: `ENABLE` + `FORCE ROW LEVEL SECURITY`, `DROP POLICY IF EXISTS`, then `CREATE POLICY tenant_isolation` with `USING` and `WITH CHECK`. Follow the existing pattern exactly:
  ```sql
  ALTER TABLE things ENABLE ROW LEVEL SECURITY;
  ALTER TABLE things FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS tenant_isolation ON things;
  CREATE POLICY tenant_isolation ON things
    USING ("organizationId" = current_setting('app.current_tenant', true))
    WITH CHECK ("organizationId" = current_setting('app.current_tenant', true));
  ```
  Columns are camelCase and MUST be double-quoted (unquoted names silently resolve to the wrong column). A child table without its own `organizationId` filters through its parent with an `EXISTS` subquery, as the existing child tables do.
- All tenant data access goes through `TenantScopedPrismaService.run()`. Never use the raw `PrismaService` for tenant requests, except the existing public/callback patterns that set `app.current_tenant` themselves (with `set_config(..., true)`, never `false`).
- Every write endpoint has an explicit `@Roles(...)` decorator. Never loosen an existing role check without saying so in the PR.
- Every request body is a class-validator DTO with length/range limits and string trimming. Never trust ids from the client: re-load them inside the tenant transaction.
- No raw SQL string interpolation. Use Prisma or tagged `$executeRaw` / `$queryRaw` templates only.
- Money: `Decimal(12,2)` in the database, `roundMoney()` in code (see `online-orders/online-orders.util.ts`), and idempotency via a client-generated `clientId` on anything that takes payment. Payments, refunds, voids, check-in/out and status changes write an audit log entry (`AuditLogService`).
- Never log or return secrets, tokens, M-Pesa credentials or full phone numbers in errors.
- File uploads: check the content type AND the magic bytes, enforce size limits, and store via `ObjectStorageService`.
- CSV/Excel import: max 5 MB and 5,000 rows, validate every row, all-or-nothing in one transaction, return per-row errors. CSV export: neutralise cells starting with `=` `+` `-` `@` (prefix with `'`).
- Never commit `.env` files, keys or real customer data.

## Database

- Never edit an existing migration. Add a new timestamped folder under `apps/api/prisma/migrations`, newer than the latest one.
- Migrations are additive and backwards compatible: new nullable columns or columns with defaults, no dropping data.
- Prefer archiving (`isActive` / `archivedAt`) over deleting anything that sales, bookings or stock history points at.
- `prisma migrate` does not know about `rls.sql`. After a migration that adds a tenant-owned table, re-apply it with `node scripts/apply-rls.js` (in `apps/api`). That script reads `apps/api/.env`, which is the LIVE database; use `ENV_FILE=.env.local` for local testing.

## Code style

- Follow the patterns already in the module you are changing: NestJS module / controller / service / dto in the API; Next.js app router pages using the `lib/api.ts` helpers in the apps.
- Keep code short and minimal; comment only where the reason is not obvious.
- UI text is plain English for Kenyan small-business staff; amounts in KES.

## Definition of done

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- New business rules get unit tests (`*.spec.ts`) next to the service.
- Add or extend an e2e script in `apps/api/scripts/` for any new flow, following the `e2e-hotel.js` style.
- Work on a feature branch, never on `main`. Open a pull request whose description lists: what changed, new migrations, new RLS policies, new endpoints with their roles, and manual test steps.
