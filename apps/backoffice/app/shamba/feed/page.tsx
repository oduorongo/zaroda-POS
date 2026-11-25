"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, day, inputClass, todayKey } from "../../../lib/shamba";

type Tab = "overview" | "feeding" | "mixing" | "rations";
interface Report {
  days: number;
  totalCost: number;
  totalKg: number;
  milk: { feedCost: number; litres: number; perLitre: number | null };
  eggs: { feedCost: number; eggs: number; perEgg: number | null; perTray: number | null };
  fed: { id: string; kind: string; label: string; head: number; kg: number; cost: number; daysFed: number; costPerHeadPerDay: number | null }[];
  feeds: { variantId: string; name: string; onHand: number; kgPerDay: number; daysLeft: number | null; low: boolean }[];
}
interface Feedings {
  animals: { id: string; tag: string; name: string | null; species: string }[];
  groups: { id: string; name: string; species: string; headCount: number }[];
  feeds: { id: string; name: string; cost: number | null }[];
  records: { id: string; date: string; target: string; feedName: string; kg: number; cost: number; voidedAt: string | null; voidReason: string | null }[];
}
interface Ration { id: string; name: string; species: string | null; stage: string | null; batchKg: number; outputName: string; active: boolean; expectedCostPerKg: number; missingCost: boolean; items: { variantId: string; name: string; unit: string; quantity: number }[] }
interface Batch { id: string; batchNo: string; rationName: string; date: string; kgProduced: number; cost: number; costPerKg: number; status: "PENDING" | "APPROVED" | "REVERSED"; reverseReason: string | null; items: { name: string; unit: string; quantity: number; cost: number }[] }
interface ProductRow { id: string; name: string; baseUnit: string; variants: { id: string; name: string | null }[] }

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const tabStyle = (on: boolean) => (on ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_BRAND.navy });

function Overview() {
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<Report>("/farm/feed/report").then(setR).catch((err) => setError(errText(err, "Could not load the feed figures")));
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!r) return <p className="text-sm text-secondary-500">Loading...</p>;
  const low = r.feeds.filter((f) => f.low);
  return (
    <div className="space-y-4">
      {low.length > 0 && (
        <div className="rounded-xl border-2 px-4 py-3 text-sm font-semibold" style={{ borderColor: SHAMBA_BRAND.orange, background: "#fff4e8", color: "#7a3d00" }}>
          Feed running low: {low.map((f) => `${f.name} (${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"} left)`).join(", ")}. Mix or buy more.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [`Feed, last ${r.days} days`, kes(r.totalCost), `${r.totalKg.toLocaleString("en-KE")} kg`],
          ["Feed cost a litre of milk", r.milk.perLitre !== null ? kes(r.milk.perLitre) : "-", `${r.milk.litres.toLocaleString("en-KE")} L milked`],
          ["Feed cost an egg", r.eggs.perEgg !== null ? kes(r.eggs.perEgg) : "-", r.eggs.perTray !== null ? `${kes(r.eggs.perTray)} a tray` : ""],
          ["Feed cost on eggs", kes(r.eggs.feedCost), `${r.eggs.eggs.toLocaleString("en-KE")} eggs`],
        ].map(([t, v, s]) => (
          <div key={t} className="rounded-xl border border-secondary-200 bg-white p-3">
            <p className="text-xs text-secondary-500">{t}</p>
            <p className="text-xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{v}</p>
            {s && <p className="text-xs text-secondary-500">{s}</p>}
          </div>
        ))}
      </div>
      <Card title="Feed in stock">
        {r.feeds.length === 0 ? (
          <p className="text-sm text-secondary-500">No feed fed or mixed yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500">
                <th className="py-1">Feed</th>
                <th>In stock</th>
                <th>Used a day</th>
                <th>Days left</th>
              </tr>
            </thead>
            <tbody>
              {r.feeds.map((f) => (
                <tr key={f.variantId} className="border-t border-secondary-100">
                  <td className="py-1.5">{f.name}</td>
                  <td>{f.onHand.toLocaleString("en-KE")} kg</td>
                  <td>{f.kgPerDay ? `${f.kgPerDay} kg` : "-"}</td>
                  <td className="font-semibold" style={f.low ? { color: SHAMBA_BRAND.orange } : undefined}>{f.daysLeft ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {r.fed.length > 0 && (
        <Card title="Feed cost per head">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500">
                <th className="py-1">Fed</th>
                <th>Head</th>
                <th>kg</th>
                <th>Cost</th>
                <th>A head a day</th>
              </tr>
            </thead>
            <tbody>
              {r.fed.map((t) => (
                <tr key={t.id} className="border-t border-secondary-100">
                  <td className="py-1.5">
                    <Link href={t.kind === "animal" ? `/shamba/animals/${t.id}` : `/shamba/groups/${t.id}`} className="underline">
                      {t.label}
                    </Link>
                  </td>
                  <td>{t.head}</td>
                  <td>{t.kg.toLocaleString("en-KE")}</td>
                  <td>{kes(t.cost)}</td>
                  <td className="font-semibold">{t.costPerHeadPerDay !== null ? kes(t.costPerHeadPerDay) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Feeding({ canVoid }: { canVoid: boolean }) {
  const [data, setData] = useState<Feedings | null>(null);
  const [date, setDate] = useState(todayKey());
  const [lines, setLines] = useState<{ target: string; variantId: string; kg: string }[]>([{ target: "", variantId: "", kg: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Feedings>("/farm/feed/feedings").then(setData).catch((err) => setError(errText(err, "Could not load feeding")));
  useEffect(() => {
    void load();
  }, []);
  if (!data) return error ? <ErrorBox error={error} /> : <p className="text-sm text-secondary-500">Loading...</p>;

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) => setLines(lines.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const ready = lines.filter((l) => l.target && l.variantId && Number(l.kg) > 0);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ saved: number; kg: number; cost: number }>("/farm/feed/feedings", {
        date,
        entries: ready.map((l) => ({ [l.target.startsWith("a:") ? "animalId" : "groupId"]: l.target.slice(2), variantId: l.variantId, kg: Number(l.kg) })),
      });
      setDone(`Saved ${r.saved} ${r.saved === 1 ? "line" : "lines"}: ${r.kg} kg, ${kes(r.cost)}. The feed came off stock.`);
      setLines([{ target: "", variantId: "", kg: "" }]);
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the feeding"));
    } finally {
      setBusy(false);
    }
  }
  async function voidRow(id: string) {
    const reason = window.prompt("Why void this feeding? (the feed goes back into stock)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/feed/feedings/${id}/void`, { reason });
      await load();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      {done && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_BRAND.navy }}>{done}</p>}
      <Card title="Record feeding">
        {data.feeds.length === 0 ? (
          <p className="text-sm text-secondary-500">No feed in stock items yet. Feed products are kept per kg: add them under Products, or mix a ration.</p>
        ) : (
          <form onSubmit={save} className="space-y-2 text-sm">
            <label className="block max-w-[12rem]">
              Date
              <input type="date" className={inputClass} value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
            </label>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border border-secondary-200 p-2 sm:grid-cols-[2fr_2fr_1fr]">
                <select className={inputClass} value={l.target} onChange={(e) => setLine(i, { target: e.target.value })} aria-label="Fed to">
                  <option value="">Fed to...</option>
                  <optgroup label="Groups and flocks">
                    {data.groups.map((g) => (
                      <option key={g.id} value={`g:${g.id}`}>
                        {g.name} ({g.headCount})
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Animals">
                    {data.animals.map((a) => (
                      <option key={a.id} value={`a:${a.id}`}>
                        {a.tag}
                        {a.name ? ` ${a.name}` : ""}
                      </option>
                    ))}
                  </optgroup>
                </select>
                <select className={inputClass} value={l.variantId} onChange={(e) => setLine(i, { variantId: e.target.value })} aria-label="Feed">
                  <option value="">Feed...</option>
                  {data.feeds.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                <input type="number" inputMode="decimal" step="0.1" min="0" placeholder="kg" aria-label="kg" className="mt-1 w-full rounded-lg border border-secondary-300 bg-white p-2.5 text-base text-secondary-900" value={l.kg} onChange={(e) => setLine(i, { kg: e.target.value })} />
              </div>
            ))}
            <button type="button" className="text-sm underline" onClick={() => setLines([...lines, { target: "", variantId: lines[lines.length - 1]?.variantId ?? "", kg: "" }])}>
              + Another line
            </button>
            <div>
              <Btn busy={busy} disabled={!ready.length}>Save feeding</Btn>
            </div>
          </form>
        )}
      </Card>
      {data.records.length > 0 && (
        <Card title="Last 7 days">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500">
                <th className="py-1">Date</th>
                <th>Fed to</th>
                <th>Feed</th>
                <th>kg</th>
                <th>Cost</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.records.map((r) => (
                <tr key={r.id} className={`border-t border-secondary-100 ${r.voidedAt ? "text-secondary-400 line-through" : ""}`} title={r.voidReason ?? undefined}>
                  <td className="py-1.5 whitespace-nowrap">{day(r.date)}</td>
                  <td>{r.target}</td>
                  <td>{r.feedName}</td>
                  <td>{r.kg}</td>
                  <td>{kes(r.cost)}</td>
                  <td className="text-right">
                    {!r.voidedAt && canVoid && (
                      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void voidRow(r.id)}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

function Upgrade({ error }: { error: string }) {
  return (
    <Card>
      <p className="text-sm">{error}</p>
      <Link href="/shamba/pricing" className="mt-2 inline-block text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>
        See plans
      </Link>
    </Card>
  );
}

function Mixing({ manager }: { manager: boolean }) {
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [rations, setRations] = useState<Ration[]>([]);
  const [f, setF] = useState({ rationId: "", date: todayKey(), batches: "1", kgProduced: "", notes: "" });
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    Promise.all([apiGet<Batch[]>("/farm/feed/batches"), apiGet<Ration[]>("/farm/feed/rations")])
      .then(([b, r]) => {
        setBatches(b);
        setRations(r.filter((x) => x.active));
      })
      .catch((err) => (err instanceof ApiError && err.status === 402 ? setUpgrade(err.message) : setError(errText(err, "Could not load the batches"))));
  useEffect(() => {
    void load();
  }, []);
  if (upgrade) return <Upgrade error={upgrade} />;
  if (!batches) return error ? <ErrorBox error={error} /> : <p className="text-sm text-secondary-500">Loading...</p>;
  const ration = rations.find((r) => r.id === f.rationId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/feed/batches", { rationId: f.rationId, date: f.date, batches: Number(f.batches), kgProduced: Number(f.kgProduced), notes: f.notes.trim() || undefined });
      setF({ ...f, kgProduced: "", notes: "" });
      await load();
    } catch (err) {
      setError(errText(err, "Could not record the batch"));
    } finally {
      setBusy(false);
    }
  }
  async function act(b: Batch, what: "approve" | "reverse") {
    const reason = what === "reverse" ? window.prompt(b.status === "PENDING" ? "Why turn this batch down?" : "Why reverse this batch? (ingredients go back into stock and the feed comes out)") : null;
    if (what === "reverse" && (!reason || reason.trim().length < 3)) return;
    try {
      await apiPost(`/farm/feed/batches/${b.id}/${what}`, what === "reverse" ? { reason } : {});
      await load();
    } catch (err) {
      setError(errText(err, "Could not do that"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card title="Record a mixing">
        {rations.length === 0 ? (
          <p className="text-sm text-secondary-500">Make a ration first (Rations tab).</p>
        ) : (
          <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label className="col-span-2">
              Ration
              <select className={inputClass} value={f.rationId} onChange={(e) => setF({ ...f, rationId: e.target.value })} required>
                <option value="">Choose</option>
                {rations.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.batchKg} kg a batch)
                  </option>
                ))}
              </select>
            </label>
            <label>
              Date
              <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
            </label>
            <label>
              Times the recipe
              <input type="number" inputMode="decimal" step="0.5" min="0.5" className={inputClass} value={f.batches} onChange={(e) => setF({ ...f, batches: e.target.value })} />
            </label>
            <label>
              kg weighed out
              <input type="number" inputMode="decimal" step="0.1" min="0.1" className="mt-1 w-full rounded-lg border border-secondary-300 bg-white p-3 text-lg text-secondary-900" value={f.kgProduced} onChange={(e) => setF({ ...f, kgProduced: e.target.value })} placeholder={ration ? String(ration.batchKg * Number(f.batches || 1)) : ""} required />
            </label>
            <label className="col-span-2 sm:col-span-3">
              Notes
              <input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </label>
            {ration && (
              <p className="col-span-2 text-xs text-secondary-500 sm:col-span-4">
                Uses {ration.items.map((i) => `${Math.round(i.quantity * Number(f.batches || 1) * 1000) / 1000} ${i.unit} ${i.name}`).join(", ")}. Stock moves when a farm manager approves it.
              </p>
            )}
            <div className="col-span-2 sm:col-span-4">
              <Btn busy={busy} disabled={!f.rationId || !f.kgProduced}>Record batch</Btn>
            </div>
          </form>
        )}
      </Card>
      <Card title="Batches">
        {batches.length === 0 ? (
          <p className="text-sm text-secondary-500">No batches yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-100 text-sm">
            {batches.map((b) => (
              <li key={b.id} className={`py-2 ${b.status === "REVERSED" ? "text-secondary-400" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <b>{b.batchNo}</b> · {b.rationName} · {day(b.date)} · {b.kgProduced} kg
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={b.status === "PENDING" ? { background: "#fff4e8", color: "#7a3d00" } : b.status === "APPROVED" ? { background: "#e8ecf6", color: SHAMBA_BRAND.navy } : { background: "#eee", color: "#666" }}>
                      {b.status === "PENDING" ? "Waiting for approval" : b.status === "APPROVED" ? "Approved" : "Reversed"}
                    </span>
                    {manager && b.status === "PENDING" && (
                      <button type="button" className="rounded-lg px-3 py-1 text-xs font-semibold text-white" style={{ background: SHAMBA_BRAND.orange }} onClick={() => void act(b, "approve")}>
                        Approve
                      </button>
                    )}
                    {manager && b.status !== "REVERSED" && (
                      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void act(b, "reverse")}>
                        {b.status === "PENDING" ? "Turn down" : "Reverse"}
                      </button>
                    )}
                  </span>
                </div>
                <p className="text-xs text-secondary-500">
                  {kes(b.cost)} · {kes(b.costPerKg)} a kg · {b.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(", ")}
                  {b.reverseReason ? ` · reversed: ${b.reverseReason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Rations({ manager }: { manager: boolean }) {
  const [rations, setRations] = useState<Ration[] | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const blank = { name: "", species: "", stage: "", batchKg: "", outputVariantId: "", items: [{ variantId: "", quantity: "" }] };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Ration[]>("/farm/feed/rations").then(setRations).catch((err) => (err instanceof ApiError && err.status === 402 ? setUpgrade(err.message) : setError(errText(err, "Could not load the rations"))));
  useEffect(() => {
    void load();
    apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
  }, []);
  if (upgrade) return <Upgrade error={upgrade} />;
  const opts = products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name}${v.name ? ` - ${v.name}` : ""} (per ${p.baseUnit})`, perKg: p.baseUnit.trim().toLowerCase() === "kg" })));
  const setItem = (i: number, patch: Partial<(typeof f.items)[number]>) => setF({ ...f, items: f.items.map((x, k) => (k === i ? { ...x, ...patch } : x)) });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/feed/rations", {
        name: f.name.trim(), species: f.species.trim() || undefined, stage: f.stage.trim() || undefined, batchKg: Number(f.batchKg), outputVariantId: f.outputVariantId || undefined,
        items: f.items.filter((i) => i.variantId && Number(i.quantity) > 0).map((i) => ({ variantId: i.variantId, quantity: Number(i.quantity) })),
      });
      setF(blank);
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the ration"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      {!rations ? (
        <p className="text-sm text-secondary-500">Loading...</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {rations.map((r) => (
            <Card key={r.id} title={r.name}>
              <p className="text-xs text-secondary-500">
                {[r.species, r.stage].filter(Boolean).join(" · ")} · {r.batchKg} kg a batch · makes {r.outputName}
              </p>
              <ul className="mt-2 text-sm">
                {r.items.map((i) => (
                  <li key={i.variantId} className="flex justify-between">
                    <span>{i.name}</span>
                    <span>
                      {i.quantity} {i.unit}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm font-semibold" style={{ color: SHAMBA_BRAND.navy }}>
                About {kes(r.expectedCostPerKg)} a kg{r.missingCost ? " (some ingredients have no cost yet)" : ""}
              </p>
            </Card>
          ))}
        </div>
      )}
      {manager && (
        <Card title="New ration">
          <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label className="col-span-2">
              Name
              <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Dairy meal, Layers mash" required />
            </label>
            <label>
              For
              <input className={inputClass} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })} placeholder="Cattle, Chicken" />
            </label>
            <label>
              Stage
              <input className={inputClass} value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} placeholder="Milking, Calves, Layers" />
            </label>
            <label>
              kg a batch makes
              <input type="number" inputMode="decimal" min="1" className={inputClass} value={f.batchKg} onChange={(e) => setF({ ...f, batchKg: e.target.value })} required />
            </label>
            <label className="col-span-2 sm:col-span-3">
              Finished feed product (per kg)
              <select className={inputClass} value={f.outputVariantId} onChange={(e) => setF({ ...f, outputVariantId: e.target.value })}>
                <option value="">Make one named after the ration</option>
                {opts.filter((o) => o.perKg).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="col-span-2 font-semibold sm:col-span-4">Ingredients for one batch</p>
            {f.items.map((it, i) => (
              <div key={i} className="col-span-2 grid grid-cols-[3fr_1fr] gap-2 sm:col-span-4">
                <select className={inputClass} value={it.variantId} onChange={(e) => setItem(i, { variantId: e.target.value })} aria-label="Ingredient">
                  <option value="">Ingredient from stock...</option>
                  {opts.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input type="number" inputMode="decimal" step="0.1" min="0" className={inputClass} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} placeholder="how much" aria-label="Quantity" />
              </div>
            ))}
            <button type="button" className="col-span-2 text-left text-sm underline sm:col-span-4" onClick={() => setF({ ...f, items: [...f.items, { variantId: "", quantity: "" }] })}>
              + Another ingredient
            </button>
            <div className="col-span-2 sm:col-span-4">
              <Btn busy={busy} disabled={!f.name.trim() || !f.batchKg || !f.items.some((i) => i.variantId && Number(i.quantity) > 0)}>Save ration</Btn>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

export default function FeedPage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <ShambaAppFrame>
      {(session) => {
        const manager = session.role === "OWNER" || session.role === "MANAGER";
        return (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Feed</h1>
              <p className="text-sm text-secondary-600">Daily feeding from stock, home-mixed rations at their real cost per kg, and what feed costs per litre and per egg.</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(["overview", "feeding", "mixing", "rations"] as Tab[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold sm:flex-none" style={tabStyle(tab === t)}>
                  {{ overview: "Overview", feeding: "Feeding", mixing: "Mixing", rations: "Rations" }[t]}
                </button>
              ))}
            </div>
            {tab === "overview" && <Overview />}
            {tab === "feeding" && <Feeding canVoid={manager} />}
            {tab === "mixing" && <Mixing manager={manager} />}
            {tab === "rations" && <Rations manager={manager} />}
          </div>
        );
      }}
    </ShambaAppFrame>
  );
}
