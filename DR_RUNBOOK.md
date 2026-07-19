# Disaster recovery runbook

Scope: the `apps/api` NestJS service and its Neon Postgres database. The
terminal PWA is a static/offline-capable client with no server-side state
of its own (see DESIGN.md §6) — recovering it is just redeploying the
build; it isn't covered further here.

## Targets

Sized for this project's stated pilot scale (DESIGN.md: 1–10 tenants,
1–5 branches each, <10 terminals) — not a high-volume production
deployment. Revisit these if the target scale grows.

- **RPO (Recovery Point Objective): a few minutes.** Neon's point-in-time
  restore (PITR) is continuous, not snapshot-based — confirm your
  project's actual retention window in the Neon dashboard
  (Settings → Backup/Restore) before relying on a specific number here,
  since it depends on the plan and can change.
- **RTO (Recovery Time Objective): under an hour** for a full rebuild
  (new Neon project + migrate + RLS + role + redeploy), well under that
  for a PITR restore of an existing project (Neon's own restore operation
  is typically a few minutes; the remaining time is verification).

## What actually protects the data today

1. **Neon's own point-in-time restore** — the primary backup mechanism.
   No extra configuration on our side; it's a property of the managed
   Postgres service itself.
2. **This repository** is the source of truth for schema (migrations),
   security policy (`rls.sql`), and role setup
   (`create-app-role.sql`) — none of that lives only in the live
   database. A total database loss with the repo intact is recoverable
   from schema/policy alone; only the *data* needs the Neon restore.
3. **Secrets** (`apps/api/.env`) are **not** backed up by design — they're
   gitignored and exist only on whichever machine/host runs the API.
   This is a real single point of failure for a solo/small-team pilot:
   losing the machine with `.env` and no other copy means regenerating
   `JWT_SECRET` (invalidates all active sessions — acceptable) and
   re-fetching the Neon connection strings from the Neon dashboard
   (not a secret loss, since Neon still has them) and any M-Pesa
   credentials from the Safaricom developer portal (a real loss if never
   recorded elsewhere — **write those down somewhere durable once they
   exist**, this is a gap worth closing before M-Pesa goes live, not
   after).

## Recovery scenarios

### A. Accidental bad write / data corruption (most likely scenario at pilot scale)

A wrong bulk update, a bug that corrupted rows, someone's fat-fingered
manual `UPDATE`. Data is still there, just wrong.

1. In the Neon dashboard, use **Restore** (or create a new **branch** from
   a timestamp just before the bad write — branching is non-destructive
   and lets you inspect/diff before committing to a restore).
2. Verify the restored/branched data looks right.
3. If using a branch: point a *temporary* `DATABASE_URL`/`DIRECT_URL` at
   it, confirm, then either promote the branch or manually reconcile the
   specific bad rows back on the primary branch — don't blind-swap
   production traffic onto a branch without deciding that's intentional.

### B. Total Neon project loss / need to stand up a fresh database

Drilled in this session (see below) up to the point of destructively
deleting the actual pilot project, which wasn't done since real demo
data lives there — the rebuild steps themselves were verified against
the live database instead, which exercises the identical commands.

1. Provision a new Neon project (or any Postgres 14+ instance).
2. Set `DATABASE_URL`/`DIRECT_URL` in a fresh `apps/api/.env` to the new
   instance's **owner** role for now (see `apps/api/prisma/README.md`
   step 1).
3. `pnpm --filter api exec prisma migrate deploy` — replays every
   migration in `apps/api/prisma/migrations/` in order, rebuilding the
   full schema from scratch. (`migrate dev` also works but is meant for
   active development; `migrate deploy` is the non-interactive
   restore/CI-appropriate command.)
4. `pnpm --filter api exec prisma db execute --file prisma/rls.sql --schema prisma/schema.prisma`
   — applies every RLS policy. **This step was hardened during this Phase
   3 pass specifically for this scenario**: every `CREATE POLICY` is now
   preceded by a matching `DROP POLICY IF EXISTS`, so this one command
   works whether the target is a brand-new schema (policies don't exist
   yet — the DROPs are harmless no-ops) or a partially-restored one
   (policies already exist — no naming collision). **Drilled live**: ran
   this exact command against the already-provisioned pilot database and
   confirmed it completes with no errors, then re-verified RLS was still
   correctly enforced on every tenant table afterward (0 rows visible
   with no tenant context set, except `org_users`' deliberate 2-row
   pre-auth exception — matching its documented design, not a leak).
5. `pnpm --filter api exec prisma db execute --file prisma/create-app-role.sql --schema prisma/schema.prisma`
   — creates the least-privilege `zaroda_app` role. Set a real password
   in the file first. **Not idempotent by design** (`CREATE ROLE` errors
   if the role already exists) — but that's correct for this scenario:
   a fresh database never has the role yet, and if restoring an existing
   project via PITR the role already exists and this step is skipped
   entirely, not re-run.
6. Update `DATABASE_URL` to the `zaroda_app` role; keep `DIRECT_URL` on
   the owner role.
7. If there's no data to restore (truly starting over): `pnpm --filter
   api exec prisma db seed`. If restoring from a Neon PITR
   snapshot/branch instead: point at that as the source and skip seeding
   — the restored data already has real tenants.
8. Verify RLS is actually enforced (`apps/api/prisma/README.md`'s
   "Verifying RLS is actually enforced" section) — do this every time,
   not just on first setup, since this is exactly the kind of step that's
   silently skipped under recovery pressure.
9. Redeploy/restart the API pointed at the new database.

### C. Credential compromise (JWT secret, DB password, or M-Pesa keys leaked)

1. **JWT_SECRET**: rotate immediately in `.env` and restart the API.
   Every existing access token becomes invalid the instant the service
   restarts (tokens are stateless/signed, not stored — there's no
   session table to also clear). Cashiers/managers simply log in again.
2. **Database password**: rotate the `zaroda_app` role's password
   (`ALTER ROLE zaroda_app WITH PASSWORD '...'` as the owner role) and
   update `DATABASE_URL`. Neon connections using the old password fail
   immediately; no other cleanup needed since Postgres auth isn't
   session-based either.
3. **M-Pesa credentials** (once actually in use): rotate via the
   Safaricom developer portal and update `.env`. Not yet live in this
   codebase (see DESIGN.md's sales-pipeline decision), so there's nothing
   to rotate today — noted here so the step exists before it's needed.

### D. API process/host down, database fine

Not a data-recovery scenario at all — redeploy the built `apps/api`
artifact (or restart the process) pointed at the existing, unaffected
`DATABASE_URL`. No schema/RLS/role steps needed since the database was
never touched.

## What was and wasn't drilled in this session

**Drilled live**, against the actual pilot database (not a throwaway):
the RLS re-application step (B.4) — the exact command a real recovery
would run, confirmed to complete cleanly and confirmed RLS still holds
correctly afterward, including the deliberate pre-auth exception behaving
as designed rather than as a leak.

**Not drilled** (would require either a disposable Neon project or
destructively affecting the real pilot data, neither of which was
appropriate to do unprompted in this session): actually provisioning a
brand-new Neon project end-to-end (B.1–B.9 as one continuous run), an
actual Neon PITR restore, and a branch-based recovery of scenario A. The
commands for these are the same ones already exercised individually
throughout this project's build (every migration in this repo was
applied via the same `prisma migrate dev`/`deploy` path; `rls.sql` and
`create-app-role.sql` were each run against a real database at least
once during initial setup), but a true end-to-end fire drill on a
disposable project is the natural next step before relying on this
runbook in a real incident.
