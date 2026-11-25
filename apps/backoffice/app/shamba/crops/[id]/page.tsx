"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../../lib/api";
import { Card, ShambaAppFrame } from "../../../../components/shamba/frame";
import { ActionTabs, Btn, ErrorBox, errText } from "../../../../components/shamba/livestock";
import { CROP_ACTIVITIES, CROP_STATUS, HARVEST_UNITS, SHAMBA_BRAND, day, inputClass, todayKey } from "../../../../lib/shamba";

interface Activity {
  id: string; date: string; kind: string; product: string | null; rate: string | null; inputName: string | null; quantity: number | null; inputCost: number;
  workers: number | null; labourCost: number; preHarvestDays: number | null; safeHarvestFrom: string | null; doneBy: string | null; notes: string | null; voidedAt: string | null; voidReason: string | null;
}
interface Harvest { id: string; date: string; quantity: number; unit: string; kg: number; grade: string | null; stockName: string | null; voidedAt: string | null; voidReason: string | null }
interface Season {
  id: string; crop: string; variety: string | null; acres: number; unitName: string; enterpriseName: string | null; plantedOn: string | null; expectedHarvest: string | null;
  status: string; seedSupplier: string | null; seedCertNo: string | null; harvestedKg: number; inputCost: number; labourCost: number; totalCost: number;
  kgPerAcre: number | null; costPerAcre: number | null; costPerKg: number | null; safeHarvestFrom: string | null; activities: Activity[]; harvests: Harvest[];
}
interface ProductRow { id: string; name: string; baseUnit: string; variants: { id: string; name: string | null; cost: string | null }[] }

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const options = (products: ProductRow[]) =>
  products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name}${v.name ? ` - ${v.name}` : ""}`, unit: p.baseUnit, cost: v.cost === null ? null : Number(v.cost) })));

function ActivityForm({ seasonId, products, onDone }: { seasonId: string; products: ProductRow[]; onDone: () => void }) {
  const blank = { date: todayKey(), kind: "WEEDING", product: "", rate: "", inputVariantId: "", quantity: "", inputCost: "", workers: "", labourCost: "", preHarvestDays: "", doneBy: "", notes: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opts = options(products);
  const item = opts.find((o) => o.id === f.inputVariantId);
  const spraying = f.kind === "SPRAYING";
  const n = (v: string) => (v === "" ? undefined : Number(v));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/farm/crops/seasons/${seasonId}/activities`, {
        date: f.date, kind: f.kind, product: f.product.trim() || undefined, rate: f.rate.trim() || undefined, inputVariantId: f.inputVariantId || undefined,
        quantity: n(f.quantity), inputCost: n(f.inputCost), workers: n(f.workers), labourCost: n(f.labourCost), preHarvestDays: n(f.preHarvestDays),
        doneBy: f.doneBy.trim() || undefined, notes: f.notes.trim() || undefined,
      });
      setF(blank);
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save it"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-4">
        <ErrorBox error={error} />
      </div>
      <label>
        Work
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(CROP_ACTIVITIES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label className="col-span-2">
        {spraying ? "Chemical (as on the label)" : "Product used (optional)"}
        <input className={inputClass} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} required={spraying} placeholder={spraying ? "e.g. Duduthrin 1.75 EC" : "e.g. DAP, CAN"} />
      </label>
      {spraying && (
        <>
          <label>
            Rate
            <input className={inputClass} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="40 ml / 20 L" />
          </label>
          <label>
            Pre-harvest days (label)
            <input type="number" inputMode="numeric" min="0" max="365" className={inputClass} value={f.preHarvestDays} onChange={(e) => setF({ ...f, preHarvestDays: e.target.value })} required />
          </label>
          <label className="col-span-2">
            Sprayed by
            <input className={inputClass} value={f.doneBy} onChange={(e) => setF({ ...f, doneBy: e.target.value })} />
          </label>
          <p className="col-span-2 rounded-lg px-3 py-2 text-xs sm:col-span-4" style={{ background: "#fff4e8", color: "#7a3d00" }}>
            Harvest is refused until the pre-harvest days from the label have passed (Pest Control Products Board).
          </p>
        </>
      )}
      <label className="col-span-2">
        Taken from stock (optional)
        <select className={inputClass} value={f.inputVariantId} onChange={(e) => setF({ ...f, inputVariantId: e.target.value })}>
          <option value="">Nothing from stock</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} (per {o.unit})
            </option>
          ))}
        </select>
      </label>
      {item && (
        <label>
          How many {item.unit}s
          <input type="number" inputMode="decimal" step="0.001" min="0.001" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
        </label>
      )}
      <label>
        Input cost (KES)
        <input
          type="number"
          inputMode="decimal"
          min="0"
          className={inputClass}
          value={f.inputCost}
          onChange={(e) => setF({ ...f, inputCost: e.target.value })}
          placeholder={item?.cost !== null && item?.cost !== undefined && f.quantity ? String(Math.round(item.cost * Number(f.quantity))) : ""}
        />
      </label>
      <label>
        Workers
        <input type="number" inputMode="numeric" min="0" className={inputClass} value={f.workers} onChange={(e) => setF({ ...f, workers: e.target.value })} />
      </label>
      <label>
        Labour cost (KES)
        <input type="number" inputMode="decimal" min="0" className={inputClass} value={f.labourCost} onChange={(e) => setF({ ...f, labourCost: e.target.value })} />
      </label>
      <label className="col-span-2 sm:col-span-4">
        Notes
        <input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <p className="col-span-2 text-xs text-secondary-500 sm:col-span-4">Leave the input cost empty to use the stock item&apos;s cost.</p>
      <div className="col-span-2 sm:col-span-4">
        <Btn busy={busy}>Save</Btn>
      </div>
    </form>
  );
}

function HarvestForm({ seasonId, products, blocked, onDone }: { seasonId: string; products: ProductRow[]; blocked: string | null; onDone: (msg: string) => void }) {
  const blank = { date: todayKey(), quantity: "", unit: "bag (90 kg)", kgPerUnit: "", grade: "", variantId: "", stockQuantity: "", notes: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const opts = options(products);
  const known = ["kg", "bag (90 kg)", "bag (50 kg)", "tonne"].includes(f.unit);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ kg: number; stockQty: number }>(`/farm/crops/seasons/${seasonId}/harvests`, {
        date: f.date, quantity: Number(f.quantity), unit: f.unit, kgPerUnit: f.kgPerUnit ? Number(f.kgPerUnit) : undefined, grade: f.grade.trim() || undefined,
        variantId: f.variantId || undefined, stockQuantity: f.stockQuantity ? Number(f.stockQuantity) : undefined, notes: f.notes.trim() || undefined,
      });
      setF(blank);
      onDone(`Saved: ${r.kg.toLocaleString("en-KE")} kg harvested${r.stockQty ? `, ${r.stockQty.toLocaleString("en-KE")} into stock` : ""}.`);
    } catch (err) {
      setError(errText(err, "Could not save the harvest"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-4">
        <ErrorBox error={error} />
        {blocked && (
          <p className="rounded-lg px-3 py-2 font-semibold" style={{ background: "#fff4e8", color: "#7a3d00" }}>
            Sprayed: harvest is not allowed until {blocked}.
          </p>
        )}
      </div>
      <label>
        Date
        <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label>
        Quantity
        <input type="number" inputMode="decimal" step="0.001" min="0.001" className="mt-1 w-full rounded-lg border border-secondary-300 bg-white p-3 text-lg text-secondary-900" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
      </label>
      <label>
        Unit
        <select className={inputClass} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
          {HARVEST_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
      {!known && (
        <label>
          kg per {f.unit}
          <input type="number" inputMode="decimal" step="0.1" min="0.1" className={inputClass} value={f.kgPerUnit} onChange={(e) => setF({ ...f, kgPerUnit: e.target.value })} required />
        </label>
      )}
      <label>
        Grade
        <input className={inputClass} value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} />
      </label>
      <label className="col-span-2">
        Put into stock as (optional)
        <select className={inputClass} value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value })}>
          <option value="">Do not put in stock</option>
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label} (per {o.unit})
            </option>
          ))}
        </select>
      </label>
      {f.variantId && (
        <label>
          Into stock (product units)
          <input type="number" inputMode="decimal" step="0.001" min="0.001" className={inputClass} value={f.stockQuantity} onChange={(e) => setF({ ...f, stockQuantity: e.target.value })} placeholder="auto: kg if sold per kg" />
        </label>
      )}
      <div className="col-span-2 sm:col-span-4">
        <Btn busy={busy} disabled={!f.quantity}>Save harvest</Btn>
      </div>
    </form>
  );
}

export default function SeasonPage() {
  const { id } = useParams<{ id: string }>();
  const [s, setS] = useState<Season | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = () => apiGet<Season>(`/farm/crops/seasons/${id}`).then(setS).catch((err) => setError(errText(err, "Could not load the season")));
  useEffect(() => {
    void load();
    apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function act(path: string, ask: string) {
    const reason = ask ? window.prompt(ask) : "x";
    if (ask && (!reason || reason.trim().length < 3)) return;
    try {
      await apiPost(path, ask ? { reason } : {});
      await load();
    } catch (err) {
      setError(errText(err, "Could not do that"));
    }
  }

  return (
    <ShambaAppFrame>
      {(session) => {
        const manager = session.role === "OWNER" || session.role === "MANAGER";
        if (!s) return error ? <ErrorBox error={error} /> : <p className="text-sm text-secondary-500">Loading...</p>;
        const open = s.status !== "CLOSED";
        return (
          <div className="space-y-4">
            <Link href="/shamba/crops" className="text-sm underline">
              ← All crops
            </Link>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>
                  {s.crop}
                  {s.variety ? ` · ${s.variety}` : ""}
                </h1>
                <p className="text-sm text-secondary-600">
                  {s.unitName} · {s.acres} acres · {CROP_STATUS[s.status]}
                  {s.plantedOn ? ` · planted ${day(s.plantedOn)}` : ""}
                  {s.expectedHarvest ? ` · harvest expected ${day(s.expectedHarvest)}` : ""}
                  {s.enterpriseName ? ` · ${s.enterpriseName}` : ""}
                </p>
                {(s.seedSupplier || s.seedCertNo) && (
                  <p className="text-xs text-secondary-500">
                    Seed: {s.seedSupplier ?? "-"}
                    {s.seedCertNo ? ` · lot ${s.seedCertNo}` : ""}
                  </p>
                )}
              </div>
              {open && manager && (
                <Btn type="button" tone="navy" onClick={() => void act(`/farm/crops/seasons/${s.id}/close`, "")}>
                  Close season
                </Btn>
              )}
            </div>
            <ErrorBox error={error} />
            {done && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_BRAND.navy }}>{done}</p>}
            {s.safeHarvestFrom && (
              <div className="rounded-xl border-2 px-4 py-3 text-sm font-semibold" style={{ borderColor: SHAMBA_BRAND.orange, background: "#fff4e8", color: "#7a3d00" }}>
                Sprayed recently: harvest is not allowed until {s.safeHarvestFrom}.
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Harvested", `${s.harvestedKg.toLocaleString("en-KE")} kg`, s.kgPerAcre !== null ? `${s.kgPerAcre.toLocaleString("en-KE")} kg an acre` : ""],
                ["Total cost", kes(s.totalCost), `inputs ${kes(s.inputCost)} · labour ${kes(s.labourCost)}`],
                ["Cost an acre", s.costPerAcre !== null ? kes(s.costPerAcre) : "-", ""],
                ["Cost a kg", s.costPerKg !== null ? kes(s.costPerKg) : "-", s.costPerKg === null ? "after the first harvest" : ""],
              ].map(([t, v, sub]) => (
                <div key={t} className="rounded-xl border border-secondary-200 bg-white p-3">
                  <p className="text-xs text-secondary-500">{t}</p>
                  <p className="text-xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{v}</p>
                  {sub && <p className="text-xs text-secondary-500">{sub}</p>}
                </div>
              ))}
            </div>

            {open && (
              <Card>
                <ActionTabs
                  tabs={[
                    ["Field work or spray", <ActivityForm key="a" seasonId={s.id} products={products} onDone={() => void load()} />],
                    ["Harvest", <HarvestForm key="h" seasonId={s.id} products={products} blocked={s.safeHarvestFrom} onDone={(m) => { setDone(m); void load(); }} />],
                  ]}
                />
              </Card>
            )}

            <Card title="Harvests">
              {s.harvests.length === 0 ? (
                <p className="text-sm text-secondary-500">Nothing harvested yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary-500">
                      <th className="py-1">Date</th>
                      <th>Quantity</th>
                      <th>kg</th>
                      <th>Grade</th>
                      <th>Stock</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {s.harvests.map((h) => (
                      <tr key={h.id} className={`border-t border-secondary-100 ${h.voidedAt ? "text-secondary-400 line-through" : ""}`} title={h.voidReason ?? undefined}>
                        <td className="py-1.5 whitespace-nowrap">{day(h.date)}</td>
                        <td>
                          {h.quantity} {h.unit}
                        </td>
                        <td>{h.kg.toLocaleString("en-KE")}</td>
                        <td>{h.grade ?? "-"}</td>
                        <td>{h.stockName ?? "-"}</td>
                        <td className="text-right">
                          {!h.voidedAt && manager && (
                            <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void act(`/farm/crops/harvests/${h.id}/void`, "Why void this harvest? (any stock it added is taken back out)")}>
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card title="Field work and sprays">
              {s.activities.length === 0 ? (
                <p className="text-sm text-secondary-500">No field work recorded yet.</p>
              ) : (
                <ul className="divide-y divide-secondary-100 text-sm">
                  {s.activities.map((a) => (
                    <li key={a.id} className={`py-2 ${a.voidedAt ? "text-secondary-400 line-through" : ""}`} title={a.voidReason ?? undefined}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span>
                          <b>{CROP_ACTIVITIES[a.kind] ?? a.kind}</b> · {day(a.date)}
                          {a.product ? ` · ${a.product}` : ""}
                          {a.rate ? ` (${a.rate})` : ""}
                        </span>
                        <span className="text-secondary-600">{kes(a.inputCost + a.labourCost)}</span>
                      </div>
                      <p className="text-xs text-secondary-500">
                        {[
                          a.inputName && a.quantity !== null ? `${a.quantity} × ${a.inputName} from stock` : "",
                          a.workers ? `${a.workers} workers` : "",
                          a.doneBy ? `by ${a.doneBy}` : "",
                          a.kind === "SPRAYING" ? (a.safeHarvestFrom ? `harvest from ${day(a.safeHarvestFrom)} (${a.preHarvestDays} days)` : "no pre-harvest interval") : "",
                          a.notes ?? "",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      {!a.voidedAt && manager && open && (
                        <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void act(`/farm/crops/activities/${a.id}/void`, "Why void this record? (inputs it took come back into stock)")}>
                          Void
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </ShambaAppFrame>
  );
}
