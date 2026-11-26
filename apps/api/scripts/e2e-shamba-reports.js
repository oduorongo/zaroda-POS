// End-to-end check of Shamba F7 (reports and ledger postings) against the LOCAL API (port 3001) and the seeded demo farm.
const API = "http://localhost:3001";
let passed = 0, failed = 0;
const check = (name, ok, detail) => { ok ? passed++ : failed++; console.log(`${ok ? "  PASS" : "  FAIL"}  ${name}${ok ? "" : "  -> " + String(JSON.stringify(detail)).slice(0, 300)}`); };

async function call(token, method, path, body) {
  const res = await fetch(API + path, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, type, body: type.includes("json") ? await res.json().catch(() => null) : Buffer.from(await res.arrayBuffer()) };
}
const signIn = async (email) => (await call(null, "POST", "/auth/login", { email, password: "password123" })).body?.accessToken;
const day = (n = 0) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

(async () => {
  const owner = await signIn("owner@shamba.demo");
  const herd = await signIn("herdsman@shamba.demo");
  const q = `from=${day(-29)}&to=${day()}`;
  const get = (key, extra = "") => call(owner, "GET", `/farm/reports/${key}?${q}${extra}`);

  const cat = (await call(owner, "GET", "/farm/reports")).body;
  check("nine reports, all on the Farmer plan", cat.length === 9 && cat.every((r) => r.allowed), cat);
  check("a herdsman cannot open reports", (await call(herd, "GET", "/farm/reports/herd")).status === 403);
  check("an unknown report is refused", (await get("nonsense")).status === 400);
  check("a period ending before it starts is refused", (await call(owner, "GET", `/farm/reports/crops?from=${day()}&to=${day(-5)}`)).status === 400);

  const ent = (await get("enterprises")).body;
  const dairy = ent.rows.find((r) => r.enterprise === "Dairy herd");
  check("profit per enterprise: dairy has income, feed and labour", dairy && dairy.income > 0 && dairy.feed > 0 && dairy.labour > 0, dairy);
  check("...and profit is income less cost on every row and the total", ent.rows.every((r) => Math.abs(r.profit - (r.income - r.cost)) < 0.01) && Math.abs(ent.totals.profit - (ent.totals.income - ent.totals.cost)) < 0.02, ent.totals);
  const layers = ent.rows.find((r) => r.enterprise.startsWith("Layers"));
  check("layers: egg sales on credit and the mash fed", layers && layers.income > 0 && layers.feed > 0, layers);

  const unit = (await get("unit-costs")).body;
  const milkRow = unit.rows.find((r) => r.what === "Dairy herd: milk");
  const eggRow = unit.rows.find((r) => r.what.startsWith("Layers") && r.unit === "egg");
  const beansRow = unit.rows.find((r) => r.what.startsWith("Beans") && r.unit === "kg");
  check("cost a litre of milk, an egg and a kg of beans", milkRow?.perUnit > 0 && milkRow.made > 0 && eggRow?.perUnit > 0 && beansRow?.perUnit > 0, { milkRow, eggRow, beansRow });

  const herdReg = (await get("herd")).body;
  const kc3 = herdReg.rows.find((r) => r.tag === "KC003");
  check("herd register lists every animal and the flocks, KC003 with its withdrawal", herdReg.rows.some((r) => r.tag === "KC001") && herdReg.rows.some((r) => r.tag === "(flock/group)") && /meat to/.test(kc3?.withheld ?? ""), kc3);
  const breeding = (await get("breeding")).body;
  check("breeding calendar shows Neema due to calve", breeding.rows.some((r) => r.what === "Due to give birth" && r.animal.includes("Neema")), breeding.rows);
  const health = (await get("health")).body;
  check("health register: the mastitis treatment with drug, dose and milk withdrawal", health.rows.some((r) => r.who === "KC003" && /Oxytetracycline/.test(r.drug ?? "") && r.milk), health.rows.slice(0, 3));
  const crops = (await get("crops")).body;
  const maize = crops.rows.find((r) => r.crop === "Maize");
  check("crop report: maize with its no-harvest-until date and seed lot", maize && maize.safe && /KSC/.test(maize.seed ?? ""), maize);
  const wages = (await get("wages")).body;
  check("wages by worker: four workers with statutory columns", wages.rows.length === 4 && wages.totals.nssf > 0 && wages.totals.net > 0, wages.totals);
  const debtors = (await get("debtors")).body;
  check("buyers who owe: the co-op, hotel and school", debtors.rows.length === 3 && debtors.totals.owed > 0, debtors.rows.map((r) => [r.buyer, r.owed]));

  const xlsx = await get("enterprises", "&format=xlsx");
  check("Excel download of profit per enterprise", xlsx.status === 200 && /spreadsheetml/.test(xlsx.type) && xlsx.body.subarray(0, 2).toString() === "PK", { status: xlsx.status, type: xlsx.type });

  // ── Ledger postings ──
  await call(owner, "PATCH", "/accounting/settings", { startDate: day(-40) });
  const posted = await call(owner, "POST", "/accounting/post-now");
  check("posting to the books runs", posted.status === 201 || posted.status === 200, posted.body);
  const counts = {};
  for (const t of ["FARM_WAGES", "FARM_DELIVERY", "FARM_BUYER_PAYMENT", "FARM_FEEDING", "FARM_CROP_INPUT"]) counts[t] = (await call(owner, "GET", `/accounting/journals?sourceType=${t}`)).body?.total ?? 0;
  check("wages, credit deliveries, buyer payments, feed fed and field inputs reach the books", Object.values(counts).every((c) => c > 0) && counts.FARM_WAGES >= 1 && counts.FARM_BUYER_PAYMENT >= 2, counts);
  const wageEntry = (await call(owner, "GET", "/accounting/journals?sourceType=FARM_WAGES")).body.rows[0];
  check("the wage entry: farm labour against NSSF, SHIF, Housing Levy and cash", wageEntry.lines.some((l) => l.name === "Farm labour (casual wages)" && l.debit > 0) && wageEntry.lines.some((l) => l.name === "NSSF owed" && l.credit > 0), wageEntry.lines);
  const tb = (await call(owner, "GET", "/accounting/reports/trial-balance")).body;
  const rows = tb?.rows ?? tb?.accounts ?? [];
  const debit = rows.reduce((s, r) => s + Number(r.debit ?? 0), 0);
  const credit = rows.reduce((s, r) => s + Number(r.credit ?? 0), 0);
  check("the trial balance balances, with the farm accounts in it", rows.length > 0 && Math.abs(debit - credit) < 1 && rows.some((r) => /Feed used/.test(r.name ?? "")) && rows.some((r) => /Farm labour/.test(r.name ?? "")), { debit, credit, names: rows.map((r) => r.name).slice(0, 40) });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
