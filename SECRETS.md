# Secrets management

## Current state (local dev / this pilot)

Every secret this app needs is read from environment variables, loaded
locally from `apps/api/.env` (see `apps/api/.env.example` for the full,
documented list: `DATABASE_URL`/`DIRECT_URL`, `JWT_SECRET`,
`PLATFORM_ADMIN_JWT_SECRET`, `MPESA_*`, `AFRICAS_TALKING_*`, `SENTRY_DSN`,
`OTEL_EXPORTER_OTLP_ENDPOINT`). `.env` is gitignored and has never been
committed - verified with `git log --all -- apps/api/.env` (empty
history). CI (`.github/workflows/ci.yml`) uses throwaway, CI-only values
for the two JWT secrets and the ephemeral Postgres/Redis passwords in its
service containers, never anything real.

This is adequate for a single-environment pilot with no deployment
pipeline yet, but **`.env` files are not how secrets should reach a real
production deployment** - they end up in shell history, CI logs, or a
container image layer too easily, and there's no rotation, access
control, or audit trail on who read what and when.

## Intended production approach

None of the following is wired up yet - there's no deployment pipeline or
cloud account in this environment to configure it against. This section
exists so the intent is explicit rather than left to be guessed at later.

Pick **one** of these, matching whatever the actual hosting platform ends
up being:

- **AWS Secrets Manager** (if deploying to AWS/ECS/EKS) - secrets injected
  as environment variables at container start via the task definition's
  `secrets` block (ECS) or an init-container/CSI driver (EKS), never baked
  into the image. Rotation can be automated per-secret.
- **GCP Secret Manager** (if deploying to GCP/Cloud Run/GKE) - same
  pattern, referenced via `--set-secrets` (Cloud Run) or the Secret
  Manager CSI driver (GKE).
- **HashiCorp Vault** (if self-hosting or multi-cloud) - the API/worker
  processes would fetch secrets at startup via a Vault Agent sidecar
  writing them to a file NestJS's `ConfigModule` reads, or a short-lived
  token exchanged for secrets directly.

In every case, the rule stays the same as it is locally: secrets are
**injected at deploy/start time**, never committed, never baked into a
built image, and the app's own code keeps reading them the exact same way
it does today - `ConfigService.get()`/`getOrThrow()` - so switching
providers later is an infrastructure change, not a code change.

## What counts as a secret in this app

| Variable | Sensitivity | Notes |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | High | DB credentials - `DATABASE_URL` must be the least-privilege `zaroda_app` role, never the owner (see `apps/api/prisma/README.md`) |
| `JWT_SECRET` / `PLATFORM_ADMIN_JWT_SECRET` | High | Deliberately separate secrets - a leak of one must not compromise the other (see `platform-admin.module.ts`'s own comment) |
| `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY` | High | Daraja credentials - real money movement |
| `AFRICAS_TALKING_API_KEY` | Medium | SMS sending - abuse risk (spam/cost), not a financial or data-access risk |
| `SENTRY_DSN` | Low | Not itself sensitive, but should still be provisioned the same way as everything else for consistency |
