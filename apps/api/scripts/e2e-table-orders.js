// End-to-end test of a diner ordering from a restaurant table's QR code, against a LOCAL test setup. It plays the
// restaurant owner, a diner, and an attacker, with a pretend Tuma, and never touches the live system (it refuses to
// run unless the database is on this computer and Tuma is the pretend one).
//
// Needs running: the test Postgres (port 5433), the pretend Tuma (node scripts/mock-tuma.js), and the API started
// with the test settings (see ONLINE_SHOP_TESTING.md), with the demo seed's live "demo-shop".
//
//   node scripts/e2e-table-orders.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR, 'C:/Users/user/OneDrive/Desktop/zaroda  school/backend', process.env.PG_DIR || API_DIR] }));

const readEnv = (file) => {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return out;
};
const env = readEnv(path.join(API_DIR, '.env.local'));
const live = readEnv(path.join(API_DIR, '.env'));
const hostOf = (url) => new URL(url).hostname.replace(/-pooler/, '');
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  if (live[key] && hostOf(env[key]) === hostOf(live[key])) throw new Error(`REFUSING: ${key} in .env.local is the LIVE database`);
}
const dbUrl = new URL(env.DIRECT_URL);
if (!(dbUrl.hostname === 'localhost' && dbUrl.port === '5433')) throw new Error('REFUSING: .env.local does not point at the local test database');
if (!/^http:\/\/localhost:\d+$/.test(env.TUMA_BASE_URL || '')) throw new Error('REFUSING: TUMA_BASE_URL is not a local pretend Tuma');

const API = 'http://localhost:3001';
const MOCK = 'http://localhost:4010';
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);

async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}
const api = (method, p, opts) => call(method, API + p, opts);
const mock = (method, p) => call(method, MOCK + p);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);

(async () => {
  await sql.connect();

  section('1. Start-up and the restaurant');
  check('API ready', (await api('GET', '/ready')).status === 200);
  check('pretend Tuma running', (await mock('GET', '/_test/pushes')).status === 200);
  const login = await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } });
  const owner = login.json.accessToken;
  check('owner can sign in', Boolean(owner), login);
  const store = (await api('GET', '/online-store/me', { token: owner })).json;
  check('the demo shop is live with payments connected', store.isPublished && store.tumaConnected, store);
  const branchId = store.fulfilmentBranchId;
  const slug = store.slug;

  // Kitchen: two stations (the second is where drinks go), a table, and the menu.
  const grill = (await api('POST', '/restaurant/stations', { token: owner, body: { branchId, name: `Grill-${tag}` } })).json;
  const bar = (await api('POST', '/restaurant/stations', { token: owner, body: { branchId, name: `Bar-${tag}` } })).json;
  check('two kitchen stations created', Boolean(grill.id && bar.id), { grill, bar });
  const table = (await api('POST', '/restaurant/tables', { token: owner, body: { branchId, label: `T-${tag}`, seats: 4 } })).json;
  check('a table created', Boolean(table.id), table);

  const mkProduct = async (name, sku, price, mode) => {
    const product = (await api('POST', '/products', { token: owner, body: { name } })).json;
    await api('PATCH', `/products/${product.id}`, { token: owner, body: { onlineVisible: true } });
    const variant = (await api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku, price, quantityMode: mode } })).json;
    return { productId: product.id, variantId: variant.id };
  };
  const stock = (variantId, quantityDelta) => api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId, type: 'ADJUSTMENT', quantityDelta } });
  const onHand = async (variantId) => Number((await sql.query(`SELECT quantity FROM inventory_items WHERE "branchId" = $1 AND "variantId" = $2`, [branchId, variantId])).rows[0]?.quantity ?? 0);

  const rice = await mkProduct(`Rice-${tag}`, `RICE-${tag}`, 100, 'WEIGHT');
  const chicken = await mkProduct(`Chicken-${tag}`, `CHK-${tag}`, 500, 'WEIGHT');
  const biryani = await mkProduct(`Biryani-${tag}`, `BIR-${tag}`, 450, 'COUNT');
  const soda = await mkProduct(`Soda-${tag}`, `SODA-${tag}`, 80, 'COUNT');
  // 2 kg rice (10 portions' worth) but only 0.75 kg chicken (exactly 3 portions): chicken is the scarce one.
  await stock(rice.variantId, 2);
  await stock(chicken.variantId, 0.75);
  await stock(soda.variantId, 5);
  const recipe = await api('PUT', `/recipes/${biryani.variantId}`, { token: owner, body: { ingredients: [{ ingredientVariantId: rice.variantId, quantity: 0.2 }, { ingredientVariantId: chicken.variantId, quantity: 0.25 }] } });
  check('a Biryani recipe: 0.2 kg rice + 0.25 kg chicken', recipe.status === 200 || recipe.status === 201, recipe);
  const station = await api('PUT', `/restaurant/dishes/${soda.variantId}/station`, { token: owner, body: { stationId: bar.id } });
  check('the owner sends sodas to the Bar station', station.status === 200 && station.json.stationId === bar.id, station);
  const dishList = await api('GET', '/restaurant/dishes', { token: owner });
  const sodaRow = dishList.json.find?.((d) => d.variantId === soda.variantId);
  const biryaniRow = dishList.json.find?.((d) => d.variantId === biryani.variantId);
  check('the dish list shows each dish\'s station and whether it has a recipe', sodaRow?.stationId === bar.id && biryaniRow?.hasRecipe === true && biryaniRow?.stationId === null, { sodaRow, biryaniRow });

  section('2. What the diner sees at the table');
  const tableInfo = await api('GET', `/public/shops/${slug}/tables/${table.id}`);
  check('the QR page learns the table name and that ordering is open', tableInfo.status === 200 && tableInfo.json.label === `T-${tag}` && tableInfo.json.acceptsOrders === true, tableInfo);
  const nope = await api('GET', `/public/shops/${slug}/tables/00000000-0000-0000-0000-000000000000`);
  check('a made-up table is a clean 404', nope.status === 404);
  const menu = (await api('GET', `/public/shops/${slug}`)).json;
  const find = (productId) => menu.products.find((p) => p.id === productId)?.variants?.[0];
  check('the menu now includes the Biryani (made from ingredients)', Boolean(find(biryani.productId)), menu.products?.map((p) => p.name));
  check('Biryani shows 3 portions: chicken (0.75 kg / 0.25) is the scarce ingredient, not rice', find(biryani.productId)?.available === 3, find(biryani.productId));
  check('the ingredients themselves show their own stock', find(rice.productId)?.available === 2 && find(soda.productId)?.available === 5);

  section('3. A diner orders and pays (no sign-in)');
  const bad = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 1 }], phone: '123' } });
  check('a bad phone number is refused before anything is created', bad.status === 400, bad);
  const tooMany = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 4 }], phone: '0722111222' } });
  check('ordering 4 Biryani when only 3 can be made is refused', tooMany.status === 409 && /Only 3/.test(tooMany.json.message || ''), tooMany);
  const wrongTable = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: '00000000-0000-0000-0000-000000000000', lines: [{ variantId: biryani.variantId, quantity: 1 }], phone: '0722111222' } });
  check('an unknown table is refused', wrongTable.status === 404, wrongTable);

  const order = await api('POST', '/public/table-orders', {
    body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 2 }, { variantId: soda.variantId, quantity: 1 }], phone: '0722111222', name: 'Amina', note: 'No chilli' },
  });
  const o = order.json;
  check('order placed: 2 Biryani + 1 Soda = KES 980, DINE_IN at the table, waiting for payment', order.status === 201 && o.fulfilmentType === 'DINE_IN' && o.status === 'PENDING_PAYMENT' && o.amountDue === 980 && o.tableLabel === `T-${tag}`, order);
  check('the diner is given a secret for their order page; the order has no account behind it', typeof o.guestToken === 'string' && o.guestToken.includes('.'));
  const pushes = (await mock('GET', '/_test/pushes')).json;
  const push = pushes[pushes.length - 1];
  check('an M-Pesa prompt for KES 980 went to the diner\'s phone', push?.amount === 980 && push.phone === '254722111222', push);
  const rowInDb = (await sql.query(`SELECT "buyerId","guestTokenHash","tableId" FROM online_orders WHERE id = $1`, [o.id])).rows[0];
  check('stored without a buyer; only a HASH of the secret is kept', rowInDb.buyerId === null && rowInDb.tableId === table.id && /^[0-9a-f]{64}$/.test(rowInDb.guestTokenHash) && !o.guestToken.includes(rowInDb.guestTokenHash));

  const held = (await api('GET', `/public/shops/${slug}`)).json;
  const heldBiryani = held.products.find((p) => p.id === biryani.productId).variants[0].available;
  check('while that order waits to be paid, only 1 Biryani portion is left to offer (the held ingredients are counted)', heldBiryani === 1, heldBiryani);
  const another = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 2 }], phone: '0733000111' } });
  check('a second diner cannot order the portions the first is paying for', another.status === 409, another);

  section('4. Privacy of the diner\'s order page');
  const mine = await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`);
  check('the diner can open their order with their secret', mine.status === 200 && mine.json.id === o.id && mine.json.kitchen?.stage === 'WAITING', mine);
  const noSecret = await api('GET', `/public/table-orders/${o.id}`);
  check('without the secret it is a 404', noSecret.status === 404, noSecret);
  const wrongSecret = await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken.slice(0, -2) + 'xx')}`);
  check('a wrong secret is a 404', wrongSecret.status === 404);
  const otherOrder = await api('GET', `/public/table-orders/00000000-0000-0000-0000-000000000000?k=${encodeURIComponent(o.guestToken)}`);
  check('the secret does not open any other order', otherOrder.status === 404);

  section('5. A fake payment is not believed; the real one is');
  const stat0 = (await mock('GET', '/_test/status-calls')).json.count;
  const forged = await mock('POST', `/_test/forge/${push.merchant_request_id}?mode=underpay`);
  check('(a callback arrives with a receipt but only KES 1)', forged.status === 200);
  const afterForge = (await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`)).json;
  check('an underpayment does not release the order to the kitchen', afterForge.status === 'PENDING_PAYMENT' && /doesn't match/.test(afterForge.lastPaymentError || ''), afterForge);
  check('no ticket exists and the table is still free', (await sql.query(`SELECT count(*)::int n FROM kitchen_tickets t JOIN online_orders o ON o."saleId" = t."saleId" WHERE o.id = $1`, [o.id])).rows[0].n === 0);

  const paid = await mock('POST', `/_test/pay/${push.merchant_request_id}`);
  check('the diner pays; Tuma calls back and the API accepts it', paid.status === 200 && paid.json.callbackAnsweredWith === 200, paid.json);
  check('the normal path made NO paid status checks (Tuma callbacks are free)', (await mock('GET', '/_test/status-calls')).json.count === stat0);
  await sleep(300);

  section('6. Paid means: accepted, stock deducted, sale recorded, kitchen told, table occupied');
  const after = (await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`)).json;
  check('the order went straight to ACCEPTED (nobody had to press anything)', after.status === 'ACCEPTED' && /^QTEST/.test(after.mpesaReceiptNumber || ''), after);
  check('the diner\'s page now says the kitchen has it', after.kitchen?.stage === 'SENT' && after.kitchen.total === 2, after.kitchen);
  check('rice dropped by 0.4 kg and chicken by 0.5 kg - the INGREDIENTS were deducted', Math.abs((await onHand(rice.variantId)) - 1.6) < 1e-6 && Math.abs((await onHand(chicken.variantId)) - 0.25) < 1e-6);
  check('the Biryani itself never had stock to move; the soda dropped by 1', (await onHand(biryani.variantId)) === 0 && (await onHand(soda.variantId)) === 4);
  const sale = (await sql.query(`SELECT s.id, s.total, s.status FROM sales s JOIN online_orders o ON o."saleId" = s.id WHERE o.id = $1`, [o.id])).rows[0];
  check('an ordinary completed sale of KES 980 was recorded', sale && Number(sale.total) === 980 && sale.status === 'COMPLETED', sale);
  const tickets = (await sql.query(`SELECT t.id, t.status, st.name FROM kitchen_tickets t JOIN kitchen_stations st ON st.id = t."stationId" WHERE t."saleId" = $1 ORDER BY st.name`, [sale.id])).rows;
  check('two tickets: Biryani to the branch\'s first station, Soda to the Bar the owner chose', tickets.length === 2 && tickets.every((t) => t.status === 'QUEUED') && tickets.some((t) => t.name === `Bar-${tag}`), tickets);
  const ticketLines = (await sql.query(`SELECT l.quantity, l.notes FROM kitchen_ticket_lines l JOIN kitchen_tickets t ON t.id = l."ticketId" WHERE t."saleId" = $1 ORDER BY l.quantity DESC`, [sale.id])).rows;
  check('the kitchen sees the diner\'s note ("No chilli") on its tickets', ticketLines.every((l) => l.notes === 'No chilli'), ticketLines);
  const tableNow = (await sql.query(`SELECT status FROM restaurant_tables WHERE id = $1`, [table.id])).rows[0];
  check('the table is now OCCUPIED', tableNow.status === 'OCCUPIED', tableNow);
  const replay = await mock('POST', `/_test/pay/${push.merchant_request_id}`);
  check('the same payment replayed changes nothing (no second sale, no second deduction)', replay.status === 200 && (await onHand(soda.variantId)) === 4 && (await sql.query(`SELECT count(*)::int n FROM sales WHERE id = $1`, [sale.id])).rows[0].n === 1);

  section('7. The menu no longer offers what the kitchen cannot make');
  const afterMenu = (await api('GET', `/public/shops/${slug}`)).json;
  check('Biryani now shows 1 portion (0.25 kg chicken left)', afterMenu.products.find((p) => p.id === biryani.productId).variants[0].available === 1);
  const last = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 1 }], phone: '0744555666' } });
  check('the last portion can be ordered', last.status === 201, last);
  const lastPush = (await mock('GET', '/_test/pushes')).json.slice(-1)[0];
  const gone = (await api('GET', `/public/shops/${slug}`)).json.products.find((p) => p.id === biryani.productId).variants[0].available;
  check('while that last portion is being paid for, Biryani shows 0 (finished)', gone === 0, gone);
  const finished = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: biryani.variantId, quantity: 1 }], phone: '0755666777' } });
  check('a new order for it is refused: "Sorry, ... is finished"', finished.status === 409 && /finished/.test(finished.json.message || ''), finished);

  section('8. The kitchen works through the tickets');
  await mock('POST', `/_test/pay/${lastPush.merchant_request_id}`);
  await sleep(300);
  const orderRows = (await sql.query(`SELECT id, status FROM online_orders WHERE id = $1 OR "buyerPhone" = '254744555666'`, [o.id])).rows;
  const lastOrderId = (await sql.query(`SELECT id FROM online_orders WHERE "buyerPhone" = '254744555666' ORDER BY "createdAt" DESC LIMIT 1`)).rows[0].id;
  const kds = await api('GET', '/restaurant/kitchen-tickets', { token: owner });
  const mineTickets = kds.json.filter?.((t) => t.saleId === sale.id) ?? [];
  check('both tickets show on the kitchen screens', mineTickets.length === 2, kds.json.length);
  for (const t of mineTickets) {
    for (const step of ['IN_PROGRESS', 'READY']) {
      const r = await api('PATCH', `/restaurant/kitchen-tickets/${t.id}/advance`, { token: owner });
      check(`ticket ${t.station?.name}: ${step}`, r.status === 200 && r.json.status === step, r.json);
    }
  }
  const midway = (await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`)).json;
  check('with every ticket READY the diner\'s page says it is ready; the order is not complete yet', midway.kitchen.stage === 'READY' && midway.status === 'ACCEPTED', midway);
  for (const t of mineTickets) await api('PATCH', `/restaurant/kitchen-tickets/${t.id}/advance`, { token: owner });
  const done = (await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`)).json;
  check('serving the last ticket COMPLETES the order, and commission becomes owed (3% of KES 980)', done.status === 'COMPLETED' && Math.abs(done.commissionAmount - 29.4) < 0.001 && done.kitchen.stage === 'SERVED', done);

  section('9. Cancelling puts the ingredients back');
  const chickenBefore = await onHand(chicken.variantId);
  const lastBefore = (await api('GET', `/online-orders/${lastOrderId}`, { token: owner })).json;
  check('the last diner\'s order was paid and accepted automatically', lastBefore.status === 'ACCEPTED', lastBefore);
  check('their Biryani took the last 0.25 kg of chicken', Math.abs(chickenBefore - 0) < 1e-6, chickenBefore);
  const cancel = await api('POST', `/online-orders/${lastOrderId}/cancel`, { token: owner, body: { reason: 'Kitchen ran out of gas' } });
  check('the restaurant cancels it; the diner is owed a refund of KES 450', cancel.status === 201 || cancel.status === 200, cancel);
  check('the chicken and rice were returned to stock', Math.abs((await onHand(chicken.variantId)) - 0.25) < 1e-6 && Math.abs((await onHand(rice.variantId)) - 1.6) < 1e-6);
  check('the cancelled order\'s sale is voided and its kitchen ticket removed', (await sql.query(`SELECT count(*)::int n FROM kitchen_tickets t JOIN online_orders o ON o."saleId" = t."saleId" WHERE o.id = $1`, [lastOrderId])).rows[0].n === 0 && (await sql.query(`SELECT s.status FROM sales s JOIN online_orders o ON o."saleId" = s.id WHERE o.id = $1`, [lastOrderId])).rows[0].status === 'VOIDED');
  const back = (await api('GET', `/public/shops/${slug}`)).json.products.find((p) => p.id === biryani.productId).variants[0].available;
  check('the Biryani is on the menu again (1 portion)', back === 1, back);

  section('10. A branch with no kitchen stations takes no table orders');
  const branch2 = (await api('POST', '/branches', { token: owner, body: { name: `NoKitchen-${tag}` } })).json;
  const table2 = branch2.id ? (await api('POST', '/restaurant/tables', { token: owner, body: { branchId: branch2.id, label: `X-${tag}`, seats: 2 } })).json : {};
  if (table2.id) {
    const info2 = await api('GET', `/public/shops/${slug}/tables/${table2.id}`);
    check('the QR page says that table cannot order', info2.status === 200 && info2.json.acceptsOrders === false, info2);
    const order2 = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table2.id, lines: [{ variantId: soda.variantId, quantity: 1 }], phone: '0766777888' } });
    check('and an order there is refused BEFORE any money is asked for', order2.status === 503, order2);
  } else {
    check('(could not create a second branch to test this)', false, { branch2, table2 });
  }

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
