// End-to-end test of a diner ordering from a restaurant table's QR code, and of open bills (running tabs) on the till,
// against a LOCAL test setup. It plays the
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

  section('11. The platform owner\'s table-order overview');
  const adminLogin = await api('POST', '/platform-admin/auth/login', { body: { email: 'admin@test.local', password: 'test-admin-password' } });
  const admin = adminLogin.json.accessToken;
  check('the overview needs the platform admin', (await api('GET', '/platform-admin/table-order-overview')).status === 401);
  const orderOrg = (await sql.query(`SELECT "organizationId" o FROM online_orders WHERE id = $1`, [lastOrderId])).rows[0].o;
  const overview = await api('GET', '/platform-admin/table-order-overview?days=365', { token: admin });
  const row = overview.json.restaurants?.find((r) => r.organizationId === orderOrg);
  check('the restaurant appears with its table orders, sales and commission', overview.status === 200 && row?.orders >= 2 && row.paidOrders >= 2 && row.sales >= 980 && row.commissionRecorded >= 29.4, row);
  check('a refund owed on a cancelled paid order shows', row?.refundsOwed >= 450, row);
  // Make one order look "paid but never reached the kitchen" the way a real fault would leave it.
  await sql.query(`UPDATE online_orders SET status = 'PAID' WHERE id = $1`, [lastOrderId]);
  const stuckView = await api('GET', '/platform-admin/table-order-overview?days=365', { token: admin });
  const stuckRow = stuckView.json.restaurants.find((r) => r.organizationId === orderOrg);
  const attention = stuckView.json.attention.find((a) => a.id === lastOrderId);
  check('a paid order that never reached the kitchen is listed as needing attention', stuckRow?.stuck >= 1 && /not sent to the kitchen/.test(attention?.problem ?? ''), { stuck: stuckRow?.stuck, attention });
  await sql.query(`UPDATE online_orders SET status = 'CANCELLED' WHERE id = $1`, [lastOrderId]);

  section('12. The platform owner switches a restaurant\'s table ordering off and on');
  const offPath = `/platform-admin/organizations/${orderOrg}/table-ordering`;
  check('only the platform admin can switch table ordering off', (await api('POST', `${offPath}/block`, { body: { reason: 'abc def' } })).status === 401);
  check('a reason is required', (await api('POST', `${offPath}/block`, { token: admin, body: { reason: 'x' } })).status === 400);
  const off = await api('POST', `${offPath}/block`, { token: admin, body: { reason: 'Orders are not reaching the kitchen' } });
  check('the platform admin switches table ordering off', off.status === 201 || off.status === 200, off);
  check('doing it twice is refused', (await api('POST', `${offPath}/block`, { token: admin, body: { reason: 'again please' } })).status === 409);
  const offInfo = await api('GET', `/public/shops/${slug}/tables/${table.id}`);
  check('the table\'s QR page now says ordering is off', offInfo.status === 200 && offInfo.json.acceptsOrders === false, offInfo);
  const refused = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: soda.variantId, quantity: 1 }], phone: '0799000111' } });
  check('a new order is refused before any money is asked for', refused.status === 503 && /not taking table orders/.test(refused.json.message || ''), refused);
  const stillThere = await api('GET', `/public/table-orders/${o.id}?k=${encodeURIComponent(o.guestToken)}`);
  check('a diner whose order was already paid can still follow it', stillThere.status === 200 && stillThere.json.id === o.id, stillThere.status);
  const status = await api('GET', '/restaurant/dishes/ordering-status', { token: owner });
  check('the restaurant is told ordering is off, and why', status.json.blockedReason === 'Orders are not reaching the kitchen', status.json);
  const offOverview = (await api('GET', '/platform-admin/table-order-overview?days=365', { token: admin })).json.restaurants.find((r) => r.organizationId === orderOrg);
  check('the owner\'s overview shows it as switched off, with the reason and contact details', offOverview?.tableOrderingBlockedReason === 'Orders are not reaching the kitchen' && offOverview.contactPhone === '0711000111', offOverview);
  const on = await api('POST', `${offPath}/unblock`, { token: admin });
  check('the platform admin switches it back on', on.status === 201 || on.status === 200, on);
  check('switching on twice is refused', (await api('POST', `${offPath}/unblock`, { token: admin })).status === 409);
  const onInfo = await api('GET', `/public/shops/${slug}/tables/${table.id}`);
  check('the QR page takes orders again', onInfo.json.acceptsOrders === true, onInfo.json);
  const again = await api('POST', '/public/table-orders', { body: { shopSlug: slug, tableId: table.id, lines: [{ variantId: soda.variantId, quantity: 1 }], phone: '0799000111' } });
  check('and a new order goes through', again.status === 201, again);
  check('the restaurant no longer sees a notice', (await api('GET', '/restaurant/dishes/ordering-status', { token: owner })).json.blockedReason === null);

  section('13. Tips and a note on each dish');
  const tipBody = (over = {}) => ({ shopSlug: slug, tableId: table.id, lines: [{ variantId: soda.variantId, quantity: 1, note: 'with ice, no straw' }], phone: '0788222333', note: 'for the birthday girl', tipAmount: 50, ...over });
  check('a negative tip is refused', (await api('POST', '/public/table-orders', { body: tipBody({ tipAmount: -5 }) })).status === 400);
  check('an absurd tip is refused', (await api('POST', '/public/table-orders', { body: tipBody({ tipAmount: 20000 }) })).status === 400);
  check('a note that is far too long is refused', (await api('POST', '/public/table-orders', { body: tipBody({ lines: [{ variantId: soda.variantId, quantity: 1, note: 'x'.repeat(300) }] }) })).status === 400);
  const tipped = await api('POST', '/public/table-orders', { body: tipBody() });
  const t = tipped.json;
  check('a KES 80 soda with a KES 50 tip: KES 130 to pay, and the order says how much of it is the tip', tipped.status === 201 && t.amountDue === 130 && t.tipAmount === 50 && t.subtotal === 80, tipped);
  check('the dish\'s note is kept on the order', t.lines?.[0]?.note === 'with ice, no straw', t.lines);
  const tipPush = (await mock('GET', '/_test/pushes')).json.filter((x) => x.phone === '254788222333').pop();
  check('the ONE M-Pesa prompt is for the whole KES 130 (order plus tip)', tipPush?.amount === 130, tipPush);
  const underpaid = await mock('POST', `/_test/forge/${tipPush.merchant_request_id}?mode=underpay`);
  const stillUnpaid = (await api('GET', `/public/table-orders/${t.id}?k=${encodeURIComponent(t.guestToken)}`)).json;
  check('paying only the order without the tip would not release it (the full KES 130 is required)', underpaid.status === 200 && stillUnpaid.status === 'PENDING_PAYMENT', stillUnpaid.status);
  await mock('POST', `/_test/pay/${tipPush.merchant_request_id}`);
  await sleep(300);
  const tipSale = (await sql.query(`SELECT s.id, s.total FROM sales s JOIN online_orders o ON o."saleId" = s.id WHERE o.id = $1`, [t.id])).rows[0];
  check('the sale is only the KES 80 of food and drink - the tip is not counted as sales', Number(tipSale?.total) === 80, tipSale);
  const tipRow = (await sql.query(`SELECT "tipAmount" a FROM restaurant_sale_tips WHERE "saleId" = $1`, [tipSale.id])).rows[0];
  check('the KES 50 tip is recorded separately for the staff', Number(tipRow?.a) === 50, tipRow);
  const lineNotes = (await sql.query(`SELECT l.notes FROM kitchen_ticket_lines l JOIN kitchen_tickets k ON k.id = l."ticketId" WHERE k."saleId" = $1`, [tipSale.id])).rows;
  check('the kitchen ticket shows the dish\'s note first, then the note for the whole order', lineNotes.length === 1 && lineNotes[0].notes === 'with ice, no straw - for the birthday girl', lineNotes);
  const tickets13 = (await api('GET', '/restaurant/kitchen-tickets', { token: owner })).json.filter((k) => k.saleId === tipSale.id);
  for (const k of tickets13) for (let i = 0; i < 3; i++) await api('PATCH', `/restaurant/kitchen-tickets/${k.id}/advance`, { token: owner });
  const done13 = (await api('GET', `/public/table-orders/${t.id}?k=${encodeURIComponent(t.guestToken)}`)).json;
  check('commission is 3% of the KES 80 sale only (KES 2.40), not of the tip', done13.status === 'COMPLETED' && Math.abs(done13.commissionAmount - 2.4) < 0.001, done13);

  const tipped2 = await api('POST', '/public/table-orders', { body: tipBody({ phone: '0788333444', lines: [{ variantId: soda.variantId, quantity: 1 }], note: undefined }) });
  const tipPush2 = (await mock('GET', '/_test/pushes')).json.filter((x) => x.phone === '254788333444').pop();
  await mock('POST', `/_test/pay/${tipPush2.merchant_request_id}`);
  await sleep(300);
  const cancelTip = await api('POST', `/online-orders/${tipped2.json.id}/cancel`, { token: owner, body: { reason: 'Kitchen closed early' } });
  check('cancelling a paid order refunds EVERYTHING the diner paid, tip included (KES 130)', (cancelTip.status === 201 || cancelTip.status === 200) && cancelTip.json.refundDue === 130, cancelTip.json);
  const tipGone = (await sql.query(`SELECT count(*)::int n FROM restaurant_sale_tips t JOIN online_orders o ON o."saleId" = t."saleId" WHERE o.id = $1`, [tipped2.json.id])).rows[0].n;
  check('and the staff tip record for it is removed', tipGone === 0, tipGone);
  const noTip = await api('POST', '/public/table-orders', { body: tipBody({ phone: '0788444555', tipAmount: undefined, lines: [{ variantId: soda.variantId, quantity: 1 }] }) });
  check('an order with no tip is exactly the price of the food (KES 80)', noTip.status === 201 && noTip.json.amountDue === 80 && noTip.json.tipAmount === 0, noTip.json.amountDue);

  // ─────────────────────────────────────────────────────────────────────────────────────────────
  // OPEN TABS: a running bill per table, paid at the end (cash, M-Pesa or card; whole, in parts or split)
  // open-tabs scope: its own block so its names cannot clash with the QR-order checks above
  {
  // ─────────────────────────────────────────────────────────────────────────────────────────────
  section('20. Open bills - setting up a till, a cashier and some dishes');
  const orgInfo = (await api('GET', '/organizations/me', { token: owner })).json;
  const terminalId = (await sql.query(`SELECT id FROM terminals WHERE "branchId" = $1 ORDER BY "createdAt" LIMIT 1`, [branchId])).rows[0].id;
  const ownerOrgUserId = (await sql.query(`SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou."userId" WHERE u.email = 'owner@demo.zaroda.pos' AND ou."organizationId" = $1`, [orgInfo.id])).rows[0].id;
  const pinLogin = await api('POST', '/auth/pin-login', { body: { terminalId, orgUserId: ownerOrgUserId, pin: '1234' } });
  const cashierSessionId = pinLogin.json.cashierSessionId;
  check('the owner starts a till session by PIN', Boolean(cashierSessionId), pinLogin);

  const cashierEmail = `cashier-${tag}@demo.zaroda.pos`;
  const mkCashier = await api('POST', '/org-users', { token: owner, body: { email: cashierEmail, fullName: 'Tab Cashier', password: 'password123', role: 'CASHIER', branchId } });
  const cashierLogin = await api('POST', '/auth/login', { body: { email: cashierEmail, password: 'password123' } });
  const cashier = cashierLogin.json.accessToken;
  check('a cashier account exists to test the permissions', Boolean(cashier), { mkCashier: mkCashier.status, cashierLogin });

  const stationRows = async () => (await api('GET', `/restaurant/stations?branchId=${branchId}`, { token: owner })).json;
  const firstStationId = async () => (await sql.query(`SELECT id FROM kitchen_stations WHERE "branchId" = $1 AND "archivedAt" IS NULL ORDER BY "createdAt" LIMIT 1`, [branchId])).rows[0].id;
  const plate = await mkProduct(`Plate-${tag}`, `PLATE-${tag}`, 200, 'COUNT');
  const cake = await mkProduct(`Cake-${tag}`, `CAKE-${tag}`, 150, 'COUNT');
  const juice = await mkProduct(`Juice-${tag}`, `JUICE-${tag}`, 100, 'COUNT');
  for (const p of [plate, cake, juice]) await stock(p.variantId, 100);
  await api('PUT', `/restaurant/dishes/${plate.variantId}/station`, { token: owner, body: { stationId: grill.id } });
  check('the stations list is available', (await stationRows()).length >= 2);

  const mkTable = async (label, seats = 4) => (await api('POST', '/restaurant/tables', { token: owner, body: { branchId, label: `${label}-${tag}`, seats } })).json;
  const tableOf = async (id) => (await api('GET', `/restaurant/tables?branchId=${branchId}`, { token: owner })).json.find((t) => t.id === id);
  const tabApi = (method, p, body, token = owner) => api(method, `/restaurant${p}`, { token, body });
  const newId = () => require('crypto').randomUUID();
  const payBody = (extra) => ({ terminalId, cashierSessionId, clientId: newId(), ...extra });

  section('21. Opening a bill');
  const t1 = await mkTable('Tab1');
  const open1 = await tabApi('POST', `/tables/${t1.id}/tabs`, { guestCount: 3 });
  check('a bill is opened on a table', open1.status === 201 && open1.json.status === 'OPEN' && open1.json.guestCount === 3, open1);
  const tab1 = open1.json.id;
  check('the table becomes Occupied', (await tableOf(t1.id)).status === 'OCCUPIED');
  check('a second bill on the same table is refused', (await tabApi('POST', `/tables/${t1.id}/tabs`, {})).status === 409);
  const raceTable = await mkTable('Race');
  const raced = await Promise.all([1, 2].map(() => tabApi('POST', `/tables/${raceTable.id}/tabs`, {})));
  check('two people opening the same free table at the same moment: exactly one bill', raced.filter((r) => r.status === 201).length === 1 && raced.filter((r) => r.status === 409).length === 1, raced.map((r) => r.status));
  check('opening a bill needs a sign-in', (await api('POST', `/restaurant/tables/${t1.id}/tabs`, { body: {} })).status === 401);
  check('the open bill is found from its table', (await tabApi('GET', `/tables/${t1.id}/tab`)).json?.id === tab1);

  section('22. Adding items: the kitchen gets them at once, later courses are held');
  const add1 = await tabApi('POST', `/tabs/${tab1}/lines`, {
    lines: [
      { variantId: plate.variantId, quantity: 2 }, // dish has a station: Grill
      { variantId: juice.variantId, quantity: 1 }, // no station set: the branch's first
      { variantId: juice.variantId, quantity: 1, stationId: bar.id, notes: 'no ice' }, // chosen: Bar
      { variantId: cake.variantId, quantity: 1, courseNumber: 2 }, // dessert, held
    ],
  });
  check('items are added', add1.status === 201 && add1.json.lines.length === 4, add1);
  const lineOf = (view, variantId, i = 0) => view.lines.filter((l) => l.variantId === variantId)[i];
  const first = await firstStationId();
  check('a dish with its own station goes there (Grill)', lineOf(add1.json, plate.variantId).stationId === grill.id);
  check('a dish with no station goes to the branch\'s first station', lineOf(add1.json, juice.variantId, 0).stationId === first, { got: lineOf(add1.json, juice.variantId, 0).stationId, first });
  check('the cashier can choose another station (Bar)', lineOf(add1.json, juice.variantId, 1).stationId === bar.id);
  check('the bill adds up: 2 x 200 + 100 + 100 + 150 = 750', add1.json.total === 750 && add1.json.unpaidCount === 4, add1.json);
  const tickets1 = (await sql.query(`SELECT status, "courseNumber", "saleId", "firedAt" FROM kitchen_tickets WHERE "tabId" = $1 ORDER BY "courseNumber"`, [tab1])).rows;
  check('course 1 tickets are sent to the kitchen at once (QUEUED)', tickets1.filter((t) => t.courseNumber === 1).length === 3 && tickets1.filter((t) => t.courseNumber === 1).every((t) => t.status === 'QUEUED' && t.firedAt), tickets1);
  check('the dessert is held (HELD)', tickets1.filter((t) => t.courseNumber === 2).length === 1 && tickets1.find((t) => t.courseNumber === 2).status === 'HELD');
  check('no ticket belongs to a sale yet (there is none)', tickets1.every((t) => t.saleId === null));
  const kds = (await tabApi('GET', '/kitchen-tickets')).json.filter((k) => k.tabId === tab1);
  check('the kitchen screen shows the table\'s name on the tabs\'s tickets', kds.length >= 3 && kds.every((k) => k.tab?.table?.label === `Tab1-${tag}`), kds[0]);
  check('an item with a station from another branch or a bad id is refused', (await tabApi('POST', `/tabs/${tab1}/lines`, { lines: [{ variantId: juice.variantId, quantity: 1, stationId: newId() }] })).status === 400);
  check('the floor shows the running total on the table', (await tableOf(t1.id)).tab?.total === 750 && (await tableOf(t1.id)).tab?.itemCount === 4);

  section('23. Held courses survive a refresh');
  const held = await tabApi('GET', `/tables/${t1.id}/held-courses`);
  check('the held dessert is listed for the table', held.status === 200 && held.json.length === 1 && held.json[0].courseNumber === 2 && held.json[0].tabId === tab1 && held.json[0].items[0].quantity === 1, held);
  const fired = await tabApi('POST', `/tabs/${tab1}/courses/2/fire`);
  check('firing course 2 sends it to the kitchen', fired.status === 200 && fired.json.fired === 1, fired);
  check('firing it again does nothing', (await tabApi('POST', `/tabs/${tab1}/courses/2/fire`)).json.fired === 0);
  check('nothing is held any more', (await tabApi('GET', `/tables/${t1.id}/held-courses`)).json.length === 0);

  section('24. Voiding an item');
  const dessert = lineOf(add1.json, cake.variantId);
  check('a cashier cannot void an item', (await tabApi('POST', `/tabs/${tab1}/lines/${dessert.id}/void`, { reason: 'guest changed their mind' }, cashier)).status === 403);
  check('a reason is needed', (await tabApi('POST', `/tabs/${tab1}/lines/${dessert.id}/void`, { reason: '' })).status === 400);
  const voided = await tabApi('POST', `/tabs/${tab1}/lines/${dessert.id}/void`, { reason: 'guest changed their mind' });
  check('a supervisor-level user voids it with a reason', voided.status === 200 && lineOf(voided.json, cake.variantId).status === 'VOIDED' && voided.json.total === 600, voided);
  const struck = (await sql.query(`SELECT l."voidedAt" FROM kitchen_ticket_lines l JOIN kitchen_tickets k ON k.id = l."ticketId" WHERE k."tabId" = $1 AND l."variantId" = $2`, [tab1, cake.variantId])).rows;
  check('the kitchen\'s ticket line is marked voided', struck.length === 1 && struck[0].voidedAt !== null, struck);
  const kds2 = (await tabApi('GET', '/kitchen-tickets')).json.filter((k) => k.tabId === tab1).flatMap((k) => k.lines);
  check('the kitchen screen data shows it as voided (struck through)', kds2.some((l) => l.variantId === cake.variantId && l.voidedAt), kds2);
  check('voiding twice is refused', (await tabApi('POST', `/tabs/${tab1}/lines/${dessert.id}/void`, { reason: 'again please' })).status === 400);
  const voidAudit = (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'restaurant.tab_line_voided' AND "entityId" = $1`, [dessert.id])).rows[0].n;
  check('the void is in the audit log', voidAudit === 1, voidAudit);
  check('a voided item no longer counts on the bill', (await tabApi('GET', `/tabs/${tab1}`)).json.total === 600);

  section('25. The bill before it is paid');
  const bill = await tabApi('GET', `/tabs/${tab1}/bill?split=3`);
  check('the bill shows what is owed and what each of 3 would pay', bill.status === 200 && bill.json.total === 600 && bill.json.split.length === 3 && Math.abs(bill.json.split.reduce((a, b) => a + b, 0) - 600) < 0.001, bill.json);
  check('there is a text version to share', typeof bill.json.text === 'string' && bill.json.text.includes(`Tab1-${tag}`) && bill.json.text.includes('Total: KES 600.00'), bill.json.text);
  check('a bill for chosen items only', (await tabApi('GET', `/tabs/${tab1}/bill?lineIds=${lineOf(add1.json, plate.variantId).id}`)).json.total === 400);

  section('26. Paying: nothing double-charged, nothing duplicated in the kitchen');
  const stockBefore = { plate: await onHand(plate.variantId), juice: await onHand(juice.variantId) };
  const ticketCountBefore = (await sql.query(`SELECT count(*)::int n FROM kitchen_tickets WHERE "tabId" = $1`, [tab1])).rows[0].n;
  const wrong = await tabApi('POST', `/tabs/${tab1}/close`, payBody({ payments: [{ method: 'CASH', amount: 500 }] }));
  check('payments that do not add up to the bill are refused', wrong.status === 400 && /does not match/.test(wrong.json.message), wrong);
  const claims = (await sql.query(`SELECT count(*)::int n FROM restaurant_tab_lines WHERE "tabId" = $1 AND "claimClientId" IS NOT NULL`, [tab1])).rows[0].n;
  check('and the items are released again, the bill stays open', claims === 0 && (await tabApi('GET', `/tabs/${tab1}`)).json.status === 'OPEN', claims);
  const clientId = newId();
  const closeBody = payBody({ clientId, payments: [{ method: 'CARD', amount: 600 }], tipAmount: 50, serviceChargeAmount: 20, label: 'Table 1' });
  const closed = await tabApi('POST', `/tabs/${tab1}/close`, closeBody);
  check('the bill is paid by card with a tip and a service charge', closed.status === 200 && closed.json.closed === true && closed.json.tab.status === 'CLOSED' && Number(closed.json.sale.total) === 600, closed);
  const saleId = closed.json.sale.id;
  check('the sale records a CARD payment of 600', (await sql.query(`SELECT method, amount FROM sale_payments WHERE "saleId" = $1`, [saleId])).rows.map((r) => `${r.method}:${Number(r.amount)}`).join() === 'CARD:600');
  check('stock came down by what was sold (2 plates, 1 juice and the other juice)', (await onHand(plate.variantId)) === stockBefore.plate - 2 && (await onHand(juice.variantId)) === stockBefore.juice - 2, { plate: await onHand(plate.variantId), juice: await onHand(juice.variantId), stockBefore });
  const ticketCountAfter = (await sql.query(`SELECT count(*)::int n FROM kitchen_tickets WHERE "tabId" = $1`, [tab1])).rows[0].n;
  check('the kitchen tickets already made were NOT duplicated by the payment', ticketCountAfter === ticketCountBefore && (await sql.query(`SELECT count(*)::int n FROM kitchen_tickets WHERE "saleId" = $1`, [saleId])).rows[0].n === 0, { ticketCountBefore, ticketCountAfter });
  const tipRow2 = (await sql.query(`SELECT "tipAmount" t, "serviceChargeAmount" s FROM restaurant_sale_tips WHERE "saleId" = $1`, [saleId])).rows[0];
  check('the tip and service charge are kept apart from the sale', Number(tipRow2?.t) === 50 && Number(tipRow2?.s) === 20, tipRow2);
  check('the sale is linked to the table and to the bill', (await sql.query(`SELECT count(*)::int n FROM restaurant_sale_tables WHERE "saleId" = $1 AND "tableId" = $2`, [saleId, t1.id])).rows[0].n === 1 && (await tabApi('GET', `/tabs/${tab1}`)).json.saleIds.includes(saleId));
  check('the table goes to Needs cleaning', (await tableOf(t1.id)).status === 'NEEDS_CLEANING');
  check('and has no open bill', !(await tabApi('GET', `/tables/${t1.id}/tab`)).json?.id);
  const again = await tabApi('POST', `/tabs/${tab1}/close`, closeBody);
  check('paying again with the same id gives the same sale and charges nothing more', again.status === 200 && again.json.sale.id === saleId && (await onHand(plate.variantId)) === stockBefore.plate - 2, again);
  check('only one sale exists for that id', (await sql.query(`SELECT count(*)::int n FROM sales WHERE "clientId" = $1`, [clientId])).rows[0].n === 1);
  check('a different id on an already paid bill is refused', (await tabApi('POST', `/tabs/${tab1}/close`, payBody({ payments: [{ method: 'CASH', amount: 600 }] }))).status === 409);
  const auditActions = (await sql.query(`SELECT action FROM audit_log WHERE "entityId" = $1`, [tab1])).rows.map((r) => r.action);
  check('opening, paying and closing are in the audit log', ['restaurant.tab_opened', 'restaurant.tab_paid', 'restaurant.tab_closed'].every((a) => auditActions.includes(a)), auditActions);
  check('nothing can be added to a closed bill', (await tabApi('POST', `/tabs/${tab1}/lines`, { lines: [{ variantId: juice.variantId, quantity: 1 }] })).status === 409);
  check('"Mark clean" frees the table', (await tabApi('POST', `/tables/${t1.id}/clean`)).json.status === 'AVAILABLE' && (await tableOf(t1.id)).status === 'AVAILABLE');

  section('27. Paying with M-Pesa needs a confirmed payment; cash change is just the till');
  const t2 = await mkTable('Tab2');
  const tab2 = (await tabApi('POST', `/tables/${t2.id}/tabs`, {})).json.id;
  await tabApi('POST', `/tabs/${tab2}/lines`, { lines: [{ variantId: juice.variantId, quantity: 2 }] });
  const fakeMpesa = await tabApi('POST', `/tabs/${tab2}/close`, payBody({ payments: [{ method: 'MPESA', amount: 200, providerReference: 'ws_CO_NOT_REAL' }] }));
  check('an M-Pesa payment that was never confirmed is refused', fakeMpesa.status === 400, fakeMpesa);
  check('and the bill is still open and unpaid', (await tabApi('GET', `/tabs/${tab2}`)).json.unpaidCount === 1);
  const mixed = await tabApi('POST', `/tabs/${tab2}/close`, payBody({ payments: [{ method: 'CASH', amount: 120 }, { method: 'CARD', amount: 80 }] }));
  check('a mix of cash and card pays one bill', mixed.status === 200 && mixed.json.closed === true, mixed);
  await tabApi('POST', `/tables/${t2.id}/clean`);

  section('28. Splitting the bill');
  const t3 = await mkTable('Split');
  const tab3 = (await tabApi('POST', `/tables/${t3.id}/tabs`, {})).json.id;
  const view3 = (await tabApi('POST', `/tabs/${tab3}/lines`, { lines: [{ variantId: plate.variantId, quantity: 1 }, { variantId: juice.variantId, quantity: 1 }, { variantId: cake.variantId, quantity: 2 }] })).json;
  const [lPlate, lJuice, lCake] = [lineOf(view3, plate.variantId), lineOf(view3, juice.variantId), lineOf(view3, cake.variantId)];
  const beforeSplitStock = await onHand(cake.variantId);
  check('a split cannot give one item to two people', (await tabApi('POST', `/tabs/${tab3}/close-split`, { terminalId, cashierSessionId, payers: [{ clientId: newId(), lineIds: [lPlate.id], payments: [{ method: 'CASH', amount: 200 }] }, { clientId: newId(), lineIds: [lPlate.id, lJuice.id], payments: [{ method: 'CASH', amount: 300 }] }] })).status === 400);
  const aId = newId();
  const bId = newId();
  const split = await tabApi('POST', `/tabs/${tab3}/close-split`, {
    terminalId,
    cashierSessionId,
    payers: [
      { clientId: aId, label: 'Wanjiru', lineIds: [lPlate.id], payments: [{ method: 'CASH', amount: 200 }], tipAmount: 20 },
      { clientId: bId, label: 'Otieno', lineIds: [lJuice.id, lCake.id], payments: [{ method: 'CARD', amount: 400 }] },
    ],
  });
  check('each person pays their own items as their own sale', split.status === 200 && split.json.payments.length === 2 && split.json.payments[0].total === 200 && split.json.payments[1].total === 400 && split.json.closed === true, split);
  check('two sales were made and linked to the bill', (await sql.query(`SELECT count(*)::int n FROM restaurant_tab_sales WHERE "tabId" = $1`, [tab3])).rows[0].n === 2);
  check('stock came down once for the cakes', (await onHand(cake.variantId)) === beforeSplitStock - 2);
  check('the bill closed only after everything was paid, and the table needs cleaning', (await tabApi('GET', `/tabs/${tab3}`)).json.status === 'CLOSED' && (await tableOf(t3.id)).status === 'NEEDS_CLEANING');
  await tabApi('POST', `/tables/${t3.id}/clean`);

  const t4 = await mkTable('Part');
  const tab4 = (await tabApi('POST', `/tables/${t4.id}/tabs`, {})).json.id;
  const view4 = (await tabApi('POST', `/tabs/${tab4}/lines`, { lines: [{ variantId: plate.variantId, quantity: 1 }, { variantId: juice.variantId, quantity: 1 }] })).json;
  const partial = await tabApi('POST', `/tabs/${tab4}/close`, payBody({ lineIds: [lineOf(view4, plate.variantId).id], payments: [{ method: 'CASH', amount: 200 }] }));
  check('paying only some of the items leaves the bill open for the rest', partial.status === 200 && partial.json.closed === false && partial.json.tab.status === 'OPEN' && partial.json.tab.total === 100, partial);
  check('a paid item cannot be paid or voided again', (await tabApi('POST', `/tabs/${tab4}/close`, payBody({ lineIds: [lineOf(view4, plate.variantId).id], payments: [{ method: 'CASH', amount: 200 }] }))).status === 409 && (await tabApi('POST', `/tabs/${tab4}/lines/${lineOf(view4, plate.variantId).id}/void`, { reason: 'too late' })).status === 400);
  check('a bill with a payment on it cannot be thrown away', (await tabApi('POST', `/tabs/${tab4}/cancel`, { reason: 'oops' })).status === 409);
  const rest = await tabApi('POST', `/tabs/${tab4}/close`, payBody({ payments: [{ method: 'CASH', amount: 100 }] }));
  check('the rest is paid later and the bill closes', rest.status === 200 && rest.json.closed === true, rest);
  await tabApi('POST', `/tables/${t4.id}/clean`);

  section('29. Two tills paying the same items at the same moment');
  const t5 = await mkTable('Rush');
  const tab5 = (await tabApi('POST', `/tables/${t5.id}/tabs`, {})).json.id;
  await tabApi('POST', `/tabs/${tab5}/lines`, { lines: [{ variantId: plate.variantId, quantity: 3 }] });
  const plateBefore = await onHand(plate.variantId);
  const rush = await Promise.all([1, 2].map(() => tabApi('POST', `/tabs/${tab5}/close`, payBody({ payments: [{ method: 'CASH', amount: 600 }] }))));
  check('exactly one of them pays; the other is told the items are taken', rush.filter((r) => r.status === 200).length === 1 && rush.filter((r) => r.status === 409).length === 1, rush.map((r) => [r.status, r.json.message]));
  check('stock came down once (3 plates)', (await onHand(plate.variantId)) === plateBefore - 3, { before: plateBefore, after: await onHand(plate.variantId) });
  await tabApi('POST', `/tables/${t5.id}/clean`);

  section('30. Moving a bill and throwing one away');
  const t6 = await mkTable('From');
  const t7 = await mkTable('To');
  const t8 = await mkTable('Busy');
  const tab6 = (await tabApi('POST', `/tables/${t6.id}/tabs`, {})).json.id;
  await tabApi('POST', `/tables/${t8.id}/tabs`, {});
  check('a bill cannot move to a table that has one', (await tabApi('POST', `/tabs/${tab6}/move`, { tableId: t8.id })).status === 409);
  const moved = await tabApi('POST', `/tabs/${tab6}/move`, { tableId: t7.id });
  check('a bill moves to a free table', moved.status === 200 && moved.json.table.id === t7.id, moved);
  check('the new table is Occupied and the old one needs cleaning', (await tableOf(t7.id)).status === 'OCCUPIED' && (await tableOf(t6.id)).status === 'NEEDS_CLEANING');
  check('"Mark clean" is refused while a bill is open on the table', (await tabApi('POST', `/tables/${t7.id}/clean`)).status === 409);
  await tabApi('POST', `/tabs/${tab6}/lines`, { lines: [{ variantId: juice.variantId, quantity: 1 }] });
  check('a cashier cannot throw away a bill that has items', (await tabApi('POST', `/tabs/${tab6}/cancel`, { reason: 'left' }, cashier)).status === 403);
  const thrown = await tabApi('POST', `/tabs/${tab6}/cancel`, { reason: 'Guests left without ordering' });
  check('a supervisor-level user can, with a reason', thrown.status === 200 && thrown.json.status === 'VOID', thrown);
  check('the table is free again and its kitchen ticket is struck through', (await tableOf(t7.id)).status === 'AVAILABLE' && (await sql.query(`SELECT count(*)::int n FROM kitchen_ticket_lines l JOIN kitchen_tickets k ON k.id = l."ticketId" WHERE k."tabId" = $1 AND l."voidedAt" IS NOT NULL`, [tab6])).rows[0].n === 1);
  const emptyTab = (await tabApi('POST', `/tables/${t6.id}/tabs`, {})).json.id;
  check('an empty bill can be thrown away by a cashier', (await tabApi('POST', `/tabs/${emptyTab}/cancel`, {}, cashier)).status === 200);

  section('31. The old pay-first order still works, with the station chosen for you');
  const t9 = await mkTable('Counter');
  const payFirst = await api('POST', `/restaurant/tables/${t9.id}/sales`, { token: owner, body: { clientId: newId(), terminalId, cashierSessionId, lineItems: [{ variantId: plate.variantId, quantity: 1 }, { variantId: juice.variantId, quantity: 1, courseNumber: 2 }], payments: [{ method: 'CASH', amount: 300 }] } });
  check('a pay-first order with no stations given is accepted', payFirst.status === 201 && payFirst.json.tickets.length === 2, payFirst);
  check('the plate went to Grill (its own station)', payFirst.json.tickets.some((k) => k.stationId === grill.id));
  const heldOld = await tabApi('GET', `/tables/${t9.id}/held-courses`);
  check('its held course is listed from the server too', heldOld.json.length === 1 && heldOld.json[0].source === 'SALE' && heldOld.json[0].courseNumber === 2, heldOld.json);
  const t10 = await mkTable('Both');
  await tabApi('POST', `/tables/${t10.id}/tabs`, {});
  const blocked = await api('POST', `/restaurant/tables/${t10.id}/sales`, { token: owner, body: { clientId: newId(), terminalId, cashierSessionId, lineItems: [{ variantId: juice.variantId, quantity: 1 }], payments: [{ method: 'CASH', amount: 100 }] } });
  check('a pay-first order on a table with an open bill is refused', blocked.status === 409, blocked);

  section('32. Reserved tables');
  const t11 = await mkTable('Resv');
  const nairobiNow = new Date(Date.now() + 3 * 3600_000);
  const soon = new Date(nairobiNow.getTime() + 30 * 60_000);
  const pad = (n) => String(n).padStart(2, '0');
  const resvId = newId();
  await sql.query(
    `INSERT INTO table_reservations (id, "organizationId", "branchId", "tableId", "reservationNumber", status, "guestName", "guestPhone", "partySize", date, time, "shopName", "shopSlug", "guestTokenHash", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, 'CONFIRMED', 'Mrs Test', '254700000000', 2, $6, $7, 'Demo', $8, 'x', now())`,
    [resvId, orgInfo.id, branchId, t11.id, `ZT-${tag}`.slice(0, 12), soon.toISOString().slice(0, 10), `${pad(soon.getUTCHours())}:${pad(soon.getUTCMinutes())}`, slug],
  );
  const resvRow = await tableOf(t11.id);
  check('a confirmed reservation 30 minutes away shows the table as Reserved (60-minute default)', resvRow.status === 'RESERVED' && resvRow.reservation?.guestName === 'Mrs Test' && resvRow.storedStatus === 'AVAILABLE', resvRow);
  const setLead = await api('PUT', '/restaurant/settings', { token: owner, body: { branchId, reserveLeadMinutes: 10 } });
  check('the lead time can be changed (owner)', setLead.status === 200 && setLead.json.reserveLeadMinutes === 10, setLead);
  check('with 10 minutes, a table 30 minutes away is still Available', (await tableOf(t11.id)).status === 'AVAILABLE');
  check('a cashier cannot change the lead time', (await api('PUT', '/restaurant/settings', { token: cashier, body: { branchId, reserveLeadMinutes: 90 } })).status === 403);
  await api('PUT', '/restaurant/settings', { token: owner, body: { branchId, reserveLeadMinutes: 60 } });
  await tabApi('POST', `/tables/${t11.id}/tabs`, {});
  check('a reserved table that is occupied shows Occupied', (await tableOf(t11.id)).status === 'OCCUPIED');
  await sql.query(`DELETE FROM table_reservations WHERE id = $1`, [resvId]);

  section('33. Editing and removing tables and stations');
  const tx1 = await mkTable('Edit');
  const renamed = await api('PATCH', `/restaurant/tables/${tx1.id}`, { token: owner, body: { label: `Renamed-${tag}`, seats: 6 } });
  check('a table can be renamed and its seats changed', renamed.status === 200 && renamed.json.label === `Renamed-${tag}` && renamed.json.seats === 6, renamed);
  check('renaming to a name already used is a clear refusal', (await api('PATCH', `/restaurant/tables/${tx1.id}`, { token: owner, body: { label: `Tab2-${tag}` } })).status === 409);
  check('a cashier cannot edit or delete a table', (await api('PATCH', `/restaurant/tables/${tx1.id}`, { token: cashier, body: { seats: 2 } })).status === 403 && (await api('DELETE', `/restaurant/tables/${tx1.id}`, { token: cashier })).status === 403);
  const delUnused = await api('DELETE', `/restaurant/tables/${tx1.id}`, { token: owner });
  check('a table that was never used is deleted', delUnused.status === 200 && delUnused.json.archived === false && !(await tableOf(tx1.id)));
  check('a table with an open bill cannot be deleted', (await api('DELETE', `/restaurant/tables/${t11.id}`, { token: owner })).status === 409);
  const delUsed = await api('DELETE', `/restaurant/tables/${t2.id}`, { token: owner });
  check('a table with history is archived, not deleted', delUsed.status === 200 && delUsed.json.archived === true && !(await tableOf(t2.id)) && (await sql.query(`SELECT count(*)::int n FROM restaurant_tabs WHERE "tableId" = $1`, [t2.id])).rows[0].n === 1, delUsed);
  const reuse = await api('POST', '/restaurant/tables', { token: owner, body: { branchId, label: `Tab2-${tag}`, seats: 2 } });
  check('and its name is free to use again', reuse.status === 201, reuse);
  check('an archived table cannot take a new bill', (await tabApi('POST', `/tables/${t2.id}/tabs`, {})).status === 404);

  const sNew = (await api('POST', '/restaurant/stations', { token: owner, body: { branchId, name: `Pastry-${tag}` } })).json;
  const sRenamed = await api('PATCH', `/restaurant/stations/${sNew.id}`, { token: owner, body: { name: `Pastry2-${tag}` } });
  check('a station can be renamed', sRenamed.status === 200 && sRenamed.json.name === `Pastry2-${tag}`, sRenamed);
  check('a cashier cannot delete a station', (await api('DELETE', `/restaurant/stations/${sNew.id}`, { token: cashier })).status === 403);
  const sDelUnused = await api('DELETE', `/restaurant/stations/${sNew.id}`, { token: owner });
  check('a station that was never used is deleted', sDelUnused.status === 200 && sDelUnused.json.archived === false, sDelUnused);
  const sBusy = (await api('POST', '/restaurant/stations', { token: owner, body: { branchId, name: `Busy-${tag}` } })).json;
  const t12 = await mkTable('Stn');
  const tab12 = (await tabApi('POST', `/tables/${t12.id}/tabs`, {})).json.id;
  await tabApi('POST', `/tabs/${tab12}/lines`, { lines: [{ variantId: juice.variantId, quantity: 1, stationId: sBusy.id }] });
  check('a station with unfinished tickets cannot be removed', (await api('DELETE', `/restaurant/stations/${sBusy.id}`, { token: owner })).status === 409);
  const tkts = (await tabApi('GET', '/kitchen-tickets')).json.filter((k) => k.tabId === tab12);
  for (const k of tkts) for (let i = 0; i < 3; i++) await tabApi('PATCH', `/kitchen-tickets/${k.id}/advance`);
  const sDelUsed = await api('DELETE', `/restaurant/stations/${sBusy.id}`, { token: owner });
  check('once its tickets are finished, a used station is archived', sDelUsed.status === 200 && sDelUsed.json.archived === true && !(await stationRows()).some((s) => s.id === sBusy.id), sDelUsed);
  check('a ticket from an open bill can be finished on the kitchen screen without a sale', tkts.length === 1);
  const afterArchive = (await tabApi('POST', `/tabs/${tab12}/lines`, { lines: [{ variantId: juice.variantId, quantity: 1 }] })).json;
  check('items added afterwards never use an archived station (the earlier item keeps its own)', afterArchive.lines.length === 2 && afterArchive.lines[1].stationId !== sBusy.id, afterArchive.lines?.map((l) => l.stationId));
  await tabApi('POST', `/tabs/${tab12}/cancel`, { reason: 'test over' });

  }

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
