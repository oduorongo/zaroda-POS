// End-to-end check of Shamba farm inputs against the LOCAL API (port 3001) and the seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + String(JSON.stringify(detail)).slice(0, 400)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");

  const list = (await call(owner, "GET", "/farm/inputs")).body;
  check("the demo farm's fertiliser, spray and feed ingredients are inputs", Array.isArray(list) && ["FERTILISER", "CHEMICAL", "FEED"].every((k) => list.some((i) => i.kind === k)), list?.map?.((i) => `${i.kind} ${i.name}`));
  const ids = (await call(owner, "GET", "/farm/inputs/ids")).body;
  const products = (await call(owner, "GET", "/products")).body;
  const milk = products.find((p) => /milk/i.test(p.name));
  check("milk is a farm product, not an input", milk && !ids.includes(milk.id), { milk: milk?.name });

  check("a herdsman can see inputs but not add them", (await call(herd, "GET", "/farm/inputs")).status === 200 && (await call(herd, "POST", "/farm/inputs", { name: "X", kind: "SEED", unit: "bag", mode: "COUNT", cost: 1 })).status === 403);
  const name = `H614D maize seed ${Date.now() % 100000}`;
  const made = await call(owner, "POST", "/farm/inputs", { name, kind: "SEED", unit: "packet", mode: "COUNT", cost: 650 });
  check("an owner adds seed as an input", made.status === 201 && made.body.kind === "SEED", made);
  check("a second item with the same name is refused", (await call(owner, "POST", "/farm/inputs", { name, kind: "SEED", unit: "packet", mode: "COUNT", cost: 650 })).status === 400);

  const got = await call(owner, "POST", `/farm/inputs/${made.body.productId}/receive`, { quantity: 10, unitCost: 700, deliveryNote: "KSC-77" });
  check("a delivery is a goods-received note", got.status === 201 && !!got.body?.receipt, got);
  const seed = (await call(owner, "GET", "/farm/inputs")).body.find((i) => i.productId === made.body.productId);
  check("...and 10 packets are in store", seed?.onHand === 10, seed);

  const moved = await call(owner, "PUT", "/farm/inputs/mark", { productId: made.body.productId, kind: null });
  check("an input can be put back with the farm's products", moved.status === 200 && moved.body.kind === null && !(await call(owner, "GET", "/farm/inputs/ids")).body.includes(made.body.productId), moved);
  const back = await call(owner, "PUT", "/farm/inputs/mark", { productId: made.body.productId, kind: "SEED" });
  check("...and moved to inputs again", back.status === 200 && back.body.kind === "SEED", back);

  await call(owner, "POST", "/accounting/post-now");
  const bs = (await call(owner, "GET", "/accounting/reports/balance-sheet")).body;
  check("the delivery is owed to the supplier in the books (Goods received, not yet billed)", bs.liabilities.some((a) => a.code === "2005" && a.amount >= 7000), bs.liabilities);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
