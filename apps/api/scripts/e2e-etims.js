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

  section('8. Disconnecting, and the records');
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
