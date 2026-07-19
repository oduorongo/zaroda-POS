# Database setup

1. Set `DATABASE_URL` in `apps/api/.env` (copy `.env.example`) to a Postgres instance.
2. Generate the client and create the initial migration:
   ```
   pnpm --filter api exec prisma migrate dev --name init
   ```
3. Apply Row-Level Security policies (Prisma has no RLS DSL — this is a
   separate, hand-written SQL file, see `rls.sql` for why each policy is
   shaped the way it is):
   ```
   pnpm --filter api exec prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma
   ```
4. Seed a demo tenant (org + branch + terminal + owner user):
   ```
   pnpm --filter api exec prisma db seed
   ```

Re-run step 3 after any migration that adds a new tenant-owned table —
`prisma migrate dev` does not know about `rls.sql` and will not re-apply it
for you.
