// End-to-end test of catalog management against a LOCAL test setup: categories (unique names, counts, delete), editing a product,
// archive instead of delete, and the CSV bulk import (preview, real import in one go, all-or-nothing, limits). Never touches the
// live system (refuses unless the database is on this computer).
//
// Needs running: the test Postgres (port 5433) with the latest migrations and the API started with the test settings, plus the
// demo seed.   node scripts/e2e-catalog.js
const fs = require('fs');
const path = require('path');

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
    console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 500) : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
async function call(method, url, { token, body } = {}) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
const api = (m, p, o) => call(m, API + p, o);
const sql = new Client({ connectionString: env.DIRECT_URL });
const tag = Date.now().toString(36).toUpperCase();

(async () => {
  await sql.connect();
  check('API ready', (await api('GET', '/ready')).status === 200);
  const owner = (await api('POST', '/auth/login', { body: { email: 'owner@demo.zaroda.pos', password: 'password123' } })).json.accessToken;
  check('owner can sign in', Boolean(owner));
  const org = (await api('GET', '/organizations/me', { token: owner })).json;
  const branchId = (await api('GET', '/branches', { token: owner })).json[0].id;
  const h = (method, p, body, token = owner) => api(method, p, { token, body });
  const cashierEmail = `catalog-cashier-${tag.toLowerCase()}@demo.zaroda.pos`;
  await h('POST', '/org-users', { email: cashierEmail, fullName: 'Catalog Cashier', password: 'password123', role: 'CASHIER', branchId });
  const cashier = (await api('POST', '/auth/login', { body: { email: cashierEmail, password: 'password123' } })).json.accessToken;
  check('a cashier exists to test permissions', Boolean(cashier));

  section('1. Categories: one name per business, whatever the capitals');
  const bakery = await h('POST', '/categories', { name: `  Bakery ${tag}  ` });
  check('a category is added (spaces trimmed)', bakery.status === 201 && bakery.json.name === `Bakery ${tag}`, bakery);
  const dup = await h('POST', '/categories', { name: `BAKERY ${tag.toLowerCase()}` });
  check('the same name in other capitals is a friendly 409', dup.status === 409 && /already have a category/.test(dup.json.message), dup);
  const drinks = (await h('POST', '/categories', { name: `Drinks ${tag}` })).json;
  const rename = await h('PATCH', `/categories/${drinks.id}`, { name: `bakery ${tag}` });
  check('renaming into an existing name is refused the same way', rename.status === 409, rename);
  const renamed = await h('PATCH', `/categories/${drinks.id}`, { name: `Beverages ${tag}` });
  check('a category can be renamed to a free name', renamed.status === 200 && renamed.json.name === `Beverages ${tag}`, renamed);
  check('a cashier cannot add, rename or delete categories', (await h('POST', '/categories', { name: `X ${tag}` }, cashier)).status === 403 && (await h('PATCH', `/categories/${drinks.id}`, { name: 'Y' }, cashier)).status === 403 && (await h('DELETE', `/categories/${drinks.id}`, undefined, cashier)).status === 403);
  check('but can read them', (await h('GET', '/categories', undefined, cashier)).status === 200);
  const dbDups = (await sql.query(`SELECT count(*)::int n FROM (SELECT lower(name) FROM categories WHERE "organizationId" = $1 GROUP BY 1 HAVING count(*) > 1) x`, [org.id])).rows[0].n;
  check('the database itself holds no two categories that differ only by case', dbDups === 0, dbDups);

  section('2. Products: edit name, category and tax class');
  const taxes = await h('POST', '/tax-classes', { name: `VAT ${tag}`, rate: 0.16, isExempt: false });
  const bread = (await h('POST', '/products', { name: `  Bread ${tag}  `, categoryId: bakery.json.id })).json;
  check('a product is made with a category (name trimmed)', bread.name === `Bread ${tag}` && bread.categoryId === bakery.json.id, bread);
  const edited = await h('PATCH', `/products/${bread.id}`, { name: `Bread loaf ${tag}`, categoryId: drinks.id, taxClassId: taxes.json.id });
  check('its name, category and tax class can all be changed afterwards', edited.status === 200 && edited.json.name === `Bread loaf ${tag}` && edited.json.categoryId === drinks.id && edited.json.taxClassId === taxes.json.id, edited);
  check('a category that does not exist is refused', (await h('PATCH', `/products/${bread.id}`, { categoryId: '00000000-0000-4000-8000-000000000000' })).status === 400);
  const withCounts = (await h('GET', '/categories?withCounts=true')).json;
  const row = (id) => withCounts.find((c) => c.id === id);
  check('categories can be listed with how many products each has', row(drinks.id)?.productCount === 1 && row(bakery.json.id)?.productCount === 0, withCounts.map((c) => [c.name, c.productCount]));
  const delCat = await h('DELETE', `/categories/${drinks.id}`);
  check('deleting a category works', delCat.status === 204 || delCat.status === 200);
  const afterDel = (await h('GET', `/products/${bread.id}`)).json;
  check('its products simply become "No category"', afterDel.categoryId === null && afterDel.name === `Bread loaf ${tag}`, afterDel);

  const cleared = await h('PATCH', `/products/${bread.id}`, { categoryId: null, taxClassId: null });
  check('the back office clears a category or tax class by sending null (an empty box)', cleared.status === 200 && cleared.json.categoryId === null && cleared.json.taxClassId === null, cleared);

  section('3. Archive instead of delete');
  const fresh = (await h('POST', '/products', { name: `Never sold ${tag}` })).json;
  const freshDel = await h('DELETE', `/products/${fresh.id}`);
  check('a product that never did anything is really deleted', freshDel.status === 200 && freshDel.json.archived === false && (await h('GET', `/products/${fresh.id}`)).status === 404, freshDel);
  const sold = (await h('POST', '/products', { name: `Has history ${tag}` })).json;
  const soldVariant = (await h('POST', `/products/${sold.id}/variants`, { sku: `HIS-${tag}`, price: 100 })).json;
  await h('POST', '/inventory/transactions', { branchId, variantId: soldVariant.id, type: 'ADJUSTMENT', quantityDelta: 10 });
  await h('PATCH', `/products/${sold.id}`, { onlineVisible: true });
  const archived = await h('DELETE', `/products/${sold.id}`);
  check('a product with stock history is ARCHIVED, not deleted', archived.status === 200 && archived.json.archived === true, archived);
  const row2 = (await sql.query(`SELECT "isActive", "archivedAt", "onlineVisible" FROM products WHERE id = $1`, [sold.id])).rows[0];
  check('it is hidden, time-stamped and off the online shop, and its history is intact', row2.isActive === false && row2.archivedAt !== null && row2.onlineVisible === false && (await sql.query(`SELECT count(*)::int n FROM inventory_transactions WHERE "variantId" = $1`, [soldVariant.id])).rows[0].n === 1, row2);
  const visible = (await h('GET', '/products')).json;
  check('the normal product list (the till) no longer has it', !visible.some((p) => p.id === sold.id));
  const withArchived = (await h('GET', '/products?includeArchived=true')).json;
  check('"Show archived" still finds it', withArchived.some((p) => p.id === sold.id && p.isActive === false));
  check('a cashier cannot archive, restore or import', (await h('DELETE', `/products/${sold.id}`, undefined, cashier)).status === 403 && (await h('POST', `/products/${sold.id}/restore`, {}, cashier)).status === 403 && (await h('POST', '/products/import', { rows: [{}] }, cashier)).status === 403);
  const restored = await h('POST', `/products/${sold.id}/restore`, {});
  check('restoring brings it back (not onto the online shop)', restored.status === 200 && restored.json.isActive === true && restored.json.onlineVisible === false && (await h('GET', '/products')).json.some((p) => p.id === sold.id), restored);
  const audits = (await sql.query(`SELECT action FROM audit_log WHERE "entityId" = $1`, [sold.id])).rows.map((r) => r.action);
  check('archiving and restoring are in the audit log', audits.includes('catalog.product_archived') && audits.includes('catalog.product_restored'), audits);

  section('4. CSV import - checking the file first (nothing is saved)');
  const sku = (n) => `IMP-${tag}-${n}`;
  const good = (n, over = {}) => ({ product_name: `Imported ${tag} ${n}`, category: `Imported cat ${tag}`, tax_class: '', variant_name: '', sku: sku(n), price: '120', cost: '80', barcode: '', quantity_mode: 'COUNT', opening_stock: '15', ...over });
  const before = async () => ({
    products: (await sql.query(`SELECT count(*)::int n FROM products WHERE "organizationId" = $1`, [org.id])).rows[0].n,
    variants: (await sql.query(`SELECT count(*)::int n FROM product_variants v JOIN products p ON p.id = v."productId" WHERE p."organizationId" = $1`, [org.id])).rows[0].n,
    cats: (await sql.query(`SELECT count(*)::int n FROM categories WHERE "organizationId" = $1`, [org.id])).rows[0].n,
  });
  const base = await before();
  const preview = await h('POST', '/products/import', { branchId, rows: [good(1), good(2, { product_name: `Imported ${tag} 1`, variant_name: 'Big', price: '200' })] });
  check('a good file previews cleanly: 1 new category, 1 new product, 2 options, 2 opening stocks', preview.status === 200 && preview.json.dryRun === true && preview.json.ok === true && preview.json.summary.newCategories.length === 1 && preview.json.summary.newProducts === 1 && preview.json.summary.newVariants === 2 && preview.json.summary.openingStockRows === 2, preview.json);
  check('a request that does not say dryRun is a preview, and nothing was saved', JSON.stringify(await before()) === JSON.stringify(base));
  const bad = await h('POST', '/products/import', {
    branchId,
    rows: [
      good(3, { price: 'abc' }),
      good(4, { sku: sku(5) }),
      good(5),
      good(6, { sku: sku(5).toLowerCase() }),
      good(7, { tax_class: 'No such tax' }),
      good(8, { sku: `HIS-${tag}` }),
      good(9, { quantity_mode: 'LITRES' }),
      good(10, { opening_stock: '2.5' }),
    ],
  });
  const errs = bad.json.errors || [];
  const has = (row, field) => errs.some((e) => e.row === row && e.field === field);
  check('the preview lists every problem with its row: bad price (row 2), duplicate SKU in the file (row 5), SKU already in the catalog (row 7), unknown tax class (row 6), bad quantity mode (row 8), fractional count (row 9)', bad.status === 200 && bad.json.ok === false && has(2, 'price') && has(5, 'sku') && has(7, 'sku') && has(6, 'tax_class') && has(8, 'quantity_mode') && has(9, 'opening_stock'), errs.map((e) => `${e.row}:${e.field}`));
  check('and says which SKUs were duplicates (in the file or the catalog)', bad.json.summary.duplicates.some((d) => d.where === 'file') && bad.json.summary.duplicates.some((d) => d.where === 'catalog'), bad.json.summary.duplicates);
  check('opening stock without a branch is a row error, not a crash', (await h('POST', '/products/import', { rows: [good(11)] })).json.errors?.some((e) => e.field === 'opening_stock'));
  check('an empty file is refused', (await h('POST', '/products/import', { rows: [] })).status === 400);
  const tooMany = await h('POST', '/products/import', { rows: Array.from({ length: 5001 }, (_, i) => ({ product_name: `X${i}`, sku: `S${i}`, price: '1' })) });
  check('more than 5,000 rows is refused by the SERVER (not just the browser)', tooMany.status === 400, tooMany.json);

  section('5. CSV import - the real thing, all or nothing');
  const mixed = await h('POST', '/products/import', { branchId, dryRun: false, rows: [good(20), good(21, { price: 'oops' })] });
  check('one bad row stops the whole import: 400 with the row list', mixed.status === 400 && Array.isArray(mixed.json.errors) && mixed.json.errors.length === 1, mixed.json);
  const afterBad = await before();
  check('and NOTHING was created (no products, options or categories)', JSON.stringify(afterBad) === JSON.stringify(base), { base, afterBad });
  const kg = good(32, { product_name: `Imported ${tag} Sugar`, category: `imported CAT ${tag}`, quantity_mode: 'weight', opening_stock: '12.5', cost: '90', barcode: `BC-${tag}-32` });
  const real = await h('POST', '/products/import', { branchId, dryRun: false, rows: [good(30), good(31, { product_name: `Imported ${tag} 30`, variant_name: 'Large', price: '240', opening_stock: '' }), kg, good(33, { product_name: `Imported ${tag} Tax`, tax_class: `vat ${tag}`, opening_stock: '0' })] });
  check('a good file imports', real.status === 200 && real.json.ok === true && real.json.created.products === 3 && real.json.created.variants === 4 && real.json.created.stockRows === 2, real);
  const after = await before();
  check('3 products and 4 options were created; the category (also written in other capitals) once', after.products === base.products + 3 && after.variants === base.variants + 4 && after.cats === base.cats + 1, { base, after });
  const impRows = (await sql.query(`SELECT v.sku, v.price, v.cost, v.barcode, v."quantityMode" qm, v.name, p.name pn, p."taxClassId" tax, c.name cat FROM product_variants v JOIN products p ON p.id = v."productId" LEFT JOIN categories c ON c.id = p."categoryId" WHERE v.sku LIKE $1 ORDER BY v.sku`, [`IMP-${tag}-%`])).rows;
  const r30 = impRows.find((r) => r.sku === sku(30));
  const r31 = impRows.find((r) => r.sku === sku(31));
  check('options of one product joined it (2 options on "Imported 30"), with their own names and prices', r30 && r31 && r30.pn === r31.pn && r31.name === 'Large' && Number(r31.price) === 240, impRows);
  check('the weight item has WEIGHT mode and its barcode; the taxed one has its tax class', impRows.find((r) => r.sku === sku(32)).qm === 'WEIGHT' && impRows.find((r) => r.sku === sku(32)).barcode === `BC-${tag}-32` && impRows.find((r) => r.sku === sku(33)).tax === taxes.json.id, impRows);
  const stockOf = async (s) => (await sql.query(`SELECT i.quantity q FROM inventory_items i JOIN product_variants v ON v.id = i."variantId" WHERE v.sku = $1 AND i."branchId" = $2`, [s, branchId])).rows[0]?.q;
  check('opening stock is on hand: 15 pieces, and 12.5 kg for the weight item; none where the cell was empty or 0', Number(await stockOf(sku(30))) === 15 && Number(await stockOf(sku(32))) === 12.5 && (await stockOf(sku(31))) === undefined && (await stockOf(sku(33))) === undefined);
  const txns = (await sql.query(`SELECT t.type, t."quantityDelta" q, t."unitCost" c FROM inventory_transactions t JOIN product_variants v ON v.id = t."variantId" WHERE v.sku IN ($1, $2)`, [sku(30), sku(32)])).rows;
  check('each opening stock is a proper ADJUSTMENT movement (with the cost), not a silent overwrite', txns.length === 2 && txns.every((t) => t.type === 'ADJUSTMENT') && txns.some((t) => Number(t.q) === 12.5 && Number(t.c) === 90), txns);
  check('the cost is on the product option, ready for the profit report', Number(r30.cost) === 80);
  check('the import is in the audit log', (await sql.query(`SELECT count(*)::int n FROM audit_log WHERE action = 'catalog.import' AND "organizationId" = $1`, [org.id])).rows[0].n >= 1);
  const again = await h('POST', '/products/import', { branchId, dryRun: false, rows: [good(30)] });
  check('importing the same file again is refused (every SKU already exists) and changes nothing', again.status === 400 && (await before()).variants === after.variants, again.json);

  section('6. Limits and size');
  const big = Array.from({ length: 5000 }, (_, i) => ({ product_name: `Bulk ${tag} ${i}`, category: '', sku: `BULK-${tag}-${i}`, price: '10', cost: '', variant_name: '', barcode: '', quantity_mode: 'COUNT', opening_stock: '', tax_class: '' }));
  const bigPreview = await h('POST', '/products/import', { rows: big });
  check('a full 5,000-row file (well over the usual 100 KB request size) can be previewed', bigPreview.status === 200 && bigPreview.json.ok === true && bigPreview.json.summary.rows === 5000, bigPreview.status);
  const huge = await h('POST', '/categories', { name: 'x'.repeat(300_000) });
  check('every other route still keeps the small request limit', huge.status === 413, huge.status);

  console.log(`\n${passed} checks passed${failures.length ? `, ${failures.length} FAILED:\n  - ${failures.join('\n  - ')}` : ' - ALL PASS'}`);
  await sql.end();
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error('ERROR:', e);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
