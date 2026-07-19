# Database setup

1. Set `DATABASE_URL` and `DIRECT_URL` in `apps/api/.env` (copy `.env.example`).
   Both point at the same database, but see step 2's note on why they end up
   using different roles once you're done.
2. Generate the client and create the initial migration (uses `DIRECT_URL` -
   run this with `DATABASE_URL`/`DIRECT_URL` still pointing at your DB's
   owner/admin role, since it needs to create tables):
   ```
   pnpm --filter api exec prisma migrate dev --name init
   ```
3. Apply Row-Level Security policies (Prisma has no RLS DSL — this is a
   separate, hand-written SQL file, see `rls.sql` for why each policy is
   shaped the way it is):
   ```
   pnpm --filter api exec prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma
   ```
4. **Create the least-privilege app role** (`prisma/create-app-role.sql`) and
   point `DATABASE_URL` at it. This step is not optional on a managed
   Postgres like Neon: the default owner role is granted `BYPASSRLS`, which
   makes Postgres skip every RLS policy for that role regardless of `FORCE
   ROW LEVEL SECURITY` — the tenant isolation boundary silently does nothing
   if the app connects as the owner. Set a real password in the file first,
   run it (still connected as the owner), then update `DATABASE_URL` in
   `.env` to use `zaroda_app` instead — keep `DIRECT_URL` on the owner role
   for future migrations:
   ```
   pnpm --filter api exec prisma db execute --file prisma/create-app-role.sql --schema prisma/schema.prisma
   ```
5. Seed a demo tenant (org + branch + terminal + owner user) — run this
   *after* step 4, since it exercises the same RLS-scoped write path the
   app uses at runtime:
   ```
   pnpm --filter api exec prisma db seed
   ```

Re-run step 3 after any migration that adds a new tenant-owned table —
`prisma migrate dev` does not know about `rls.sql` and will not re-apply it
for you. `ALTER DEFAULT PRIVILEGES` in `create-app-role.sql` means new
tables get the right grants automatically, but you still need to add their
policies by hand.

## Verifying RLS is actually enforced

It's easy to get this wrong in a way that looks fine (queries succeed,
correct-looking data comes back) while RLS is silently not applying at all
- that's exactly what happened during initial setup here (owner role +
`BYPASSRLS`). Sanity check after any policy change:

```js
const prisma = new PrismaClient(); // DATABASE_URL should be the zaroda_app role
const rows = await prisma.$queryRaw`SELECT id FROM <tenant_owned_table>`;
// Expect 0 rows with no tenant context established - if you see rows here,
// something (wrong role, missing FORCE, wrong column name) is wrong.
```
