import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Automates the manual audit this file replaces: every tenant-owned table
 * must have a matching RLS policy in prisma/rls.sql, and `prisma migrate
 * dev` has no idea rls.sql exists (see prisma/README.md's own warning) - a
 * new migration can add a table and the app will run fine, look correct,
 * and silently leak cross-tenant data the first time someone forgets the
 * manual "re-run rls.sql" step. This test fails the build the moment a new
 * `@@map(...)` table appears in schema.prisma without a corresponding
 * `ENABLE ROW LEVEL SECURITY` in rls.sql, instead of relying on a human to
 * remember during review.
 *
 * No database needed - this only parses the two source files, so it runs
 * under the fast `pnpm test` unit suite, not just the DB-backed
 * `pnpm test:e2e` (see rls-isolation.e2e-spec.ts for the suite that
 * actually proves a policy works, not just that one exists).
 */

// Tables deliberately excluded from tenant RLS, each with its own
// justification documented inline in rls.sql - kept in sync with that
// file's own "── X itself ──" / "needs a deliberate, narrow exception"
// comments, not re-derived from schema.prisma (there's no reliable way to
// infer "intentionally cross-tenant" purely from field shape).
const INTENTIONALLY_EXCLUDED = new Set([
  // A user account can belong to multiple organizations (org_users is the
  // tenant-scoped join table) - see rls.sql's "users itself" comment.
  'users',
  // The platform-admin app's own schema - internal, cross-tenant tooling
  // that connects as a separate BYPASSRLS role, never tenant-facing.
  'platform_admins',
  'platform_audit_log',
]);

function extractMappedTables(schemaSource: string): string[] {
  const matches = schemaSource.matchAll(/@@map\("(\w+)"\)/g);
  return Array.from(matches, (m) => m[1]);
}

function extractRlsEnabledTables(rlsSource: string): Set<string> {
  const matches = rlsSource.matchAll(
    /ALTER TABLE (\w+) ENABLE ROW LEVEL SECURITY/g,
  );
  return new Set(Array.from(matches, (m) => m[1]));
}

describe('RLS policy coverage (static audit)', () => {
  const schemaSource = readFileSync(
    join(__dirname, '../../../prisma/schema.prisma'),
    'utf-8',
  );
  const rlsSource = readFileSync(
    join(__dirname, '../../../prisma/rls.sql'),
    'utf-8',
  );

  const mappedTables = extractMappedTables(schemaSource);
  const rlsEnabledTables = extractRlsEnabledTables(rlsSource);

  it('found a plausible number of mapped tables (sanity check the parser itself)', () => {
    // Guards against a schema.prisma refactor silently changing the
    // @@map(...) syntax in a way that makes the regex above match nothing -
    // every other assertion in this file would then vacuously pass.
    expect(mappedTables.length).toBeGreaterThan(40);
  });

  it('found a plausible number of RLS-enabled tables (sanity check the parser itself)', () => {
    expect(rlsEnabledTables.size).toBeGreaterThan(40);
  });

  for (const table of extractMappedTables(
    readFileSync(join(__dirname, '../../../prisma/schema.prisma'), 'utf-8'),
  )) {
    if (INTENTIONALLY_EXCLUDED.has(table)) continue;
    it(`${table} has a matching RLS policy in rls.sql`, () => {
      expect(rlsEnabledTables.has(table)).toBe(true);
    });
  }

  it('every intentionally-excluded table is still actually absent from rls.sql (catches a stale exclusion list)', () => {
    for (const table of INTENTIONALLY_EXCLUDED) {
      expect(rlsEnabledTables.has(table)).toBe(false);
    }
  });

  it('every intentionally-excluded table still exists in schema.prisma (catches a stale exclusion list)', () => {
    for (const table of INTENTIONALLY_EXCLUDED) {
      expect(mappedTables).toContain(table);
    }
  });
});
