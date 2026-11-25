// End-to-end check of Shamba F4 (crops) against the LOCAL API (port 3001) and the seeded demo farm.
// Changes data: run on a freshly seeded farm (the maize spray must be 5 days old).
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const near = (a, b) => Math.abs(a - b) < 0.01;

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const manager = await signIn("manager@shamba.demo");
  let herd = await signIn("herdsman@shamba.demo");
  const today = day();

  const units = (await call(owner, "GET", "/farm/units")).body;
  const u = (name) => units.find((x) => x.name === name);
  const staff = (await call(owner, "GET", "/farm/staff")).body;
  const herdsman = staff.find((p) => p.email === "herdsman@shamba.demo");
  const pens = ["Zero-grazing cow shed", "Calf pens", "Goat house"].map((n) => u(n).id);

  const seasons = (await call(owner, "GET", "/farm/crops/seasons")).body;
  const maize = seasons.find((s) => s.crop === "Maize");
  const beans = seasons.find((s) => s.crop === "Beans");
  check("two open seasons: maize and beans", seasons.length >= 2 && !!maize && !!beans, seasons.map((s) => s.crop));
  check("maize shows harvest blocked until the spray interval ends (9 days)", maize.safeHarvestFrom === day(9), maize.safeHarvestFrom);
  check("beans: 720 kg, 360 kg an acre, KES 7,400 an acre, KES 20.56 a kg", beans.harvestedKg === 720 && beans.kgPerAcre === 360 && beans.costPerAcre === 7400 && beans.costPerKg === 20.56, beans);

  const early = await call(manager, "POST", `/farm/crops/seasons/${maize.id}/harvests`, { date: today, quantity: 10, unit: "bag (90 kg)" });
  check("harvesting maize before the pre-harvest interval ends is refused", early.status === 409 && /Duduthrin/.test(early.body.message) && early.body.message.includes(day(9)), early.body);

  const herdNo = await call(herd, "POST", `/farm/crops/seasons/${beans.id}/activities`, { date: today, kind: "WEEDING", labourCost: 500 });
  check("a herdsman without the crops role cannot record field work", herdNo.status === 403, herdNo.body);

  await call(owner, "PUT", `/farm/staff/${herdsman.orgUserId}/roles`, { roles: ["HERDSMAN", "CROPS_OFFICER"], unitIds: [...pens, u("Beans field").id] });
  herd = await signIn("herdsman@shamba.demo");
  const herdSeasons = (await call(herd, "GET", "/farm/crops/seasons")).body;
  check("a crops officer limited to the beans field sees only beans", herdSeasons.length === 1 && herdSeasons[0].crop === "Beans", herdSeasons.map((s) => s.crop));
  check("...and cannot open the maize season", (await call(herd, "GET", `/farm/crops/seasons/${maize.id}`)).status === 403);
  const weeded = await call(herd, "POST", `/farm/crops/seasons/${beans.id}/activities`, { date: today, kind: "WEEDING", workers: 2, labourCost: 800 });
  check("...but records weeding on the beans", weeded.status === 201, weeded.body);

  const shed = await call(owner, "POST", "/farm/crops/seasons", { unitId: u("Zero-grazing cow shed").id, crop: "Kale", acres: 0.5 });
  check("a crop cannot be planted in a cow shed", shed.status === 400, shed.body);
  const tooBig = await call(owner, "POST", "/farm/crops/seasons", { unitId: u("Napier field").id, crop: "Napier", acres: 5 });
  check("a season cannot have more acres than the field", tooBig.status === 400 && /3 acres/.test(tooBig.body.message), tooBig.body);
  const napier = (await call(owner, "POST", "/farm/crops/seasons", { unitId: u("Napier field").id, crop: "Napier grass", variety: "Kakamega 1", acres: 2 })).body;
  check("a new season starts as planned", napier.status === "PLANNED", napier);

  const products = (await call(owner, "GET", "/products")).body;
  const variant = (sku) => products.flatMap((p) => p.variants).find((v) => v.sku === sku);
  const dap = variant("FARM-DAP");
  const beansKg = variant("FARM-BEANS");
  const settings = (await call(owner, "GET", "/farm/production/settings")).body;
  const stock = async (v) => Number((await call(owner, "GET", `/inventory/items/${settings.branchId}/${v.id}`)).body?.quantity ?? 0);

  const dap1 = await stock(dap);
  const planting = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: today, kind: "PLANTING", product: "DAP", inputVariantId: dap.id, quantity: 1, workers: 3, labourCost: 1500 });
  check("planting takes 1 bag of DAP off stock, costed at KES 3,500", planting.status === 201 && planting.body.inputCost === 3500 && near(await stock(dap), dap1 - 1), planting.body);
  const afterPlant = (await call(owner, "GET", `/farm/crops/seasons/${napier.id}`)).body;
  check("planting moves the season to growing", afterPlant.status === "GROWING" && afterPlant.plantedOn.slice(0, 10) === today, afterPlant.status);

  const noPhi = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: today, kind: "SPRAYING", product: "Glyphosate" });
  check("a spray without its pre-harvest interval is refused", noPhi.status === 400, noPhi.body);
  const noName = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: today, kind: "SPRAYING", preHarvestDays: 7 });
  check("a spray without the chemical's name is refused", noName.status === 400, noName.body);
  const half = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: today, kind: "TOP_DRESSING", inputVariantId: dap.id });
  check("a stock item needs its quantity", half.status === 400, half.body);
  const future = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: day(1), kind: "WEEDING" });
  check("tomorrow's field work is refused", future.status === 400, future.body);

  const voided = await call(manager, "POST", `/farm/crops/activities/${planting.body.id}/void`, { reason: "wrong field" });
  check("voiding the planting puts the DAP back", voided.status === 201 && near(await stock(dap), dap1), await stock(dap));

  const crate = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/harvests`, { date: today, quantity: 10, unit: "crate" });
  check("a harvest in an unknown unit asks for kg per unit", crate.status === 400 && /kg per unit/.test(crate.body.message), crate.body);
  const cut = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/harvests`, { date: today, quantity: 1.5, unit: "tonne" });
  check("1.5 tonnes of napier recorded as 1,500 kg (not into stock)", cut.status === 201 && cut.body.kg === 1500 && cut.body.stockVariantId === null, cut.body);

  const b1 = await stock(beansKg);
  const more = await call(herd, "POST", `/farm/crops/seasons/${beans.id}/harvests`, { date: today, quantity: 2, unit: "bag (90 kg)", grade: "Grade 2", variantId: beansKg.id });
  check("2 bags of beans go into stock as 180 kg", more.status === 201 && more.body.stockQty === 180 && near(await stock(beansKg), b1 + 180), more.body);
  const beans2 = (await call(owner, "GET", `/farm/crops/seasons/${beans.id}`)).body;
  check("beans now 900 kg, 450 kg an acre", beans2.harvestedKg === 900 && beans2.kgPerAcre === 450, { kg: beans2.harvestedKg, perAcre: beans2.kgPerAcre });
  const herdVoid = await call(herd, "POST", `/farm/crops/harvests/${more.body.id}/void`, { reason: "counted twice" });
  check("a crops officer cannot void a harvest", herdVoid.status === 403, herdVoid.body);
  const hv = await call(manager, "POST", `/farm/crops/harvests/${more.body.id}/void`, { reason: "counted twice" });
  check("voiding the harvest takes the 180 kg back out of stock", hv.status === 201 && near(await stock(beansKg), b1), await stock(beansKg));

  const herdClose = await call(herd, "POST", `/farm/crops/seasons/${napier.id}/close`);
  check("only a manager closes a season", herdClose.status === 403, herdClose.body);
  const closed = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/close`);
  const late = await call(manager, "POST", `/farm/crops/seasons/${napier.id}/activities`, { date: today, kind: "WEEDING" });
  check("a closed season takes no more records", closed.status === 201 && late.status === 400, late.body);
  const open = (await call(owner, "GET", "/farm/crops/seasons")).body;
  const all = (await call(owner, "GET", "/farm/crops/seasons?status=ALL")).body;
  check("closed seasons drop off the open list but stay on ALL", !open.some((s) => s.id === napier.id) && all.some((s) => s.id === napier.id), null);

  await call(owner, "PUT", `/farm/staff/${herdsman.orgUserId}/roles`, { roles: ["HERDSMAN"], unitIds: pens });
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
