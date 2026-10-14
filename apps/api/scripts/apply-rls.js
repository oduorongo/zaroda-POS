// Applies prisma/rls.sql (the row-level security rules) to the database named by DIRECT_URL in apps/api/.env,
// as the owner, in ONE transaction - all or nothing - and then proves no table's row count changed.
// rls.sql is written to be re-run safely, and "prisma migrate deploy" never applies it, so run this
// right after a migration that adds tables:
//
//   cd apps/api
//   npx prisma migrate deploy
//   node scripts/apply-rls.js
//
// It refuses to run a file containing DROP TABLE / DROP DATABASE / TRUNCATE / DELETE FROM.
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
// pg is not a direct dependency of the API (Prisma has its own engine), so borrow it from wherever it exists.
let pgPath;
for (const dir of [API_DIR, path.join(API_DIR, '..', '..'), 'C:/Users/user/OneDrive/Desktop/zaroda  school/backend']) {
  try {
    pgPath = require.resolve('pg', { paths: [dir] });
    break;
  } catch {
    /* try the next place */
  }
}
if (!pgPath) throw new Error('The "pg" package was not found. Run "pnpm install" at the project root, then try again.');
const { Client } = require(pgPath);

const env = {};
for (const line of fs.readFileSync(path.join(API_DIR, process.env.ENV_FILE || '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
if (!env.DIRECT_URL) throw new Error('DIRECT_URL is not set in apps/api/.env');

const file = process.argv[2] || path.join(API_DIR, 'prisma', 'rls.sql');
const sql = fs.readFileSync(file, 'utf8');
if (/\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(sql)) {
  throw new Error('REFUSING: the file contains a destructive statement (DROP TABLE/DATABASE, TRUNCATE or DELETE)');
}

const counts = async (c) => {
  const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '\\_%' ORDER BY 1`)).rows.map((r) => r.tablename);
  const out = {};
  for (const t of tables) out[t] = (await c.query(`SELECT count(*)::int AS n FROM "${t}"`)).rows[0].n;
  return out;
};
const rlsCount = async (c) => (await c.query(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public' AND rowsecurity`)).rows[0].n;

(async () => {
  const local = /localhost|127\.0\.0\.1/.test(env.DIRECT_URL);
  const c = new Client({ connectionString: env.DIRECT_URL, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
  await c.connect();
  try {
    const before = await counts(c);
    const rlsBefore = await rlsCount(c);
    console.log(`before: ${Object.keys(before).length} tables, ${rlsBefore} with row-level security`);
    try {
      await c.query('BEGIN');
      await c.query(sql);
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw new Error('the SQL failed and was ROLLED BACK - nothing changed: ' + e.message);
    }
    const after = await counts(c);
    const changed = Object.keys(before).filter((t) => before[t] !== after[t]);
    console.log(`after : ${Object.keys(after).length} tables, ${await rlsCount(c)} with row-level security`);
    console.log(changed.length ? `!! row counts CHANGED in: ${changed.join(', ')}` : `all ${Object.keys(before).length} tables have exactly the same row counts as before`);
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('STOPPED:', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]'));
  process.exit(1);
});
