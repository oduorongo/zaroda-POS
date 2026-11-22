// End-to-end check of Shamba F1 against the LOCAL API (port 3001, started with pnpm --filter api start:test) and the seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;

(async () => {
  const plans = await call(null, "GET", "/public/farm-plans");
  check("public price list has the 5 plans", plans.status === 200 && plans.body.length === 5 && plans.body[2].code === "FARM_FARMER", plans);

  const owner = await signIn("owner@shamba.demo");
  check("demo owner signs in", !!owner);
  const ov = await call(owner, "GET", "/farm/overview");
  check("overview: Farmer plan, acres from fields and paddocks only (3+6+2+4 = 15)", ov.status === 200 && ov.body.plan.code === "FARM_FARMER" && ov.body.usage.acres === 15, ov.body);
  check("overview counts units, enterprises and people with farm roles", ov.body.counts.units === 13 && ov.body.counts.enterprises === 7 && ov.body.usage.users === 4, ov.body);

  const units = await call(owner, "GET", "/farm/units");
  check("layout lists 13 units", units.body.length === 13);
  const big = await call(owner, "POST", "/farm/units", { kind: "FIELD", name: "Big lease", acres: 40 });
  check("a field over the 50-acre Farmer limit is refused with an upgrade", big.status === 402 && /allows 50 acres.*Upgrade to Commercial/.test(big.body.message), big.body);
  const ok = await call(owner, "POST", "/farm/units", { kind: "FIELD", name: "Sukuma plot", acres: 0.5 });
  check("a small field is added", ok.status === 201, ok.body);
  const shed = await call(owner, "POST", "/farm/units", { kind: "BLOCK", name: "Block C", acres: 100 });
  check("a block's acres do not count (it only groups fields)", shed.status === 201, shed.body);

  const herd = await signIn("herdsman@shamba.demo");
  const herdOv = await call(herd, "GET", "/farm/overview");
  check("the herdsman sees the farm, limited to his sheds", herdOv.status === 200 && herdOv.body.me.unitIds.length === 3, herdOv.body);
  const herdAdd = await call(herd, "POST", "/farm/units", { kind: "PEN", name: "Sneaky pen" });
  check("the herdsman cannot change the layout", herdAdd.status === 403, herdAdd.body);

  const manager = await signIn("manager@shamba.demo");
  const ent = await call(manager, "POST", "/farm/enterprises", { kind: "PIGS", name: "Pig unit" });
  check("the farm manager adds an enterprise", ent.status === 201, ent.body);
  const staff = await call(manager, "GET", "/farm/staff");
  const herdsman = staff.body.find((p) => p.email === "herdsman@shamba.demo");
  const roles = await call(manager, "PUT", `/farm/staff/${herdsman.orgUserId}/roles`, { roles: ["HERDSMAN", "VET"] });
  check("only the farm owner gives out roles", roles.status === 403, roles.body);
  const ownerSet = await call(owner, "PUT", `/farm/staff/${herdsman.orgUserId}/roles`, { roles: ["HERDSMAN", "STOREKEEPER"], unitIds: [] });
  check("the owner gives the herdsman a second role on the whole farm", ownerSet.status === 200, ownerSet.body);

  const shop = await signIn("director@uriri.demo");
  if (shop) {
    const notFarm = await call(shop, "GET", "/farm/overview");
    check("a construction business is refused", notFarm.status === 403, notFarm.body);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
})().catch((e) => { console.error(e); process.exit(1); });
