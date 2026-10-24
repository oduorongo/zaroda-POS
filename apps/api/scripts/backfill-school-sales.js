// One-off: gives every school invoice raised BEFORE "school invoices appear in Sales" shipped its ordinary sale, exactly as
// SchoolOrdersService.deliver now does (see school-sale.ts). Without it, an old school invoice is in the school's account and
// the profit report but not in Sales or the sales reports.
//
//   node scripts/backfill-school-sales.js            -> DRY RUN: lists what it would add, changes nothing
//   node scripts/backfill-school-sales.js --apply    -> adds them, in ONE transaction (all or nothing)
//
// Reads DIRECT_URL (the owner connection) from .env, or from ENV_FILE. Safe to run twice: an invoice that already has a sale is
// skipped, and the sale's clientId is unique per invoice. The branch is the one the goods were taken from (found in the stock
// ledger); sales are credited to the business's OWNER account. The profit report stops counting an invoice by itself once it has
// a sale, so nothing is counted twice.
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR, 'C:/Users/user/OneDrive/Desktop/zaroda  school/backend'] }));
const { randomUUID } = require('crypto');

const env = {};
for (const line of fs.readFileSync(path.join(API_DIR, process.env.ENV_FILE || '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const APPLY = process.argv.includes('--apply');
const LABEL = 'School credit sales';

(async () => {
  const c = new Client({ connectionString: env.DIRECT_URL, ssl: /localhost/.test(env.DIRECT_URL) ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
  await c.connect();
  try {
    const cols = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'supplier_invoices' AND column_name = 'saleId'`);
    if (cols.rowCount === 0) throw new Error('the database does not have supplier_invoices.saleId yet - apply the migration first');

    const invoices = (
      await c.query(
        `SELECT i.id, i."organizationId", i."invoiceNumber", i.total::float AS total, i."createdAt", i."orderId", i."deliveryId"
           FROM supplier_invoices i
          WHERE i."saleId" IS NULL AND i.status <> 'VOID'
          ORDER BY i."createdAt"`,
      )
    ).rows;
    console.log(`${invoices.length} school invoice(s) have no sale yet:`);
    for (const i of invoices) console.log(`  ${i.invoiceNumber}  KES ${i.total}`);
    if (invoices.length === 0 || !APPLY) {
      console.log(APPLY ? 'nothing to do.' : '\nDRY RUN - nothing was changed. Run again with --apply to add them.');
      return;
    }

    await c.query('BEGIN');
    for (const i of invoices) {
      const owner = (await c.query(`SELECT id FROM org_users WHERE "organizationId" = $1 AND role = 'OWNER' ORDER BY "createdAt" LIMIT 1`, [i.organizationId])).rows[0];
      if (!owner) throw new Error(`no OWNER account found for the business of ${i.invoiceNumber}`);

      // the branch the goods came out of: the stock ledger names the delivery (or, for the oldest ones, the order)
      let branch = (
        await c.query(`SELECT "branchId" FROM inventory_transactions WHERE type = 'CREDIT_SALE' AND "referenceId" IN ($1, $2) ORDER BY "createdAt" LIMIT 1`, [i.deliveryId ?? '-', i.orderId ?? '-'])
      ).rows[0]?.branchId;
      if (!branch) branch = (await c.query(`SELECT id FROM branches WHERE "organizationId" = $1 ORDER BY "createdAt" LIMIT 1`, [i.organizationId])).rows[0]?.id;
      if (!branch) throw new Error(`no branch found for ${i.invoiceNumber}`);

      let terminal = (await c.query(`SELECT id FROM terminals WHERE "branchId" = $1 AND "deviceLabel" = $2 LIMIT 1`, [branch, LABEL])).rows[0];
      if (!terminal) terminal = (await c.query(`INSERT INTO terminals (id, "branchId", "deviceLabel") VALUES ($1, $2, $3) RETURNING id`, [randomUUID(), branch, LABEL])).rows[0];
      let session = (await c.query(`SELECT id FROM cashier_sessions WHERE "terminalId" = $1 AND "orgUserId" = $2 AND "pinEndedAt" IS NULL LIMIT 1`, [terminal.id, owner.id])).rows[0];
      if (!session) session = (await c.query(`INSERT INTO cashier_sessions (id, "terminalId", "orgUserId") VALUES ($1, $2, $3) RETURNING id`, [randomUUID(), terminal.id, owner.id])).rows[0];

      const saleId = randomUUID();
      await c.query(
        `INSERT INTO sales (id, "organizationId", "branchId", "terminalId", "cashierSessionId", "cashierOrgUserId", "clientId", status, total, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9)`,
        [saleId, i.organizationId, branch, terminal.id, session.id, owner.id, 'school-invoice-' + i.id, i.total, i.createdAt],
      );
      // lines that name a product (an invoice line always does, but be safe)
      await c.query(
        `INSERT INTO sale_line_items (id, "saleId", "variantId", quantity, "unitPrice", "taxAmount")
         SELECT gen_random_uuid()::text, $1, "variantId", quantity, "unitPrice", "taxAmount" FROM supplier_invoice_lines WHERE "invoiceId" = $2 AND "variantId" IS NOT NULL`,
        [saleId, i.id],
      );
      await c.query(
        `INSERT INTO sale_payments (id, "saleId", method, amount, "createdAt") VALUES ($1, $2, 'ACCOUNT', $3, $4)`,
        [randomUUID(), saleId, i.total, i.createdAt],
      );
      const linked = await c.query(`UPDATE supplier_invoices SET "saleId" = $1 WHERE id = $2 AND "saleId" IS NULL`, [saleId, i.id]);
      if (linked.rowCount !== 1) throw new Error(`could not link ${i.invoiceNumber}`);
      console.log(`  added a sale for ${i.invoiceNumber}`);
    }
    await c.query('COMMIT');
    console.log('done - all added.');
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error('STOPPED (nothing was changed):', String(e.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]'));
  process.exit(1);
});
