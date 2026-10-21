// End-to-end test of barcodes on products against a LOCAL test setup: a barcode can be set, cleared and changed; two products
// cannot share one (or use another's product code); the shop can make barcodes of its own, one at a time or many at once;
// and a stock count works from them. Never touches the live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and the API started with the test settings, plus
// the demo seed.
//   node scripts/e2e-barcodes.js
const fs = require('fs');
const path = require('path');

const API_DIR = path.join(__dirname, '..');
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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 400) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const tag = Date.now().toString(36).toUpperCase();
const ean13Ok = (code) => {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(code[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(code[12]);
};

(async () => {
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  const branchId = (await api('GET', '/branches', { token: owner })).json[0].id;
  const code = `61${tag.padStart(11, '0')}`.slice(0, 13);

  const product = (await api('POST', '/products', { token: owner, body: { name: `Test Soda ${tag}` } })).json;
  const make = (sku, body = {}) => api('POST', `/products/${product.id}/variants`, { token: owner, body: { sku, price: 50, ...body } });

  section('1. Setting a barcode');
  const a = await make(`SODA-A-${tag}`, { barcode: ` ${code} ` });
  check('a barcode is saved, tidied', a.status === 201 && a.json.barcode === code, a);
  const none = await make(`SODA-N-${tag}`);
  check('an option can have no barcode', none.status === 201 && none.json.barcode === null, none.json);
  const listed = (await api('GET', `/products/${product.id}/variants`, { token: owner })).json;
  check('the barcode comes back with the product list the till downloads', listed.find((v) => v.id === a.json.id)?.barcode === code);
  const bad = await make(`SODA-B-${tag}`, { barcode: 'ab$cd' });
  check('odd characters in a barcode are refused', bad.status === 400, bad);

  section('2. One barcode, one product');
  const dup = await make(`SODA-D-${tag}`, { barcode: code });
  check('another option cannot take the same barcode', dup.status === 409 && /already used by Test Soda/.test(dup.json.message), dup);
  const dupCase = await make(`SODA-E-${tag}`, { barcode: code.toLowerCase() });
  check('upper and lower case do not get around it', dupCase.status === 409 || code === code.toLowerCase(), dupCase);
  const asSku = await api('PATCH', `/products/${product.id}/variants/${none.json.id}`, { token: owner, body: { barcode: `SODA-A-${tag}` } });
  check("a barcode cannot equal another option's product code (the till matches both)", asSku.status === 409, asSku);
  const skuClash = await make(code);
  check('and a product code cannot equal an existing barcode either', skuClash.status === 409 && /already the barcode of/.test(skuClash.json.message), skuClash);
  const skuEdit = await api('PATCH', `/products/${product.id}/variants/${none.json.id}`, { token: owner, body: { sku: code } });
  check('nor can an edit change a code into one', skuEdit.status === 409, skuEdit);
  const keep = await api('PATCH', `/products/${product.id}/variants/${a.json.id}`, { token: owner, body: { barcode: code, price: 55 } });
  check('an option can be saved again with its own barcode', keep.status === 200 && Number(keep.json.price) === 55, keep);
  const moved = await api('PATCH', `/products/${product.id}/variants/${a.json.id}`, { token: owner, body: { barcode: `${code}X` } });
  check('a barcode can be changed', moved.status === 200 && moved.json.barcode === `${code}X`, moved);
  const reuse = await make(`SODA-F-${tag}`, { barcode: code });
  check('and the old one is then free for another product', reuse.status === 201, reuse);
  const cleared = await api('PATCH', `/products/${product.id}/variants/${a.json.id}`, { token: owner, body: { barcode: '' } });
  check('a blank removes the barcode', cleared.status === 200 && cleared.json.barcode === null, cleared.json);

  section('3. Making barcodes of the shop\'s own');
  const made = await api('POST', `/products/${product.id}/variants/${none.json.id}/barcode`, { token: owner, body: {} });
  check('an option with none gets an in-store EAN-13', made.status === 200 && /^2\d{12}$/.test(made.json.barcode) && ean13Ok(made.json.barcode), made);
  const again = await api('POST', `/products/${product.id}/variants/${none.json.id}/barcode`, { token: owner, body: {} });
  check('asking again returns the same one', again.json.barcode === made.json.barcode, again.json);
  const x = await make(`SODA-X-${tag}`);
  const y = await make(`SODA-Y-${tag}`);
  const many = await api('POST', '/products/barcodes/generate', { token: owner, body: { variantIds: [x.json.id, y.json.id, none.json.id] } });
  check('many at once: the missing ones get one, the others are left alone', many.status === 200 && many.json.length === 3 && many.json[2].barcode === made.json.barcode && ean13Ok(many.json[0].barcode) && ean13Ok(many.json[1].barcode) && many.json[0].barcode !== many.json[1].barcode, many.json);
  check('an empty list is refused', (await api('POST', '/products/barcodes/generate', { token: owner, body: { variantIds: [] } })).status === 400);

  section('4. A stock count from those barcodes');
  await api('POST', '/inventory/transactions', { token: owner, body: { branchId, variantId: x.json.id, type: 'ADJUSTMENT', quantityDelta: 12 } });
  const open = (await api('GET', `/stock-takes?branchId=${branchId}`, { token: owner })).json.find((s) => s.status === 'OPEN');
  if (open) await api('PATCH', `/stock-takes/${open.id}/complete`, { token: owner, body: {} });
  const take = await api('POST', '/stock-takes', { token: owner, body: { branchId } });
  const line = take.json.lines?.find((l) => l.variantId === x.json.id);
  check('a count lists the product with what the system expects (12)', take.status === 201 && Number(line?.systemQuantity) === 12, take.json.lines?.length);
  check('the line carries the barcode a scan would match', line?.variant.barcode === x.json.barcode || line?.variant.barcode === many.json[0].barcode, line?.variant);
  const counted = await api('PATCH', `/stock-takes/${take.json.id}/lines/${line.id}`, { token: owner, body: { countedQuantity: 10 } });
  check('counting 10 shows a difference of -2', counted.status === 200 && Number(counted.json.variance) === -2, counted.json);
  const done = await api('PATCH', `/stock-takes/${take.json.id}/complete`, { token: owner, body: {} });
  check('finishing the count applies it', done.status === 200 && done.json.status === 'COMPLETED', done.json.status);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n - ${failures.join('\n - ')}` : ' - all good'}`);
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
