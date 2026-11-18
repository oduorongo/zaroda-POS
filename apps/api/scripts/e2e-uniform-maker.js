// End-to-end test of the uniform maker against a LOCAL test setup: a "School uniforms" business signs up, buys materials, gives
// tailors jobs (materials leave stock), takes in finished pieces (into stock at materials + pay), pays and voids, closes and
// cancels jobs, sells a uniform SET to a school (its pieces leave stock), and the books post the tailoring. The till part uses
// the demo business: a made-ahead piece sells from its own stock, a set sells from its pieces. Refuses the live database.
//
// Needs: test Postgres (5433) migrated + apply-rls, the demo seed, the API started with `pnpm --filter api start:test`.
//   node scripts/e2e-uniform-maker.js
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(require.resolve('pg', { paths: [API_DIR, process.env.PG_DIR || API_DIR] }));
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
for (const key of ['DATABASE_URL', 'DIRECT_URL']) if (live[key] && hostOf(env[key]) === hostOf(live[key])) throw new Error(`REFUSING: ${key} is the LIVE database`);
const dbUrl = new URL(env.DIRECT_URL);
if (!(dbUrl.hostname === 'localhost' && dbUrl.port === '5433')) throw new Error('REFUSING: .env.local does not point at the local test database');

const API = 'http://localhost:3001';
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 600) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, p, { token, body } = {}) {
  const response = await fetch(API + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sql.connect();
  check('API ready', (await call('GET', '/ready')).status === 200);

  section('1. A "School uniforms" business signs up');
  const reg = await call('POST', '/auth/register', {
    body: { organizationName: `Uniforms ${tag}`, industryType: 'UNIFORM_MAKER', ownerFullName: 'Mama Uniform', ownerEmail: `uni-${tag}@test.local`, ownerPassword: 'password123', branchName: 'Workshop' },
  });
  check('it can choose the School uniforms business type', reg.status === 201 && Boolean(reg.json.accessToken), reg.json);
  const owner = reg.json.accessToken;
  const h = (m, p, body, token = owner) => call(m, p, { token, body });
  const me = (await h('GET', '/organizations/me')).json;
  check('the business is a uniform maker', me.industryType === 'UNIFORM_MAKER', me);
  const branchId = (await h('GET', '/branches')).json[0].id;
  const stock = async (variantId) => Number((await h('GET', `/inventory/items/${branchId}/${variantId}`)).json?.quantity ?? 0);
  const cost = async (variantId) => {
    const all = (await h('GET', '/products')).json.flatMap((p) => p.variants);
    const v = all.find((x) => x.id === variantId);
    return v?.cost === null || v?.cost === undefined ? null : Number(v.cost);
  };

  section('2. Materials, pieces and a set');
  const make = async (name, sku, price, extra = {}) => {
    const p = (await h('POST', '/products', { name: `${name} ${tag}` })).json;
    return (await h('POST', `/products/${p.id}/variants`, { sku: `${sku}-${tag}`, price, ...extra })).json;
  };
  const fabric = await make('Grey fabric', 'FAB', 300, { quantityMode: 'WEIGHT' });
  const buttons = await make('Buttons', 'BTN', 5);
  const shirt = await make('Shirt', 'SH12', 600, { name: 'Size 12' });
  const shorts = await make('Shorts', 'SO12', 500, { name: 'Size 12' });
  const set = await make('Boys full set', 'SET12', 1500, { name: 'Size 12' });
  check('materials, two pieces and a set are made', [fabric, buttons, shirt, shorts, set].every((v) => v.id), [fabric, buttons, shirt, shorts, set]);
  const receive = (variantId, qty, unitCost) => h('POST', '/inventory/transactions', { branchId, variantId, type: 'ADJUSTMENT', quantityDelta: qty, unitCost });
  check('fabric (100 m at 250) and buttons (500 at 2) are received', (await receive(fabric.id, 100, 250)).status === 201 && (await receive(buttons.id, 500, 2)).status === 201);

  const shirtRecipe = await h('PUT', `/recipes/${shirt.id}`, { ingredients: [{ ingredientVariantId: fabric.id, quantity: 1.2 }, { ingredientVariantId: buttons.id, quantity: 7 }], madeAhead: true, tailorRate: 80 });
  const shortsRecipe = await h('PUT', `/recipes/${shorts.id}`, { ingredients: [{ ingredientVariantId: fabric.id, quantity: 1 }, { ingredientVariantId: buttons.id, quantity: 2 }], madeAhead: true, tailorRate: 60 });
  const setRecipe = await h('PUT', `/recipes/${set.id}`, { ingredients: [{ ingredientVariantId: shirt.id, quantity: 2 }, { ingredientVariantId: shorts.id, quantity: 1 }], madeAhead: false });
  check('each piece gets its materials, "made in advance" and a tailor rate', shirtRecipe.status === 200 && shortsRecipe.status === 200);
  check('the set lists its pieces and stays "made when sold"', setRecipe.status === 200 && setRecipe.json.length === 2);
  const variants = (await h('GET', '/products')).json.flatMap((p) => p.variants);
  const sv = variants.find((v) => v.id === shirt.id);
  check('the shirt is marked made ahead with rate 80', sv.madeAhead === true && Number(sv.tailorRate) === 80, sv);
  check('the set is not made ahead', variants.find((v) => v.id === set.id).madeAhead === false);

  section('3. Tailors and jobs');
  check('a tailor needs a name', (await h('POST', '/tailoring/tailors', { name: 'A' })).status === 400);
  check('a bad phone number is refused', (await h('POST', '/tailoring/tailors', { name: 'Akinyi', phone: '12' })).status === 400);
  const akinyi = (await h('POST', '/tailoring/tailors', { name: `Akinyi ${tag}`, phone: '0712345678', idNumber: '12345678' })).json;
  const otieno = (await h('POST', '/tailoring/tailors', { name: `Otieno ${tag}` })).json;
  check('two tailors are added (phone normalized)', akinyi.id && otieno.id && akinyi.phone === '254712345678', akinyi);

  const preview = await h('GET', `/tailoring/materials?branchId=${branchId}&variantId=${shirt.id}&quantity=50`);
  check('the materials check for 50 shirts: 60 m fabric, 350 buttons, enough, costing 15,700', preview.status === 200 && preview.json.enough === true && near(preview.json.cost.total, 15700) && preview.json.lines.some((l) => l.quantity === 60), preview.json);
  const tooBig = await h('POST', '/tailoring/jobs', { branchId, tailorId: akinyi.id, variantId: shirt.id, quantity: 90 });
  check('a job needing more fabric than the store holds is refused', tooBig.status === 400 && /Not enough materials/.test(tooBig.json.message), tooBig.json);
  check('a piece with no materials list cannot be given out', (await h('POST', '/tailoring/jobs', { branchId, tailorId: akinyi.id, variantId: fabric.id, quantity: 1 })).status === 400);

  const job = await h('POST', '/tailoring/jobs', { branchId, tailorId: akinyi.id, variantId: shirt.id, quantity: 50, notes: 'Kisumu Girls order' });
  check('a job of 50 shirts is given out with a TJ number at the usual rate', job.status === 201 && /^TJ-\d{4}-\d{4}$/.test(job.json.jobNumber) && Number(job.json.ratePerPiece) === 80 && near(job.json.materialsCost, 15700), job.json);
  check('the materials left stock (40 m fabric, 150 buttons left)', near(await stock(fabric.id), 40) && near(await stock(buttons.id), 150));
  const job2 = await h('POST', '/tailoring/jobs', { branchId, tailorId: otieno.id, variantId: shorts.id, quantity: 20, ratePerPiece: 65 });
  check('a job of 20 shorts at a different rate (65)', job2.status === 201 && Number(job2.json.ratePerPiece) === 65, job2.json);

  section('4. Hand-ins');
  check('handing in nothing is refused', (await h('POST', `/tailoring/jobs/${job.json.id}/hand-in`, { goodQty: 0, rejectedQty: 0 })).status === 400);
  check('handing in more than is with the tailor is refused', (await h('POST', `/tailoring/jobs/${job.json.id}/hand-in`, { goodQty: 51 })).status === 400);
  const in1 = await h('POST', `/tailoring/jobs/${job.json.id}/hand-in`, { goodQty: 30, rejectedQty: 2, notes: 'first batch' });
  check('30 good and 2 rejected shirts are taken in, earning 2,400', in1.status === 201 && near(in1.json.handIn.labourAmount, 2400) && in1.json.job.status === 'OPEN', in1.json);
  check('each shirt costs its materials (314) + pay (80) = 394', near(in1.json.handIn.unitCost, 394), in1.json.handIn);
  check('30 shirts are now in stock at a cost of 394', (await stock(shirt.id)) === 30 && near(await cost(shirt.id), 394));
  const in2 = await h('POST', `/tailoring/jobs/${job.json.id}/hand-in`, { goodQty: 18 });
  check('the last 18 finish the job', in2.status === 201 && in2.json.job.status === 'DONE' && in2.json.job.quantityGood === 48 && in2.json.job.quantityRejected === 2, in2.json.job);
  check('a finished job takes no more hand-ins', (await h('POST', `/tailoring/jobs/${job.json.id}/hand-in`, { goodQty: 1 })).status === 400);
  const in3 = await h('POST', `/tailoring/jobs/${job2.json.id}/hand-in`, { goodQty: 15 });
  check('15 shorts taken in from Otieno (each 315 materials share... 1 m + 2 buttons = 254 + 65 = 319)', in3.status === 201 && near(in3.json.handIn.unitCost, 319), in3.json.handIn);
  check('the shorts job cannot be cancelled once pieces came in', (await h('POST', `/tailoring/jobs/${job2.json.id}/cancel`)).status === 400);
  const closed = await h('POST', `/tailoring/jobs/${job2.json.id}/close`, { reason: 'Tailor fell sick' });
  check('the shorts job is closed early with a reason', closed.status === 200 && closed.json.status === 'DONE' && closed.json.closeNote === 'Tailor fell sick', closed.json);
  const job3 = await h('POST', '/tailoring/jobs', { branchId, tailorId: otieno.id, variantId: shorts.id, quantity: 5 });
  const fabricBefore = await stock(fabric.id);
  const cancelled = await h('POST', `/tailoring/jobs/${job3.json.id}/cancel`);
  check('a job nothing came back on is cancelled and its 5 m of fabric return', cancelled.status === 200 && cancelled.json.status === 'CANCELLED' && near((await stock(fabric.id)) - fabricBefore, 5), cancelled.json);

  section('5. Tailor pay');
  let list = (await h('GET', '/tailoring/tailors')).json;
  let a = list.find((t) => t.id === akinyi.id);
  let o = list.find((t) => t.id === otieno.id);
  check('Akinyi earned 3,840 (48 x 80) and is owed it', near(a.earned, 3840) && near(a.owed, 3840) && a.piecesMade === 48, a);
  check('Otieno earned 975 (15 x 65)', near(o.earned, 975) && o.piecesWithTailor === 0, o);
  check('a payment needs a positive amount', (await h('POST', '/tailoring/payments', { tailorId: akinyi.id, amount: 0, method: 'CASH' })).status === 400);
  check('a payment cannot be dated in the future', (await h('POST', '/tailoring/payments', { tailorId: akinyi.id, amount: 100, method: 'CASH', paidOn: '2099-01-01' })).status === 400);
  const pay1 = await h('POST', '/tailoring/payments', { tailorId: akinyi.id, amount: 3000, method: 'MPESA', reference: 'SKX123' });
  const pay2 = await h('POST', '/tailoring/payments', { tailorId: akinyi.id, amount: 500, method: 'CASH' });
  check('two payments to Akinyi are recorded', pay1.status === 201 && pay2.status === 201);
  const voided = await h('POST', `/tailoring/payments/${pay2.json.id}/void`, { reason: 'Typed twice' });
  check('the cash payment is voided with a reason', voided.status === 200 && Boolean(voided.json.voidedAt));
  check('a voided payment cannot be voided again', (await h('POST', `/tailoring/payments/${pay2.json.id}/void`, { reason: 'again' })).status === 400);
  a = (await h('GET', '/tailoring/tailors')).json.find((t) => t.id === akinyi.id);
  check('Akinyi is now owed 840 (3,840 - 3,000; the voided 500 does not count)', near(a.paid, 3000) && near(a.owed, 840), a);
  const statement = (await h('GET', `/tailoring/tailors/${akinyi.id}/statement`)).json;
  check('her statement lists 2 hand-ins and 2 payments, ending at 840 owed', statement.lines.length === 4 && near(statement.lines.at(-1).owed, 840) && near(statement.owed, 840), statement.lines);
  const advance = await h('POST', '/tailoring/payments', { tailorId: otieno.id, amount: 1500, method: 'BANK' });
  o = (await h('GET', '/tailoring/tailors')).json.find((t) => t.id === otieno.id);
  check('paying Otieno more than owed shows an advance (owed -525)', advance.status === 201 && near(o.owed, -525), o);

  section('6. A school orders uniform sets');
  const slug = `uni-${tag}`;
  check('the ordering link is set up', (await h('PUT', '/school-supplier/portal', { slug, displayName: `Uniforms ${tag}` })).status === 200);
  check('the set and the shirt go on the school price list', (await h('PUT', '/school-supplier/price-list', { entries: [{ variantId: set.id, onSchoolList: true, schoolPrice: 1400 }, { variantId: shirt.id, onSchoolList: true }] })).status === 200);
  const phone = `07${String(Date.now()).slice(-8)}`;
  const school = (await h('POST', '/school-supplier/schools', { name: `Kisumu Boys ${tag}`, phone, creditDays: 30 })).json;
  const login = await call('POST', '/school-auth/login', { body: { slug, phone, pin: school.temporaryPin } });
  check('the school signs in', login.status === 200, login.json);
  const order = await call('POST', '/school-portal/orders', { token: login.json.accessToken, body: { lines: [{ variantId: set.id, quantity: 10 }, { variantId: shirt.id, quantity: 5 }] } });
  check('it orders 10 sets and 5 extra shirts', order.status === 201, order.json);
  const stockView = await h('GET', `/school-supplier/orders/${order.json.id}/stock?branchId=${branchId}`);
  const setLine = order.json.lines.find((l) => l.variantId === set.id);
  check('the stock column shows 15 sets can be made (48 shirts / 2, 15 shorts / 1)', stockView.json.lines.find((l) => l.lineId === setLine.id)?.available === 15, stockView.json);
  check('the order is confirmed', (await h('POST', `/school-supplier/orders/${order.json.id}/confirm`, {})).status < 300);
  const shirtsBefore = await stock(shirt.id);
  const shortsBefore = await stock(shorts.id);
  const delivery = await h('POST', `/school-supplier/orders/${order.json.id}/deliver`, { branchId, receivedByName: 'Mr Okoth' });
  check('the order is delivered', delivery.status < 300, delivery.json);
  check('10 sets + 5 shirts took 25 shirts and 10 shorts from stock', (await stock(shirt.id)) === shirtsBefore - 25 && (await stock(shorts.id)) === shortsBefore - 10, { shirts: await stock(shirt.id), shorts: await stock(shorts.id) });
  check('the set itself was never stocked', (await stock(set.id)) === 0);
  const inv = (await sql.query(`SELECT l."variantId", l."unitCost" FROM supplier_invoice_lines l JOIN supplier_invoices i ON i.id = l."invoiceId" WHERE i."orderId" = $1`, [order.json.id])).rows;
  const setCost = inv.find((r) => r.variantId === set.id)?.unitCost;
  check('the invoice costs a set as 2 shirts + 1 shorts (2 x 394 + 319 = 1,107)', near(setCost, 1107), inv);

  section('7. The books');
  await h('GET', '/accounting/overview');
  const posted = (await h('POST', '/accounting/post-now', {})).json;
  check('posting the books works', posted.failed === 0, posted);
  const work = (await h('GET', `/accounting/journals?sourceType=TAILOR_WORK&sourceId=${in1.json.handIn.id}`)).json.rows;
  check('the first hand-in is posted (pay into stock, owed to the tailor)', work.length === 1, work);
  const pays = (await h('GET', `/accounting/journals?sourceType=TAILOR_PAYMENT&sourceId=${pay1.json.id}`)).json.rows;
  check('the M-Pesa payment is posted', pays.length === 1, pays);
  check('the voided payment is not posted', (await h('GET', `/accounting/journals?sourceType=TAILOR_PAYMENT&sourceId=${pay2.json.id}`)).json.rows.length === 0);
  const accounts = (await h('GET', '/accounting/accounts')).json;
  const owedAcc = (Array.isArray(accounts) ? accounts : accounts.accounts ?? []).find((x) => x.systemKey === 'TAILORS_PAYABLE');
  check('the business has an "Owed to tailors" account', Boolean(owedAcc), accounts);
  const tb = (await h('GET', '/accounting/reports/trial-balance')).json;
  const owedRow = (tb.rows ?? tb.accounts ?? []).find((r) => r.systemKey === 'TAILORS_PAYABLE' || r.code === '2160');
  check('the trial balance balances', tb.balanced === true, { d: tb.debit, c: tb.credit });
  check('Owed to tailors = 4,815 earned - 4,500 paid = 315 (credit)', owedRow && near(Number(owedRow.credit ?? 0) - Number(owedRow.debit ?? 0), 315), owedRow);

  section('8. Another business cannot see any of it');
  const other = (await call('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('another business sees none of these tailors', !(await h('GET', '/tailoring/tailors', undefined, other)).json.some((t) => t.id === akinyi.id));
  check("another business cannot open this business's job", (await h('GET', `/tailoring/jobs/${job.json.id}`, undefined, other)).status === 404);
  check("another business cannot hand in on it", (await h('POST', `/tailoring/jobs/${job2.json.id}/hand-in`, { goodQty: 1 }, other)).status === 404);

  section('9. At the till (demo business): a piece sells from its stock, a set from its pieces');
  const dh = (m, p, body) => call(m, p, { token: other, body });
  const dBranch = (await dh('GET', '/branches')).json[0].id;
  const dOrg = (await dh('GET', '/organizations/me')).json;
  const mk = async (name, sku, price) => (await dh('POST', `/products/${(await dh('POST', '/products', { name: `${name} ${tag}` })).json.id}/variants`, { sku: `${sku}-${tag}`, price })).json;
  const cloth = await mk('Till fabric', 'TFAB', 100);
  const tshirt = await mk('Till shirt', 'TSH', 600);
  const tset = await mk('Till set', 'TSET', 1000);
  await dh('POST', '/inventory/transactions', { branchId: dBranch, variantId: cloth.id, type: 'ADJUSTMENT', quantityDelta: 10, unitCost: 100 });
  await dh('POST', '/inventory/transactions', { branchId: dBranch, variantId: tshirt.id, type: 'ADJUSTMENT', quantityDelta: 10, unitCost: 300 });
  await dh('PUT', `/recipes/${tshirt.id}`, { ingredients: [{ ingredientVariantId: cloth.id, quantity: 1 }], madeAhead: true });
  await dh('PUT', `/recipes/${tset.id}`, { ingredients: [{ ingredientVariantId: tshirt.id, quantity: 2 }] });
  const terminalId = (await sql.query('SELECT id FROM terminals WHERE "branchId" = $1 ORDER BY "createdAt" LIMIT 1', [dBranch])).rows[0].id;
  const ownerOrgUserId = (await sql.query(`SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou."userId" WHERE u.email = 'owner@demo.zaroda.pos' AND ou."organizationId" = $1`, [dOrg.id])).rows[0].id;
  const till = await call('POST', '/auth/pin-login', { body: { terminalId, orgUserId: ownerOrgUserId, pin: '1234' } });
  const ts = (variantId, qty, amount) =>
    call('POST', '/sales', { token: other, body: { clientId: randomUUID(), branchId: dBranch, terminalId, cashierSessionId: till.json.cashierSessionId, lineItems: [{ variantId, quantity: qty }], payments: [{ method: 'CASH', amount }] } });
  const dStock = async (id) => Number((await dh('GET', `/inventory/items/${dBranch}/${id}`)).json?.quantity ?? 0);
  const s1 = await ts(tshirt.id, 1, 600);
  check('a made-ahead shirt sold at the till', s1.status === 201, s1.json);
  check('...takes the shirt from stock, not its fabric', (await dStock(tshirt.id)) === 9 && (await dStock(cloth.id)) === 10, { shirt: await dStock(tshirt.id), cloth: await dStock(cloth.id) });
  const s2 = await ts(tset.id, 1, 1000);
  check('a set sold at the till takes 2 shirts', s2.status === 201 && (await dStock(tshirt.id)) === 7 && (await dStock(cloth.id)) === 10, s2.json);

  console.log(`\n${passed} passed, ${failures.length} failed`);
  await sql.end();
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  void sleep;
})().catch(async (e) => {
  console.error(e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
