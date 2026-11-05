// Run against the LOCAL API (pnpm start:test): node scripts/e2e-online-only.mjs <demo leader password> <demo member password> (from pnpm seed:sales-demo).
// Local check of: online-only sign-up limits, stock update (spreadsheet + sync key), stock buffer setting, setup fees.
const API = 'http://localhost:3001';
const [leaderPw, memberPw] = process.argv.slice(2);
let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${extra}`}`);
};
async function call(method, path, body, token, headers = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json };
}

const email = `oo.${Date.now()}@example.com`;
const reg = await call('POST', '/auth/register', { organizationName: 'Online Only E2E', industryType: 'RETAIL', ownerFullName: 'Owner', ownerEmail: email, ownerPassword: 'Passw0rd!23', branchName: 'Main', onlineOnly: true });
check('online-only sign-up works', reg.status === 201 || reg.status === 200, JSON.stringify(reg.body));
const T = reg.body.accessToken;
check('no till made for an online-only shop', reg.body.terminalId === null, String(reg.body.terminalId));

const till = await call('POST', '/terminals', { branchId: reg.body.branchId, deviceLabel: 'Till 1' }, T);
check('adding a till is refused on the free plan', till.status === 403 && /no tills/.test(till.body.message), JSON.stringify(till.body));
const branch = await call('POST', '/branches', { name: 'Second' }, T);
check('a second branch is refused (plan allows 1)', branch.status === 403 && /allows 1 branch/.test(branch.body.message), JSON.stringify(branch.body));

const prod = await call('POST', '/products', { name: 'Sugar 1kg' }, T);
const variant = await call('POST', `/products/${prod.body.id}/variants`, { sku: 'SUG-1KG', barcode: '6161100000011', price: 180 }, T);
check('product made', variant.status === 201, JSON.stringify(variant.body));

const rows = [{ sku: 'sug-1kg', stock: '24', price: '185' }];
const dry = await call('POST', '/products/stock-update', { branchId: reg.body.branchId, rows }, T);
check('spreadsheet preview shows the changes without saving', dry.body.applied === false && dry.body.stockChanges === 1 && dry.body.priceChanges === 1, JSON.stringify(dry.body));
const bad = await call('POST', '/products/stock-update', { branchId: reg.body.branchId, dryRun: false, rows: [...rows, { sku: 'NOPE', stock: '1' }] }, T);
check('a list with a bad row changes nothing', bad.body.applied === false && bad.body.problems.length === 1, JSON.stringify(bad.body));
const real = await call('POST', '/products/stock-update', { branchId: reg.body.branchId, dryRun: false, rows }, T);
check('spreadsheet update applied', real.body.applied === true, JSON.stringify(real.body));
const items = await call('GET', `/inventory/items?branchId=${reg.body.branchId}`, undefined, T);
const qty = Array.isArray(items.body) ? Number(items.body.find((i) => i.variantId === variant.body.id)?.quantity) : NaN;
check('stock is now 24', qty === 24, JSON.stringify(items.body).slice(0, 200));
const again = await call('POST', '/products/stock-update', { branchId: reg.body.branchId, dryRun: false, rows }, T);
check('sending the same list again changes nothing', again.body.stockChanges === 0 && again.body.priceChanges === 0, JSON.stringify(again.body));

const key = await call('POST', '/stock-sync/keys', { name: 'Other POS', branchId: reg.body.branchId }, T);
check('sync key made, shown once', /^zsync_/.test(key.body.key ?? ''), JSON.stringify(key.body));
const push = await call('PUT', '/stock-sync', { rows: [{ barcode: '6161100000011', stock: 9 }] }, undefined, { Authorization: `Bearer ${key.body.key}` });
check('other POS pushes stock with the key', push.status === 200 && push.body.applied === true && push.body.stockChanges === 1, JSON.stringify(push.body));
const wrong = await call('PUT', '/stock-sync', { rows }, undefined, { Authorization: 'Bearer zsync_000000000000_' + 'x'.repeat(32) });
check('a wrong key is refused', wrong.status === 401, String(wrong.status));
const keys = await call('GET', '/stock-sync/keys', undefined, T);
check('key shows it was used', keys.body[0]?.requests === 1 && !('keyHash' in keys.body[0]), JSON.stringify(keys.body));
await call('DELETE', `/stock-sync/keys/${key.body.id}`, undefined, T);
const revoked = await call('PUT', '/stock-sync', { rows }, undefined, { Authorization: `Bearer ${key.body.key}` });
check('a switched-off key is refused', revoked.status === 401, String(revoked.status));

const buf = await call('PATCH', '/online-store/me', { onlineStockBuffer: 2 }, T);
check('stock buffer saved', buf.status === 200 && buf.body.onlineStockBuffer === 2, JSON.stringify(buf.body).slice(0, 200));

// Setup fees, as the demo team member
const login = (e, p) => call('POST', '/sales-agent/auth/login', { email: e, password: p });
const member = (await login('member.demo@zarodasolutions.app', memberPw)).body.accessToken;
const leader = (await login('leader.demo@zarodasolutions.app', leaderPw)).body.accessToken;
const mine = await call('GET', '/sales-agent/setup-fees', undefined, member);
check('member sees ranges and businesses to charge', mine.status === 200 && mine.body.rates.length >= 3, JSON.stringify(mine.body).slice(0, 200));
const shop = mine.body.notYetCharged?.find((o) => o.name === 'Demo Retail Co');
check('Demo Retail Co is waiting for its fee', !!shop, JSON.stringify(mine.body.notYetCharged));
if (shop) {
  const low = await call('POST', '/sales-agent/setup-fees', { organizationId: shop.id, size: 'SMALL', amountKes: 500 }, member);
  check('a fee below the range is refused', low.status === 400 && /1,000 to KES 3,000/.test(low.body.message), JSON.stringify(low.body));
  const ok = await call('POST', '/sales-agent/setup-fees', { organizationId: shop.id, size: 'SMALL', amountKes: 2000, note: 'E2E' }, member);
  check('a fee in range is recorded with a receipt number', ok.status === 201 && /^SF-\d{4}-[0-9A-F]{6}$/.test(ok.body.receiptNo), JSON.stringify(ok.body));
  const dup = await call('POST', '/sales-agent/setup-fees', { organizationId: shop.id, size: 'SMALL', amountKes: 2000 }, member);
  check('a second fee for the same business is refused', dup.status === 409, String(dup.status));
  const byLeader = await call('POST', '/sales-agent/setup-fees', { organizationId: shop.id, size: 'SMALL', amountKes: 2000 }, leader);
  check("the leader cannot record a fee for a member's business", byLeader.status === 403, String(byLeader.status));
  const leaderView = await call('GET', '/sales-agent/setup-fees', undefined, leader);
  check("the leader sees the team's fees", leaderView.body.fees?.some((f) => f.receiptNo === ok.body.receiptNo), JSON.stringify(leaderView.body).slice(0, 200));
  const after = await call('GET', '/sales-agent/setup-fees', undefined, member);
  check("this month's total counts it", after.body.thisMonthKes >= 2000, String(after.body.thisMonthKes));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
