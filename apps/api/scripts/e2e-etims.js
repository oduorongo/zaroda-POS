// End-to-end test of the eTIMS foundation against a LOCAL test setup and the PRETEND KRA (scripts/mock-kra.js): the business's switch and
// PIN, connecting a branch's device, the key kept encrypted, KRA's code lists downloaded in full and then only what changed, and what
// happens when KRA is unreachable. It never touches the live system or the real KRA.
//
// Needs running: the test Postgres (5433), the pretend KRA (node scripts/mock-kra.js), and the API started with the test settings
// (ETIMS_SANDBOX_URL pointing at the pretend KRA).   node scripts/e2e-etims.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
const { Client } = require(
  require.resolve('pg', { paths: [API_DIR, process.env.PG_DIR || API_DIR] }),
);
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
for (const key of ['DATABASE_URL', 'DIRECT_URL'])
  if (live[key] && hostOf(env[key]) === hostOf(live[key]))
    throw new Error(`REFUSING: ${key} is the LIVE database`);
const dbUrl = new URL(env.DIRECT_URL);
if (!(dbUrl.hostname === 'localhost' && dbUrl.port === '5433'))
  throw new Error(
    'REFUSING: .env.local does not point at the local test database',
  );
if (!/^http:\/\/localhost:\d+\//.test(env.ETIMS_SANDBOX_URL || ''))
  throw new Error('REFUSING: ETIMS_SANDBOX_URL is not a local pretend KRA');

const API = 'http://localhost:3001';
const KRA = env.ETIMS_SANDBOX_URL.replace(/\/etims-api\/?$/, '');
let passed = 0;
const failures = [];
const check = (name, ok, detail) => {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(
      `  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 500) : ''}`,
    );
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(base, method, p, { token, body } = {}) {
  const response = await fetch(base + p, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    json: await response.json().catch(() => ({})),
  };
}
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36);
const rand = (n) =>
  Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
const PIN = `A${rand(9)}Z`;

(async () => {
  await sql.connect();
  const h = (m, p, body, token = owner) => call(API, m, p, { token, body });
  const kra = (m, p) => call(KRA, m, p);
  let owner;

  section('1. Setting up');
  check('API ready', (await call(API, 'GET', '/ready')).status === 200);
  check(
    'the pretend KRA is running',
    (await kra('GET', '/_test/requests')).status === 200,
  );
  owner = (
    await call(API, 'POST', '/auth/login', {
      body: { email: 'owner@demo.zaroda.pos', password: 'password123' },
    })
  ).json.accessToken;
  check('owner can sign in', Boolean(owner));
  const org = (await h('GET', '/organizations/me')).json;
  const branches = (await h('GET', '/branches')).json;
  const branchId = branches[0].id;
  await kra('POST', '/_test/reset');
  // KRA's lists are shared data: start this run from nothing so the first download is a full one
  await sql.query('DELETE FROM etims_sync_state');
  await sql.query('DELETE FROM etims_codes');
  await sql.query('DELETE FROM etims_item_classes');
  await sql.query('DELETE FROM etims_documents WHERE "organizationId" = $1', [org.id]);
  await sql.query('DELETE FROM etims_items WHERE "organizationId" = $1', [org.id]);
  await sql.query('DELETE FROM etims_purchase_invoices WHERE "organizationId" = $1', [org.id]);
  await sql.query('DELETE FROM etims_supplier_items WHERE "organizationId" = $1', [org.id]);
  await sql.query('DELETE FROM etims_devices WHERE "organizationId" = $1', [
    org.id,
  ]);
  await sql.query('DELETE FROM etims_settings WHERE "organizationId" = $1', [
    org.id,
  ]);
  await kra('POST', '/_test/many-classes?n=2500');
  const kraHas = (await kra('GET', '/_test/counts')).json;
  const email = `cashier-etims-${tag}@demo.zaroda.pos`;
  await h('POST', '/org-users', {
    email,
    fullName: 'Etims Cashier',
    password: 'password123',
    role: 'CASHIER',
    branchId,
  });
  const cashier = (
    await call(API, 'POST', '/auth/login', {
      body: { email, password: 'password123' },
    })
  ).json.accessToken;
  check('a cashier can sign in', Boolean(cashier));

  section('2. The switch and the PIN');
  const first = await h('GET', '/etims/settings');
  check(
    'eTIMS starts off, in the sandbox, with live KRA marked not available',
    first.status === 200 &&
      first.json.enabled === false &&
      first.json.environment === 'SANDBOX' &&
      first.json.productionAvailable === false &&
      first.json.tin === null,
    first.json,
  );
  check(
    'each branch is listed with no device yet',
    first.json.branches.length >= 1 &&
      first.json.branches.every((b) => b.device === null),
  );
  check(
    'a cashier cannot see or change it; no sign-in is refused',
    (await h('GET', '/etims/settings', undefined, cashier)).status === 403 &&
      (await h('PUT', '/etims/settings', { enabled: true }, cashier)).status ===
        403 &&
      (await call(API, 'GET', '/etims/settings')).status === 401,
  );
  check(
    'turning it on with no PIN is refused',
    (await h('PUT', '/etims/settings', { enabled: true })).status === 400,
  );
  check(
    'something that is not a PIN is refused',
    (await h('PUT', '/etims/settings', { tin: '12345' })).status === 400,
  );
  check(
    'live KRA is refused for now',
    (await h('PUT', '/etims/settings', { environment: 'PRODUCTION' }))
      .status === 400,
  );
  const set = await h('PUT', '/etims/settings', {
    tin: ` ${PIN.toLowerCase()} `,
    enabled: true,
  });
  check(
    'the owner enters the PIN (tidied to capitals) and turns it on',
    set.status === 200 && set.json.enabled === true && set.json.tin === PIN,
    set.json,
  );
  check(
    'connecting a device or downloading codes before a device is connected is refused',
    (await h('POST', '/etims/codes/sync', {})).status === 400,
  );

  section('3. Connecting a branch to KRA');
  check(
    'a wrong branch ID is refused before KRA is called',
    (
      await h('POST', `/etims/devices/${branchId}/connect`, {
        bhfId: '0',
        dvcSrlNo: `S-${tag}`,
      })
    ).status === 400 && (await kra('GET', '/_test/requests')).json.length === 0,
  );
  const unknown = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `UNKNOWN-${tag}`,
  });
  check(
    'a device KRA does not know is refused with a plain explanation',
    unknown.status === 400 &&
      /does not recognise this device/.test(unknown.json.message),
    unknown.json,
  );
  check(
    'and the branch shows the failure',
    (await h('GET', '/etims/settings')).json.branches.find(
      (b) => b.branchId === branchId,
    ).device.status === 'FAILED',
  );
  const wrongPin = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `OTHERPIN-${tag}`,
  });
  check(
    'a device KRA ties to a different PIN is refused',
    wrongPin.status === 400 && /different PIN/.test(wrongPin.json.message),
    wrongPin.json,
  );
  await kra('POST', '/_test/fail-next?n=1&mode=894');
  const down = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `S-${tag}`,
  });
  check(
    'KRA unreachable says so, in plain words',
    down.status === 400 && /Could not reach KRA/.test(down.json.message),
    down.json,
  );
  const conn = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `S-${tag}`,
  });
  const dev = conn.json.branches?.find((b) => b.branchId === branchId)?.device;
  check(
    "the device connects: active, with KRA's branch name and a key kept",
    conn.status === 200 &&
      dev?.status === 'ACTIVE' &&
      dev.bhfNm === 'Headquarter' &&
      dev.hasKey === true,
    conn.json.message || dev,
  );
  check(
    "KRA's name for the taxpayer is recorded",
    typeof conn.json.taxpayerName === 'string' &&
      /Test Taxpayer/.test(conn.json.taxpayerName),
    conn.json.taxpayerName,
  );
  const sent = (await kra('GET', '/_test/requests')).json
    .filter((r) => r.method === 'selectInitOsdcInfo')
    .pop();
  check(
    'KRA was sent the PIN, branch ID and serial exactly as the spec says',
    sent.body.tin === PIN &&
      sent.body.bhfId === '00' &&
      sent.body.dvcSrlNo === `S-${tag}` &&
      !('cmcKey' in sent.body),
    sent.body,
  );
  const stored = (
    await sql.query(
      'SELECT "cmcKeyEnc" k FROM etims_devices WHERE "branchId" = $1',
      [branchId],
    )
  ).rows[0].k;
  check(
    'the key is stored encrypted (not the 32 characters KRA sent)',
    stored && stored.startsWith('v1:') && !/^[0-9a-f]{32}$/.test(stored),
    stored,
  );
  check(
    'no response ever contains a key',
    !/cmcKey|v1:/.test(JSON.stringify(conn.json)) &&
      !/v1:/.test(JSON.stringify((await h('GET', '/etims/settings')).json)),
  );
  const again = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `S-${tag}`,
  });
  check(
    'connecting a connected branch again is refused, and the key is not thrown away',
    again.status === 409 &&
      /already connected/.test(again.json.message) &&
      (
        await sql.query(
          'SELECT "cmcKeyEnc" k FROM etims_devices WHERE "branchId" = $1',
          [branchId],
        )
      ).rows[0].k === stored,
    again.json,
  );
  check(
    'the PIN cannot be changed while a device is connected under it',
    (await h('PUT', '/etims/settings', { tin: `P${rand(9)}K` })).status === 409,
  );

  section("4. KRA's code lists: all of it the first time");
  const sync1 = await h('POST', '/etims/codes/sync', {});
  check(
    `the first download brings everything (${kraHas.codes} codes and ${kraHas.itemClasses} classifications)`,
    sync1.status === 200 &&
      sync1.json.codes === kraHas.codes &&
      sync1.json.itemClasses === kraHas.itemClasses &&
      kraHas.itemClasses > 2500 &&
      sync1.json.upToDate === false,
    sync1.json,
  );
  const reqs = (await kra('GET', '/_test/requests')).json.filter(
    (r) => r.method === 'selectCodeList' || r.method === 'selectItemClsList',
  );
  const key = reqs[0].body.cmcKey;
  check(
    'KRA was asked from the very beginning, with the PIN, branch ID and the key',
    reqs.length === 2 &&
      reqs.every(
        (r) =>
          r.body.lastReqDt === '20180101000000' &&
          r.body.tin === PIN &&
          r.body.bhfId === '00' &&
          /^[0-9a-f]{32}$/.test(r.body.cmcKey),
      ),
    reqs.map((r) => r.body),
  );
  check(
    'the key KRA sees is the one it handed out (decrypted correctly)',
    key && !stored.includes(key),
  );
  const summary = (await h('GET', '/etims/codes/summary')).json;
  check(
    'the screen can say how much is downloaded and when',
    summary.codes === kraHas.codes &&
      summary.itemClasses === kraHas.itemClasses &&
      summary.lastSyncedAt,
    summary,
  );
  const tax = (await h('GET', '/etims/codes?cls=04')).json[0];
  check(
    'the tax types are there with their rates (A exempt, B 16%, E 8%)',
    tax.cdClsNm === 'Taxation Type' &&
      tax.codes.map((c) => `${c.cd}:${c.userDfnCd1}`).join() ===
        'A:0,B:16,C:0,D:0,E:8',
    tax,
  );
  const allCodes = (await h('GET', '/etims/codes')).json;
  check(
    'every list the integration needs is down: units, packaging, payment, receipts, credit-note reasons, product types',
    ['10', '17', '07', '37', '32', '24'].every((c) =>
      allCodes.some((g) => g.cdCls === c),
    ),
    allCodes.map((g) => g.cdCls),
  );
  const flour = (await h('GET', '/etims/item-classes?search=flour')).json;
  check(
    'a classification can be searched by name',
    flour.length === 1 &&
      flour[0].itemClsCd === '5059690800' &&
      flour[0].taxTyCd === 'B',
    flour,
  );
  check(
    'and by code, with a limit',
    (await h('GET', '/etims/item-classes?search=70000000&limit=5')).json
      .length === 5 &&
      (await h('GET', '/etims/item-classes?limit=500')).status === 400,
  );
  check(
    'a cashier cannot read the lists',
    (await h('GET', '/etims/codes', undefined, cashier)).status === 403,
  );

  section('5. Next time: only what changed');
  const before = (await kra('GET', '/_test/requests')).json.length;
  const markBefore = (
    await sql.query(
      `SELECT "lastReqDt" l FROM etims_sync_state WHERE kind = 'codes'`,
    )
  ).rows[0].l;
  const sync2 = await h('POST', '/etims/codes/sync', {});
  check(
    'nothing changed at KRA, so nothing comes down',
    sync2.status === 200 &&
      sync2.json.upToDate === true &&
      sync2.json.codes === 0 &&
      sync2.json.itemClasses === 0,
    sync2.json,
  );
  const second = (await kra('GET', '/_test/requests')).json
    .slice(before)
    .filter((r) => r.method === 'selectCodeList');
  check(
    'and KRA was asked from where the last download ended, not from the beginning',
    second[0].body.lastReqDt > '20250101000000' &&
      second[0].body.lastReqDt === markBefore,
    second[0]?.body,
  );
  await new Promise((r) => setTimeout(r, 1100));
  await kra('POST', '/_test/bump-codes');
  const sync3 = await h('POST', '/etims/codes/sync', {});
  check(
    'KRA changes one unit and adds a unit and a classification: exactly those come down',
    sync3.status === 200 &&
      sync3.json.codes === 2 &&
      sync3.json.itemClasses === 1,
    sync3.json,
  );
  const units = (await h('GET', '/etims/codes?cls=10')).json[0].codes;
  check(
    'the changed unit has its new name, the new one is there, and nothing was lost',
    units.some((u) => /^Kilo-Gramme \d{4}$/.test(u.cdNm)) &&
      units.some((u) => u.cdNm === 'New unit') &&
      units.some((u) => u.cd === 'L'),
    units.map((u) => u.cd),
  );
  check(
    'the classifications are now one more than before, with no duplicates',
    (await sql.query(`SELECT count(*)::int n FROM etims_item_classes`)).rows[0]
      .n ===
      kraHas.itemClasses + 1,
  );

  section('6. When KRA misbehaves');
  const stateBefore = (
    await sql.query(
      `SELECT "lastReqDt" l FROM etims_sync_state WHERE kind = 'codes'`,
    )
  ).rows[0].l;
  await kra('POST', '/_test/fail-next?n=1&mode=894');
  const f1 = await h('POST', '/etims/codes/sync', {});
  check(
    'KRA unreachable during a download: a clear message',
    f1.status === 400 && /Could not reach KRA/.test(f1.json.message),
    f1.json,
  );
  await kra('POST', '/_test/fail-next?n=1&mode=http500');
  const f2 = await h('POST', '/etims/codes/sync', {});
  check(
    'KRA answering with an error page: a clear message, nothing broken',
    f2.status === 400 && /Could not reach KRA|not JSON/.test(f2.json.message),
    f2.json,
  );
  await kra('POST', '/_test/fail-next?n=1&mode=999');
  check(
    "KRA's own unknown error is reported",
    (await h('POST', '/etims/codes/sync', {})).status === 400,
  );
  check(
    'none of those moved the "last downloaded" mark',
    (
      await sql.query(
        `SELECT "lastReqDt" l FROM etims_sync_state WHERE kind = 'codes'`,
      )
    ).rows[0].l === stateBefore,
  );
  check(
    'and the next download works again',
    (await h('POST', '/etims/codes/sync', {})).status === 200,
  );

  section("7. Products as KRA knows them");
  const vat = (await h('POST', '/tax-classes', { name: `ETIMS VAT ${tag}`, rate: 0.16, isExempt: false })).json;
  const exempt = (await h('POST', '/tax-classes', { name: `ETIMS exempt ${tag}`, rate: 0, isExempt: true })).json;
  const mk = async (name, taxClassId, price = 100) => {
    const p = (await h('POST', '/products', { name: `${name} ${tag}`, taxClassId })).json;
    const v = (await h('POST', `/products/${p.id}/variants`, { sku: `${name.slice(0, 4).toUpperCase()}-${tag}`, price })).json;
    return { p, v };
  };
  const unga = await mk('Unga', vat.id, 100);
  const rice = await mk('Rice', exempt.id, 250);
  const odd = await mk('REJECTME', vat.id, 50);
  const plain = await mk('Plain', undefined, 30);
  await sql.query("UPDATE product_variants SET \"quantityMode\" = 'WEIGHT' WHERE id = $1", [rice.v.id]);
  const mine = (r) => r.json.rows.filter((x) => [unga, rice, odd, plain].some((m) => m.v.id === x.variantId));
  const l1 = await h('GET', `/etims/items?search=${tag}`);
  check('the new products are listed and need setting up (no classification yet)', l1.status === 200 && mine(l1).length === 4 && mine(l1).every((x) => x.state === 'NEEDS_SETUP' && x.problems.length > 0), mine(l1));
  const byId = (r, m) => r.json.rows.find((x) => x.variantId === m.v.id);
  check('the tax type is worked out: 16% is B, exempt is A, no tax class is D; weight is sold by KG', byId(l1, unga).taxTyCd === 'B' && byId(l1, rice).taxTyCd === 'A' && byId(l1, plain).taxTyCd === 'D' && byId(l1, rice).qtyUnitCd === 'KG' && byId(l1, unga).qtyUnitCd === 'U', l1.json.rows.map((x) => [x.sku, x.taxTyCd, x.qtyUnitCd]));
  check('a cashier cannot see or change KRA items', (await h('GET', '/etims/items', undefined, cashier)).status === 403 && (await h('PUT', `/etims/items/${unga.v.id}`, { itemClsCd: '5059690800' }, cashier)).status === 403 && (await h('POST', '/etims/items/register', { all: true }, cashier)).status === 403);
  check('a classification KRA does not have is refused', (await h('PUT', `/etims/items/${unga.v.id}`, { itemClsCd: '99999999' })).status === 400);
  check('a unit KRA does not list is refused; a tax type outside A-E is refused', (await h('PUT', `/etims/items/${unga.v.id}`, { qtyUnitCd: 'ZZZ' })).status === 400 && (await h('PUT', `/etims/items/${unga.v.id}`, { taxTyCd: 'Q' })).status === 400);
  const cls = await h('POST', '/etims/items/classify', { variantIds: [unga.v.id, rice.v.id, odd.v.id], itemClsCd: '5059690800' });
  check('one classification is given to three products at once', cls.status === 200 && cls.json.updated === 3, cls.json);
  const l2 = await h('GET', `/etims/items?search=${tag}`);
  check('they are now ready to send; the one with no classification still needs setting up', byId(l2, unga).state === 'READY' && byId(l2, rice).state === 'READY' && byId(l2, odd).state === 'READY' && byId(l2, plain).state === 'NEEDS_SETUP');
  check('the list can be filtered by state', (await h('GET', `/etims/items?search=${tag}&state=READY`)).json.rows.length === 3 && (await h('GET', '/etims/items?state=BOGUS')).status === 400);
  const unsetup = await h('POST', '/etims/items/register', { variantIds: [plain.v.id] });
  check('an item that is not set up is not sent, and says what is missing', unsetup.status === 200 && unsetup.json.sent === 0 && unsetup.json.failed.length === 1 && /classification/.test(unsetup.json.failed[0].message), unsetup.json);
  await kra('POST', '/_test/clear-items');
  const seqBefore = (await sql.query('SELECT "itemSeq" s FROM etims_settings WHERE "organizationId" = $1', [org.id])).rows[0].s;
  const reg1 = await h('POST', '/etims/items/register', { variantIds: [unga.v.id, rice.v.id, odd.v.id] });
  check('three items are sent: two accepted, and the one KRA refuses is reported with its reason', reg1.status === 200 && reg1.json.sent === 2 && reg1.json.failed.length === 1 && /991/.test(reg1.json.failed[0].message), reg1.json);
  const saved = (await kra('GET', '/_test/items')).json;
  const sentUnga = saved.find((s) => s.itemNm === `Unga ${tag}`);
  check('KRA holds them with their own unique codes in the spec pattern', saved.length === 2 && saved.every((s) => /^KE2NT(U|KG)\d{7}$/.test(s.itemCd)) && new Set(saved.map((s) => s.itemCd)).size === 2, saved.map((s) => s.itemCd));
  check('the price KRA is told has the tax in it (100 + 16% = 116) and the exempt rice is not taxed', sentUnga.dftPrc === 116 && saved.find((s) => s.itemNm === `Rice ${tag}`).dftPrc === 250 && sentUnga.taxTyCd === 'B', saved.map((s) => [s.itemNm, s.dftPrc, s.taxTyCd]));
  check('KRA was sent the PIN, branch ID and key with each item', (await kra('GET', '/_test/requests')).json.filter((r) => r.method === 'saveItem').every((r) => r.body.tin === PIN && r.body.bhfId === '00' && /^[0-9a-f]{32}$/.test(r.body.cmcKey)));
  const l3 = await h('GET', `/etims/items?search=${tag}`);
  check('the list shows two registered and one rejected with the reason', byId(l3, unga).state === 'REGISTERED' && byId(l3, rice).state === 'REGISTERED' && byId(l3, odd).state === 'REJECTED' && /991/.test(byId(l3, odd).lastError), mine(l3).map((x) => [x.sku, x.state]));
  check('the counter moved by the three codes made', (await sql.query('SELECT "itemSeq" s FROM etims_settings WHERE "organizationId" = $1', [org.id])).rows[0].s === seqBefore + 3);
  const sendAgain = await h('POST', '/etims/items/register', { variantIds: [unga.v.id, rice.v.id] });
  check('sending registered, unchanged items again sends nothing', sendAgain.json.sent === 0 && sendAgain.json.skipped === 2 && (await kra('GET', '/_test/items')).json.length === 2);
  await sql.query('UPDATE product_variants SET price = 120 WHERE id = $1', [unga.v.id]);
  check('a price change shows "needs update"', byId(await h('GET', `/etims/items?search=${tag}`), unga).state === 'NEEDS_UPDATE');
  const upd = await h('POST', '/etims/items/register', { all: true });
  check('"send everything that is ready or changed" sends just that one (the rejected one is left for you to fix)', upd.json.sent === 1 && upd.json.failed.length === 0, upd.json);
  const after = (await kra('GET', '/_test/items')).json.find((s) => s.itemNm === `Unga ${tag}`);
  check('KRA has the new price on the SAME item code', after.dftPrc === 139.2 && after.itemCd === sentUnga.itemCd, after);
  check('the item code never changes', byId(await h('GET', `/etims/items?search=${tag}`), unga).itemCd === sentUnga.itemCd);
  await sql.query("UPDATE products SET name = $2 WHERE id = $1", [odd.p.id, `Fixed ${tag}`]);
  const fix = await h('PUT', `/etims/items/${odd.v.id}`, { itemTyCd: '2' });
  check('fixing a rejected item reopens it', fix.status === 200 && fix.json.state === 'READY', fix.json);
  await kra('POST', '/_test/fail-next?n=1&mode=894');
  const downReg = await h('POST', '/etims/items/register', { variantIds: [odd.v.id] });
  const oddCode = byId(await h('GET', `/etims/items?search=${tag}`), odd).itemCd;
  check('KRA unreachable stops the round with a clear message; the item stays unsent and keeps its code', downReg.json.stopped && /Could not reach KRA/.test(downReg.json.stopped) && downReg.json.sent === 0 && Boolean(oddCode), downReg.json);
  const okReg = await h('POST', '/etims/items/register', { variantIds: [odd.v.id] });
  check('the next try sends it under the same code', okReg.json.sent === 1 && (await kra('GET', '/_test/items')).json.some((s) => s.itemCd === oddCode), okReg.json);
  await sql.query('UPDATE products SET "isActive" = false, "archivedAt" = now() WHERE id = $1', [rice.p.id]);
  check('an archived product is left out of the list', byId(await h('GET', `/etims/items?search=${tag}`), rice) === undefined);
  const r = (await sql.query("SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'etims_items'")).rows[0];
  check('etims_items has row-level security switched on and forced', r?.on === true && r?.forced === true, r);
  await sql.query('UPDATE products SET "isActive" = true, "archivedAt" = null WHERE id = $1', [rice.p.id]);

  section('8. Sales, refunds and stock go to KRA');
  const { randomUUID } = require('crypto');
  const terminalId = (await sql.query('SELECT id FROM terminals WHERE "branchId" = $1 ORDER BY "createdAt" LIMIT 1', [branchId])).rows[0].id;
  const ownerOrgUserId = (await sql.query("SELECT ou.id FROM org_users ou JOIN users u ON u.id = ou.\"userId\" WHERE u.email = 'owner@demo.zaroda.pos' AND ou.\"organizationId\" = $1", [org.id])).rows[0].id;
  const till = await call(API, 'POST', '/auth/pin-login', { body: { terminalId, orgUserId: ownerOrgUserId, pin: '1234' } });
  const cashierSessionId = till.json.cashierSessionId;
  check('a till session exists', Boolean(cashierSessionId), till.json);
  const mk2 = async (name, taxClassId, price) => {
    const p = (await h('POST', '/products', { name: `${name} ${tag}`, taxClassId })).json;
    const v = (await h('POST', `/products/${p.id}/variants`, { sku: `S${name.slice(0, 5).toUpperCase()}-${tag}`, price })).json;
    return { p, v };
  };
  const sa = await mk2('SaleA', vat.id, 100);
  const sb = await mk2('SaleB', exempt.id, 250);
  const sc = await mk2('SaleC', vat.id, 40);
  const sell = (lines, pay, body = {}) =>
    h('POST', '/sales', {
      clientId: randomUUID(), branchId, terminalId, cashierSessionId,
      lineItems: lines.map(([m, quantity]) => ({ variantId: m.v.id, quantity })),
      payments: [{ method: 'CASH', amount: pay }],
      ...body,
    });
  const docOf = async (saleId) => (await sql.query('SELECT * FROM etims_documents WHERE "saleId" = $1 ORDER BY "createdAt"', [saleId])).rows;
  const run = () => h('POST', '/etims/documents/run', {});
  await kra('POST', '/_test/clear-documents');

  const earlier = await sell([[sa, 1]], 116);
  check('a sale made before sending is switched on is recorded', earlier.status === 201, earlier.json);
  const off = await run();
  check('nothing is queued while sending is off', off.status === 200 && off.json.queued === 0 && (await docOf(earlier.json.id)).length === 0, off.json);
  check('a cashier cannot switch sending on', (await h('PUT', '/etims/settings', { sendSales: true }, cashier)).status === 403);
  const on = await h('PUT', '/etims/settings', { sendSales: true });
  check('the owner switches it on, and it says from when', on.status === 200 && on.json.sendSales === true && Boolean(on.json.salesStartAt), on.json);
  await new Promise((r) => setTimeout(r, 1100));

  // register two of the three new products; the third is left unregistered on purpose
  await h('POST', '/etims/items/classify', { variantIds: [sa.v.id, sb.v.id, sc.v.id], itemClsCd: '5059690800' });
  await h('POST', '/etims/items/register', { variantIds: [sa.v.id, sb.v.id] });

  const s1 = await sell([[sa, 2], [sb, 1]], 482);
  check('a sale of two registered products (232 with VAT + 250 exempt) is recorded', s1.status === 201 && Number(s1.json.total) === 482, s1.json);
  const r1 = await run();
  check('one pass queues and sends it', r1.status === 200 && r1.json.queued === 1 && r1.json.sent === 1 && r1.json.stopped === null, r1.json);
  check('the earlier sale was not sent', (await docOf(earlier.json.id)).length === 0);
  const d1 = (await docOf(s1.json.id))[0];
  check("the document is sent with all three steps done, and KRA's receipt details kept", d1.status === 'SENT' && d1.saleDone && d1.stockDone && d1.masterDone && d1.invcNo >= 1 && d1.curRcptNo > 0 && /^[0-9A-F]+$/.test(d1.rcptSign || '') && Boolean(d1.intrlData), d1);
  const ksales = (await kra('GET', '/_test/sales')).json;
  const ks1 = ksales.find((x) => x.invcNo === d1.invcNo);
  check('KRA holds one sale with the tax inside each amount: B 232 (tax 32), A 250, total 482', ksales.length === 1 && ks1.rcptTyCd === 'S' && ks1.taxblAmtB === 232 && ks1.taxAmtB === 32 && ks1.taxblAmtA === 250 && ks1.totAmt === 482 && ks1.totItemCnt === 2 && ks1.pmtTyCd === '01', ks1);
  check('KRA was told our own reference (the sale id) and the PIN and branch', ks1.trdInvcNo === s1.json.id && ks1.tin === PIN && ks1.bhfId === '00');
  const kio = (await kra('GET', '/_test/stock-io')).json;
  check('stock went out (type 11) for both lines', kio.length === 1 && kio[0].sarTyCd === '11' && kio[0].itemList.length === 2 && kio[0].sarNo === d1.sarNo, kio);
  const levels = (await kra('GET', '/_test/stock-levels')).json;
  check('KRA was told what is left of each item', Object.keys(levels).length === 2 && Object.values(levels).every((q) => typeof q === 'number' && q >= 0), levels);
  const r1b = await run();
  check('running again sends nothing twice', r1b.json.queued === 0 && r1b.json.sent === 0 && (await kra('GET', '/_test/sales')).json.length === 1);

  // a product KRA does not have yet
  const s2 = await sell([[sc, 1]], 46.4);
  const r2 = await run();
  const d2 = (await docOf(s2.json.id))[0];
  check('a sale of an unregistered product is not sent; it waits and says which product', s2.status === 201 && r2.json.sent === 0 && r2.json.waiting === 1 && d2.status === 'PENDING' && /SaleC/.test(d2.lastError) && d2.invcNo === null, d2);
  await h('POST', '/etims/items/register', { variantIds: [sc.v.id] });
  await sql.query('UPDATE etims_documents SET "nextAttemptAt" = NULL WHERE id = $1', [d2.id]);
  const r2b = await run();
  check('once the product is registered, the waiting sale goes through', r2b.json.sent === 1 && (await docOf(s2.json.id))[0].status === 'SENT');
  check('invoice numbers run on one by one with no gaps', (await docOf(s2.json.id))[0].invcNo === d1.invcNo + 1);

  // KRA down, and a failure part-way
  const s3 = await sell([[sa, 1]], 116);
  await kra('POST', '/_test/fail-next?n=1&mode=894');
  const r3 = await run();
  const d3 = (await docOf(s3.json.id))[0];
  check('KRA unreachable: the pass stops, the document stays pending with a retry time, and keeps its number', r3.json.stopped && /Could not reach KRA/.test(r3.json.stopped) && d3.status === 'PENDING' && d3.attempts === 1 && d3.nextAttemptAt !== null && d3.invcNo === d1.invcNo + 2 && !d3.saleDone, d3);
  const r3a = await run();
  check('it is not tried again before the retry time', r3a.json.sent === 0 && (await docOf(s3.json.id))[0].attempts === 1);
  await kra('POST', '/_test/fail-next?n=1&mode=894&only=insertStockIO');
  await sql.query('UPDATE etims_documents SET "nextAttemptAt" = NULL WHERE id = $1', [d3.id]);
  const r3b = await run();
  const d3b = (await docOf(s3.json.id))[0];
  check('the sale step went through but the stock step failed: it remembers the sale step', r3b.json.stopped && d3b.saleDone && !d3b.stockDone && d3b.status === 'PENDING', d3b);
  await sql.query('UPDATE etims_documents SET "nextAttemptAt" = NULL WHERE id = $1', [d3.id]);
  const r3c = await run();
  const d3c = (await docOf(s3.json.id))[0];
  check('the next try carries on from the stock step and the sale is NOT sent again', r3c.json.sent === 1 && d3c.status === 'SENT' && d3c.invcNo === d3.invcNo && (await kra('GET', '/_test/sales')).json.filter((x) => x.invcNo === d3.invcNo).length === 1, d3c);

  // KRA refuses a sale
  const cust = (await h('POST', '/customers', { name: 'REJECTSALE Customer', phone: `07${rand(8)}` })).json;
  const s4 = await sell([[sa, 1]], 116, { customerId: cust.id });
  const r4 = await run();
  const d4 = (await docOf(s4.json.id))[0];
  check('a sale KRA refuses is marked rejected with the reason, and the pass carries on', r4.json.rejected === 1 && d4.status === 'REJECTED' && /910|wrong/.test(d4.lastError) && r4.json.stopped === null, d4);
  const r4a = await run();
  check('a rejected document is not tried again by itself', r4a.json.sent === 0 && (await docOf(s4.json.id))[0].attempts === d4.attempts);
  await sql.query('UPDATE customers SET name = $2 WHERE id = $1', [cust.id, 'Fixed Customer']);
  check('a cashier cannot retry', (await h('POST', `/etims/documents/${d4.id}/retry`, {}, cashier)).status === 403);
  const retried = await h('POST', `/etims/documents/${d4.id}/retry`, {});
  check('after fixing it, retry puts it back in the queue', retried.status === 200 && retried.json.status === 'PENDING');
  check('and it then goes through', (await run()).json.sent === 1 && (await docOf(s4.json.id))[0].status === 'SENT');

  // refunds
  const full = await h('POST', `/sales/${s1.json.id}/refunds`, { clientId: randomUUID(), amount: 482, reason: 'Customer returned everything', approvedById: ownerOrgUserId });
  check('a full refund is recorded', full.status === 201 || full.status === 200, full.json);
  const rf = await run();
  const credit = (await sql.query("SELECT * FROM etims_documents WHERE \"saleId\" = $1 AND kind = 'CREDIT_NOTE'", [s1.json.id])).rows[0];
  check('a full refund becomes a credit note that is sent', rf.json.sent === 1 && credit?.status === 'SENT' && credit.invcNo > d1.invcNo, credit);
  const kc = (await kra('GET', '/_test/sales')).json.find((x) => x.invcNo === credit.invcNo);
  check('the credit note is a refund receipt (R) pointing at the original invoice, for the same amounts', kc.rcptTyCd === 'R' && kc.orgInvcNo === d1.invcNo && kc.totAmt === 482 && kc.taxAmtB === 32 && kc.rfdRsnCd === '06' && Boolean(kc.rfdDt), kc);
  check('the stock came back in (type 03)', (await kra('GET', '/_test/stock-io')).json.some((x) => x.sarTyCd === '03' && x.sarNo === credit.sarNo));
  const s5 = await sell([[sa, 2]], 232);
  await run();
  await h('POST', `/sales/${s5.json.id}/refunds`, { clientId: randomUUID(), amount: 50, reason: 'Goodwill', approvedById: ownerOrgUserId });
  const rp = await run();
  const part = (await sql.query("SELECT * FROM etims_documents WHERE \"saleId\" = $1 AND kind = 'CREDIT_NOTE'", [s5.json.id])).rows[0];
  check('a part refund cannot be sent by itself: it is marked for doing by hand, with the reason', part?.status === 'MANUAL' && /whole sale|by hand/.test(part.lastError) && rp.json.sent === 0, part);
  check('a part refund cannot be retried from here', (await h('POST', `/etims/documents/${part.id}/retry`, {})).status === 400);

  // the screens' data
  const lst = await h('GET', '/etims/documents');
  check('the list shows counts by state and the documents', lst.status === 200 && lst.json.counts.SENT >= 5 && lst.json.counts.MANUAL >= 1 && lst.json.rows.length > 0 && lst.json.rows[0].steps !== undefined, lst.json.counts);
  check('it can be filtered by state; an unknown state is refused', (await h('GET', '/etims/documents?status=MANUAL')).json.rows.every((x) => x.status === 'MANUAL') && (await h('GET', '/etims/documents?status=BOGUS')).status === 400);
  const bySale = await h('GET', `/etims/documents/by-sale/${s1.json.id}`);
  check('a sale shows its own documents (the sale and its credit note)', bySale.status === 200 && bySale.json.length === 2 && bySale.json[0].kind === 'SALE' && bySale.json[1].kind === 'CREDIT_NOTE', bySale.json);
  check('a cashier cannot see the documents or run a send', (await h('GET', '/etims/documents', undefined, cashier)).status === 403 && (await h('POST', '/etims/documents/run', {}, cashier)).status === 403);
  const rlsDoc = (await sql.query("SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = 'etims_documents'")).rows[0];
  check('etims_documents has row-level security switched on and forced', rlsDoc?.on === true && rlsDoc?.forced === true, rlsDoc);
  check('the key is never kept in a document', !JSON.stringify((await sql.query('SELECT payload FROM etims_documents WHERE "organizationId" = $1', [org.id])).rows).includes('cmcKey'));
  const off2 = await h('PUT', '/etims/settings', { sendSales: false });
  const s6 = await sell([[sa, 1]], 116);
  await run();
  check('switching sending off stops new sales being queued', off2.json.sendSales === false && (await docOf(s6.json.id)).length === 0);

  section('9. Purchases and stock movements go to KRA');
  const spPin = `A${rand(9)}Z`;
  check('a supplier PIN that is not a KRA PIN is refused', (await h('POST', '/suppliers', { name: `Bad ${tag}`, kraPin: 'nonsense' })).status === 400);
  const sup = (await h('POST', '/suppliers', { name: `Etims Supplier ${tag}`, kraPin: ` ${spPin.toLowerCase()} ` })).json;
  check('a supplier PIN is tidied to capitals', sup.kraPin === spPin, sup);
  const noPinSup = (await h('POST', '/suppliers', { name: `No PIN ${tag}` })).json;
  check('a supplier needs no PIN', Boolean(noPinSup.id) && noPinSup.kraPin === null, noPinSup);
  check('a PIN can be cleared', (await h('PATCH', `/suppliers/${noPinSup.id}`, { kraPin: '' })).status === 200);

  // sending on again starts a fresh clock
  const on9 = await h('PUT', '/etims/settings', { sendSales: true });
  check('sending is switched on again', on9.status === 200 && on9.json.sendSales === true, on9.json);
  await new Promise((r) => setTimeout(r, 1100));
  await kra('POST', '/_test/clear-documents');

  const pa = await mk2('StkA', vat.id, 100);
  const pb = await mk2('StkB', exempt.id, 250);
  const pc = await mk2('StkC', vat.id, 40);
  const pd = await mk2('StkD', vat.id, 70);
  await sql.query('UPDATE product_variants SET cost = 60, barcode = $2 WHERE id = $1', [pa.v.id, `BC${rand(10)}`]);
  await sql.query('UPDATE product_variants SET cost = 150 WHERE id = $1', [pb.v.id]);
  const barcodeA = (await sql.query('SELECT barcode FROM product_variants WHERE id = $1', [pa.v.id])).rows[0].barcode;
  await h('POST', '/etims/items/classify', { variantIds: [pa.v.id, pb.v.id, pc.v.id, pd.v.id], itemClsCd: '5059690800' });
  await h('POST', '/etims/items/register', { variantIds: [pa.v.id, pb.v.id] });
  const move = (m, qty, type = 'ADJUSTMENT') => h('POST', '/inventory/transactions', { branchId, variantId: m.v.id, type, quantityDelta: qty });
  const movesOf = async () => (await sql.query("SELECT * FROM etims_documents WHERE \"organizationId\" = $1 AND kind = 'STOCK_MOVE' ORDER BY \"createdAt\"", [org.id])).rows;

  // an adjustment up, an adjustment down
  check('an adjustment up is recorded', (await move(pa, 10)).status === 201);
  check('an adjustment of the second product is recorded', (await move(pb, 5)).status === 201);
  const m1 = await run();
  check('both movements are picked up and sent', m1.json.queued >= 2 && m1.json.sent >= 2 && m1.json.stopped === null, m1.json);
  const io1 = (await kra('GET', '/_test/stock-io')).json;
  const upA = io1.find((x) => x.sarTyCd === '06' && x.itemList.some((i) => i.qty === 10));
  check('KRA was told "stock added" (type 06) with the quantity and a value (cost 60 + 16% = 69.60 each)', Boolean(upA) && upA.itemList[0].prc === 69.6 && upA.itemList[0].totAmt === 696 && upA.totItemCnt === 1, upA);
  check('and each one has its own movement number', new Set(io1.map((x) => x.sarNo)).size === io1.length);
  const lv1 = (await kra('GET', '/_test/stock-levels')).json;
  check('KRA was told what is now in stock (10 and 5)', Object.values(lv1).includes(10) && Object.values(lv1).includes(5), lv1);
  check('sending the same movements again sends nothing', (await run()).json.queued === 0 && (await kra('GET', '/_test/stock-io')).json.length === io1.length);

  // waste goes out as "discarding"
  const w = await h('POST', '/waste', { branchId, variantId: pa.v.id, quantity: 2, reason: 'DAMAGED' });
  check('waste is recorded', w.status === 201, w.json);
  await run();
  const waste = (await kra('GET', '/_test/stock-io')).json.find((x) => x.sarTyCd === '15');
  check('waste is reported as discarding (type 15)', Boolean(waste) && waste.itemList[0].qty === 2, waste);
  const lvW = (await kra('GET', '/_test/stock-levels')).json;
  check('and the stock level KRA holds follows (8 left)', Object.values(lvW).includes(8), lvW);
  const adjDown = await move(pa, -1);
  check('an adjustment down is recorded', adjDown.status === 201, adjDown.json);
  await run();
  check('an adjustment down is reported as type 16', (await kra('GET', '/_test/stock-io')).json.some((x) => x.sarTyCd === '16' && x.itemList[0].qty === 1));

  // a product KRA does not have yet waits
  await move(pc, 3);
  const mw = await run();
  const waiting = (await movesOf()).find((d) => d.status === 'PENDING' && /StkC/.test(d.lastError || ''));
  check('stock of an unregistered product waits and says which product', mw.json.waiting >= 1 && Boolean(waiting), mw.json);
  await h('POST', '/etims/items/register', { variantIds: [pc.v.id] });
  await sql.query('UPDATE etims_documents SET "nextAttemptAt" = NULL WHERE id = $1', [waiting.id]);
  check('once registered, it goes through', (await run()).json.sent >= 1 && (await sql.query('SELECT status FROM etims_documents WHERE id = $1', [waiting.id])).rows[0].status === 'SENT');

  // KRA down: movements keep their place
  await move(pb, 1);
  await kra('POST', '/_test/fail-next?n=1&mode=894');
  const down2 = await run();
  check('KRA unreachable stops the pass and the movement stays queued', Boolean(down2.json.stopped) && (await movesOf()).some((d) => d.status === 'PENDING' && d.attempts === 1));
  await sql.query("UPDATE etims_documents SET \"nextAttemptAt\" = NULL WHERE kind = 'STOCK_MOVE' AND status = 'PENDING' AND \"organizationId\" = $1", [org.id]);
  check('the next pass sends it', (await run()).json.sent >= 1);

  // a delivery: stock in as a purchase (02) and then reported as a purchase
  const grn = await h('POST', '/goods-receipts', { branchId, supplierId: sup.id, deliveryNote: '7001', lines: [{ variantId: pa.v.id, quantity: 4, unitCost: 62 }, { variantId: pb.v.id, quantity: 2, unitCost: 150 }], bill: { billNumber: `EB-${tag}` } });
  check('a delivery from the supplier is received', grn.status === 201, grn.json);
  await run();
  const delivered = (await kra('GET', '/_test/stock-io')).json.find((x) => x.sarTyCd === '02' && x.itemList.length === 2);
  check('the stock that came in is reported as a purchase delivery (type 02)', Boolean(delivered), (await kra('GET', '/_test/stock-io')).json.map((x) => x.sarTyCd));
  const rc = await h('GET', '/etims/purchases/receipts');
  const mine9 = rc.json.find((x) => x.id === grn.json.receipt.id);
  check('the delivery is listed as not yet reported, with the supplier PIN and the value', rc.status === 200 && mine9 && mine9.reported === null && mine9.supplierPin === spPin && mine9.value === 548 && mine9.missingPrices === 0, mine9);
  check('a cashier cannot see or report deliveries', (await h('GET', '/etims/purchases/receipts', undefined, cashier)).status === 403 && (await h('POST', `/etims/purchases/receipts/${grn.json.receipt.id}/report`, {}, cashier)).status === 403);
  const noPinGrn = await h('POST', '/goods-receipts', { branchId, supplierId: noPinSup.id, lines: [{ variantId: pa.v.id, quantity: 1, unitCost: 62 }] });
  check('a delivery from a supplier with no PIN cannot be reported', (await h('POST', `/etims/purchases/receipts/${noPinGrn.json.receipt.id}/report`, {})).status === 400);
  const rep = await h('POST', `/etims/purchases/receipts/${grn.json.receipt.id}/report`, {});
  check('reporting the delivery queues a purchase', rep.status === 200 && Boolean(rep.json.documentId), rep.json);
  check('it cannot be reported twice', (await h('POST', `/etims/purchases/receipts/${grn.json.receipt.id}/report`, {})).status === 400);
  await run();
  const kp = (await kra('GET', '/_test/purchases')).json;
  const man = kp.find((x) => x.regTyCd === 'M');
  check('KRA holds the purchase entered by hand, with the supplier, our invoice number and the amounts (248 + 16% tax + 300 exempt = 587.68)', kp.length === 1 && man.spplrTin === spPin && man.spplrInvcNo === 7001 && man.pchsSttsCd === '02' && man.rcptTyCd === 'P' && man.pmtTyCd === '02' && man.totAmt === 587.68 && man.taxAmtB === 39.68 && man.taxblAmtA === 300, man);
  check('its invoice number comes from the purchase run, not the sales run', man.invcNo >= 1 && man.orgInvcNo === 0);
  check('the delivery now shows as sent', (await h('GET', '/etims/purchases/receipts')).json.find((x) => x.id === grn.json.receipt.id).reported === 'SENT');

  // the supplier's own eTIMS invoices
  const post = (b) => call(KRA, 'POST', '/_test/add-purchase', { body: b });
  await post({ forTin: PIN, spplrTin: spPin, spplrInvcNo: 555, lines: [{ itemCd: 'SUPP-A', itemNm: 'Their unga', bcd: barcodeA, qty: 3, prc: 116 }, { itemCd: 'SUPP-B', itemNm: 'Their rice', qty: 2, prc: 250, taxTyCd: 'A' }] });
  await post({ forTin: PIN, spplrTin: spPin, spplrInvcNo: 556, rcptTyCd: 'R', lines: [{ itemCd: 'SUPP-A', itemNm: 'Their unga', qty: 1, prc: 116 }] });
  check('a cashier cannot download or see supplier invoices', (await h('POST', '/etims/purchases/sync', {}, cashier)).status === 403 && (await h('GET', '/etims/purchases', undefined, cashier)).status === 403);
  const sy = await h('POST', '/etims/purchases/sync', {});
  check('the supplier invoices are downloaded', sy.status === 200 && sy.json.downloaded === 2 && sy.json.stopped === null, sy.json);
  const pReqs = (await kra('GET', '/_test/requests')).json.filter((r) => r.method === 'selectTrnsPurchaseSalesList');
  check('KRA was asked from the very beginning the first time, with the PIN, branch ID and key', pReqs[0].body.lastReqDt === '20180101000000' && pReqs[0].body.tin === PIN && /^[0-9a-f]{32}$/.test(pReqs[0].body.cmcKey), pReqs[0]?.body);
  const sy2 = await h('POST', '/etims/purchases/sync', {});
  check('downloading again brings nothing twice', sy2.json.downloaded === 0, sy2.json);
  const pReqs2 = (await kra('GET', '/_test/requests')).json.filter((r) => r.method === 'selectTrnsPurchaseSalesList');
  check('and KRA was asked from where the last download ended', pReqs2.length >= 2 && pReqs2[pReqs2.length - 1].body.lastReqDt !== '20180101000000');
  const wl = await h('GET', '/etims/purchases?status=WAITING');
  const inv = wl.json.rows.find((x) => x.invoiceNo === 555);
  const credit9 = wl.json.rows.find((x) => x.invoiceNo === 556);
  check('both are waiting; the supplier is recognised by its PIN; the second is a credit note', wl.json.rows.length === 2 && inv.knownSupplier === sup.name && credit9.kind === 'CREDIT_NOTE' && inv.total === 848, wl.json);
  check('the line with a barcode we have is matched to our product; the other is not matched yet', inv.lines[0].suggested?.variantId === pa.v.id && inv.lines[0].suggested.registered === true && inv.lines[1].suggested === null, inv.lines);
  check('accepting without matching every line is refused, naming the line', (await h('POST', `/etims/purchases/${inv.id}/accept`, { lines: [{ itemSeq: 1, variantId: pa.v.id }] })).status === 400);
  const accUnreg = await h('POST', `/etims/purchases/${inv.id}/accept`, { lines: [{ itemSeq: 1, variantId: pa.v.id }, { itemSeq: 2, variantId: pd.v.id }] });
  check('matching a line to a product not registered with KRA is refused, naming it', accUnreg.status === 400 && /StkD/.test(accUnreg.json.message), accUnreg.json);
  check('a supplier credit note cannot be accepted here, only put aside', (await h('POST', `/etims/purchases/${credit9.id}/accept`, { lines: [{ itemSeq: 1, variantId: pa.v.id }] })).status === 400);
  const acc = await h('POST', `/etims/purchases/${inv.id}/accept`, { lines: [{ itemSeq: 1, variantId: pa.v.id }, { itemSeq: 2, variantId: pb.v.id }], goodsReceiptId: grn.json.receipt.id });
  check('with every line matched to a registered product, accepting queues a purchase', acc.status === 200 && Boolean(acc.json.documentId), acc.json);
  check('an invoice cannot be accepted twice', (await h('POST', `/etims/purchases/${inv.id}/accept`, { lines: [{ itemSeq: 1, variantId: pa.v.id }, { itemSeq: 2, variantId: pb.v.id }] })).status === 400);
  check('the credit note is put aside, once', (await h('POST', `/etims/purchases/${credit9.id}/dismiss`, {})).status === 200 && (await h('POST', `/etims/purchases/${credit9.id}/dismiss`, {})).status === 400);
  await run();
  const kp2 = (await kra('GET', '/_test/purchases')).json;
  const auto = kp2.find((x) => x.regTyCd === 'A');
  check("KRA holds the confirmed purchase: the supplier's invoice number, regTyCd A, the supplier's own item codes beside ours", Boolean(auto) && auto.spplrInvcNo === 555 && auto.spplrTin === spPin && auto.itemList[0].spplrItemCd === 'SUPP-A' && /^KE2NT/.test(auto.itemList[0].itemCd) && auto.itemList[0].spplrItemNm === 'Their unga', auto);
  check("its amounts are the supplier's own (3 x 116 with 16% tax, 2 x 250 exempt = 848)", auto.totAmt === 848 && auto.taxblAmtB === 348 && auto.taxblAmtA === 500 && auto.taxAmtB === 48, auto);
  check('the purchase numbers run on: the second is one more than the first', auto.invcNo === man.invcNo + 1);
  check('the list shows the invoice as accepted and the other as put aside', (await h('GET', '/etims/purchases?status=ACCEPTED')).json.rows.length === 1 && (await h('GET', '/etims/purchases?status=DISMISSED')).json.rows.length === 1);
  check('an unknown status is refused', (await h('GET', '/etims/purchases?status=BOGUS')).status === 400);

  // the next invoice from the same supplier matches by itself
  await post({ forTin: PIN, spplrTin: spPin, spplrInvcNo: 557, lines: [{ itemCd: 'SUPP-A', itemNm: 'Their unga', qty: 1, prc: 116 }, { itemCd: 'SUPP-B', itemNm: 'Their rice', qty: 1, prc: 250, taxTyCd: 'A' }] });
  await h('POST', '/etims/purchases/sync', {});
  const next = (await h('GET', '/etims/purchases?status=WAITING')).json.rows.find((x) => x.invoiceNo === 557);
  check('matching is remembered: both lines of the next invoice are matched, with no barcode needed', next.lines[0].suggested?.variantId === pa.v.id && next.lines[1].suggested?.variantId === pb.v.id, next.lines);

  // the screen data and the records
  const all9 = await h('GET', '/etims/documents');
  check('the documents list carries purchases and stock movements, with the kind of movement', all9.json.rows.some((d) => d.kind === 'PURCHASE') && all9.json.rows.some((d) => d.kind === 'STOCK_MOVE' && d.movement === '06') && all9.json.rows.some((d) => d.movement === '15'), all9.json.rows.slice(0, 3));
  const ok9 = await h('GET', '/etims/documents?status=PENDING');
  check('nothing is stuck except what is waiting for a reason', ok9.json.rows.every((d) => d.lastError));
  for (const t of ['etims_purchase_invoices', 'etims_supplier_items']) {
    const rr = (await sql.query('SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1', [t])).rows[0];
    check(`${t} has row-level security switched on and forced`, rr?.on === true && rr?.forced === true, rr);
  }
  check('the key is never kept in a purchase document', !JSON.stringify((await sql.query("SELECT payload FROM etims_documents WHERE kind = 'PURCHASE' AND \"organizationId\" = $1", [org.id])).rows).includes('cmcKey'));
  await h('PUT', '/etims/settings', { sendSales: false });

section('10. Disconnecting, and the records');
  check(
    'a cashier cannot disconnect',
    (await h('POST', `/etims/devices/${branchId}/disconnect`, {}, cashier))
      .status === 403,
  );
  const disc = await h('POST', `/etims/devices/${branchId}/disconnect`, {});
  check(
    'disconnecting forgets the key',
    disc.status === 200 &&
      disc.json.branches.find((b) => b.branchId === branchId).device.hasKey ===
        false &&
      (
        await sql.query(
          'SELECT "cmcKeyEnc" k FROM etims_devices WHERE "branchId" = $1',
          [branchId],
        )
      ).rows[0].k === null,
  );
  check(
    'with no device, downloads are refused',
    (await h('POST', '/etims/codes/sync', {})).status === 400,
  );
  const retry = await h('POST', `/etims/devices/${branchId}/connect`, {
    bhfId: '00',
    dvcSrlNo: `S-${tag}`,
  });
  check(
    'connecting again is refused by KRA (a device installs once), with the explanation to ask KRA for a reset',
    retry.status === 400 && /already installed/.test(retry.json.message),
    retry.json,
  );
  const audits = (
    await sql.query(
      `SELECT action FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'etims.%'`,
      [org.id],
    )
  ).rows.map((r) => r.action);
  check(
    'every step is in the audit log',
    [
      'etims.settings_updated',
      'etims.device_connected',
      'etims.device_connect_failed',
      'etims.codes_synced',
      'etims.device_disconnected',
    ].every((a) => audits.includes(a)),
    [...new Set(audits)],
  );
  const auditText = JSON.stringify(
    (
      await sql.query(
        `SELECT "before", "after" FROM audit_log WHERE "organizationId" = $1 AND action LIKE 'etims.%'`,
        [org.id],
      )
    ).rows,
  );
  check(
    'and the audit log never holds the key',
    !auditText.includes(key) && !/cmcKey/.test(auditText),
  );
  for (const t of ['etims_settings', 'etims_devices']) {
    const r = (
      await sql.query(
        `SELECT relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = $1`,
        [t],
      )
    ).rows[0];
    check(
      `${t} has row-level security switched on and forced`,
      r?.on === true && r?.forced === true,
      r,
    );
  }

  console.log(
    `\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`,
  );
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
