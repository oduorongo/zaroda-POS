// One-off: gives every online order that was ACCEPTED before "online orders appear in Sales" shipped
// its normal till sale, exactly as OnlineOrdersService.accept now does (see online-order-sale.ts).
//
//   node scripts/backfill-online-sales.js            -> DRY RUN: lists what it would add, changes nothing
//   node scripts/backfill-online-sales.js --apply    -> adds them, in ONE transaction (all or nothing)
//
// Reads DIRECT_URL (the owner connection) from .env, or from ENV_FILE. Safe to run twice: an order
// that already has a sale is skipped, and the sale's clientId is unique per order.
// Sales are credited to the business's OWNER account (the accepting staff member isn't recorded on old orders).
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
const LABEL = 'Online shop';

(async () => {
  const c = new Client({ connectionString: env.DIRECT_URL, ssl: /localhost/.test(env.DIRECT_URL) ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 });
  await c.connect();
  try {
    const cols = await c.query(`SELECT 1 FROM information_schema.columns WHERE table_name = 'online_orders' AND column_name = 'saleId'`);
    if (cols.rowCount === 0) throw new Error('the database does not have online_orders.saleId yet - apply the migration first');

    const orders = (
      await c.query(
        `SELECT id, "organizationId", "branchId", "orderNumber", subtotal::float AS subtotal, "mpesaReceiptNumber" AS receipt, "acceptedAt", "paidAt", "createdAt"
           FROM online_orders
          WHERE "saleId" IS NULL AND "stockCommitted" = true AND status IN ('ACCEPTED', 'READY', 'COMPLETED')
          ORDER BY "createdAt"`,
      )
    ).rows;
    console.log(`${orders.length} accepted online order(s) have no sale yet:`);
    for (const o of orders) console.log(`  ${o.orderNumber}  KES ${o.subtotal}  receipt ${o.receipt}`);
    if (orders.length === 0 || !APPLY) {
      console.log(APPLY ? 'nothing to do.' : '\nDRY RUN - nothing was changed. Run again with --apply to add them.');
      return;
    }

    await c.query('BEGIN');
    for (const o of orders) {
      const owner = (await c.query(`SELECT id FROM org_users WHERE "organizationId" = $1 AND role = 'OWNER' ORDER BY "createdAt" LIMIT 1`, [o.organizationId])).rows[0];
      if (!owner) throw new Error(`no OWNER account found for the business of ${o.orderNumber}`);

      let terminal = (await c.query(`SELECT id FROM terminals WHERE "branchId" = $1 AND "deviceLabel" = $2 LIMIT 1`, [o.branchId, LABEL])).rows[0];
      if (!terminal) terminal = (await c.query(`INSERT INTO terminals (id, "branchId", "deviceLabel") VALUES ($1, $2, $3) RETURNING id`, [randomUUID(), o.branchId, LABEL])).rows[0];
      let session = (await c.query(`SELECT id FROM cashier_sessions WHERE "terminalId" = $1 AND "orgUserId" = $2 AND "pinEndedAt" IS NULL LIMIT 1`, [terminal.id, owner.id])).rows[0];
      if (!session) session = (await c.query(`INSERT INTO cashier_sessions (id, "terminalId", "orgUserId") VALUES ($1, $2, $3) RETURNING id`, [randomUUID(), terminal.id, owner.id])).rows[0];

      const when = o.acceptedAt || o.paidAt || o.createdAt;
      const saleId = randomUUID();
      await c.query(
        `INSERT INTO sales (id, "organizationId", "branchId", "terminalId", "cashierSessionId", "cashierOrgUserId", "clientId", status, total, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'COMPLETED', $8, $9)`,
        [saleId, o.organizationId, o.branchId, terminal.id, session.id, owner.id, 'online-order-' + o.id, o.subtotal, when],
      );
      await c.query(
        `INSERT INTO sale_line_items (id, "saleId", "variantId", quantity, "unitPrice", "taxAmount")
         SELECT gen_random_uuid()::text, $1, "variantId", quantity, "unitPrice", 0 FROM online_order_lines WHERE "orderId" = $2`,
        [saleId, o.id],
      );
      await c.query(
        `INSERT INTO sale_payments (id, "saleId", method, amount, "providerReference", "settlementCurrency", "settlementAmount", "createdAt")
         VALUES ($1, $2, 'MPESA', $3, $4, 'KES', $3, $5)`,
        [randomUUID(), saleId, o.subtotal, o.receipt, when],
      );
      const linked = await c.query(`UPDATE online_orders SET "saleId" = $1 WHERE id = $2 AND "saleId" IS NULL`, [saleId, o.id]);
      if (linked.rowCount !== 1) throw new Error(`could not link ${o.orderNumber}`);
      console.log(`  added a sale for ${o.orderNumber}`);
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
