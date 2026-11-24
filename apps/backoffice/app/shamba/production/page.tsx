"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { ActionTabs, Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, day, inputClass, todayKey, type FarmEnterprise } from "../../../lib/shamba";

type By = "day" | "week" | "month";
interface Bucket {
  start: string;
  milk: { total: number; forSale: number; withheld: number; calves: number; home: number; discarded: number };
  eggs: { good: number; cracked: number; small: number; total: number; layPct: number | null; feedKg: number; deaths: number };
}
interface Yields { by: By; series: Bucket[]; cows: { id: string; tag: string; name: string | null; litres: number; days: number; perDay: number }[] }
interface Linked { id: string; name: string; unit: string; price: number }
interface Settings { milk: Linked | null; eggs: Linked | null; eggsPerUnit: number; branchId: string | null; branches: { id: string; name: string }[] }
interface Produce { id: string; date: string; product: string; quantity: number; unit: string; note: string | null; enterpriseName: string | null; stockVariantId: string | null; voidedAt: string | null }
interface ProductRow { id: string; name: string; baseUnit: string; variants: { id: string; name: string | null; sku: string }[] }

const label = (start: string, by: By) => {
  const d = new Date(`${start}T00:00:00Z`);
  if (by === "month") return d.toLocaleDateString("en-KE", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });
};

/** Simple bars: one per day/week/month, so a herdsman sees the trend at a glance on a phone. */
function Bars({ series, value, by, unit, color }: { series: Bucket[]; value: (b: Bucket) => number; by: By; unit: string; color: string }) {
  const max = Math.max(1, ...series.map(value));
  return (
    <div className="flex h-36 items-end gap-[2px]" role="img" aria-label={`Bar chart, ${unit}`}>
      {series.map((b) => (
        <div key={b.start} className="group relative flex h-full flex-1 flex-col justify-end" title={`${label(b.start, by)}: ${value(b)} ${unit}`}>
          <div className="w-full rounded-t-sm" style={{ height: `${(value(b) / max) * 100}%`, minHeight: value(b) ? 2 : 0, background: color }} />
        </div>
      ))}
    </div>
  );
}

function Trends() {
  const [by, setBy] = useState<By>("day");
  const [y, setY] = useState<Yields | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setY(null);
    apiGet<Yields>(`/farm/production/yields?by=${by}`).then(setY).catch((err) => setError(errText(err, "Could not load the yields")));
  }, [by]);

  const last = y?.series[y.series.length - 1];
  const prev = y?.series[y.series.length - 2];
  const word = { day: "Today", week: "This week", month: "This month" }[by];
  const change = (a?: number, b?: number) => (a !== undefined && b ? `${a >= b ? "+" : ""}${Math.round(((a - b) / b) * 100)}% on the one before` : "");

  return (
    <div className="space-y-4">
      <div className="flex gap-1">
        {(["day", "week", "month"] as By[]).map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBy(b)}
            className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold sm:flex-none"
            style={by === b ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_BRAND.navy }}
          >
            {{ day: "Daily (30 days)", week: "Weekly (12)", month: "Monthly (12)" }[b]}
          </button>
        ))}
      </div>
      <ErrorBox error={error} />
      {!y ? (
        <p className="text-sm text-secondary-500">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              [`${word}: milk`, `${last?.milk.total ?? 0} L`, change(last?.milk.total, prev?.milk.total)],
              ["Milk for sale", `${last?.milk.forSale ?? 0} L`, last?.milk.withheld ? `${last.milk.withheld} L withheld` : ""],
              [`${word}: eggs`, `${(last?.eggs.total ?? 0).toLocaleString("en-KE")}`, change(last?.eggs.total, prev?.eggs.total)],
              ["Lay %", last?.eggs.layPct === null || last?.eggs.layPct === undefined ? "-" : `${last.eggs.layPct}%`, last?.eggs.deaths ? `${last.eggs.deaths} birds died` : ""],
            ].map(([t, v, s]) => (
              <div key={t} className="rounded-xl border border-secondary-200 bg-white p-3">
                <p className="text-xs text-secondary-500">{t}</p>
                <p className="text-xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{v}</p>
                {s && <p className="text-xs text-secondary-500">{s}</p>}
              </div>
            ))}
          </div>
          <Card title="Milk (litres)">
            <Bars series={y.series} value={(b) => b.milk.total} by={by} unit="litres" color={SHAMBA_BRAND.navy} />
            <div className="mt-1 flex justify-between text-xs text-secondary-500">
              <span>{label(y.series[0].start, by)}</span>
              <span>{label(y.series[y.series.length - 1].start, by)}</span>
            </div>
          </Card>
          <Card title="Eggs laid">
            <Bars series={y.series} value={(b) => b.eggs.total} by={by} unit="eggs" color={SHAMBA_BRAND.gold} />
            <div className="mt-1 flex justify-between text-xs text-secondary-500">
              <span>{label(y.series[0].start, by)}</span>
              <span>{label(y.series[y.series.length - 1].start, by)}</span>
            </div>
          </Card>
          <Card title="The figures">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary-500">
                    <th className="py-1">{by === "day" ? "Day" : by === "week" ? "Week of" : "Month"}</th>
                    <th>Milk L</th>
                    <th>For sale</th>
                    <th>Withheld</th>
                    <th>Calves</th>
                    <th>Eggs</th>
                    <th>Lay %</th>
                    <th>Feed kg</th>
                    <th>Died</th>
                  </tr>
                </thead>
                <tbody>
                  {[...y.series].reverse().map((b) => (
                    <tr key={b.start} className="border-t border-secondary-100">
                      <td className="py-1.5 whitespace-nowrap">{label(b.start, by)}</td>
                      <td>{b.milk.total || "-"}</td>
                      <td>{b.milk.forSale || "-"}</td>
                      <td>{b.milk.withheld || "-"}</td>
                      <td>{b.milk.calves || "-"}</td>
                      <td>{b.eggs.total ? b.eggs.total.toLocaleString("en-KE") : "-"}</td>
                      <td>{b.eggs.layPct ?? "-"}</td>
                      <td>{b.eggs.feedKg || "-"}</td>
                      <td>{b.eggs.deaths || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {y.cows.length > 0 && (
            <Card title="Each cow, last 30 days">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-secondary-500">
                    <th className="py-1">Cow</th>
                    <th>Litres a day</th>
                    <th>Total</th>
                    <th>Days milked</th>
                  </tr>
                </thead>
                <tbody>
                  {y.cows.map((c) => (
                    <tr key={c.id} className="border-t border-secondary-100">
                      <td className="py-1.5">
                        <Link href={`/shamba/animals/${c.id}`} className="font-semibold hover:underline" style={{ color: SHAMBA_BRAND.navy }}>
                          {c.tag} {c.name}
                        </Link>
                      </td>
                      <td className="font-semibold">{c.perDay}</td>
                      <td>{c.litres}</td>
                      <td>{c.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function variantOptions(products: ProductRow[]) {
  return products.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name}${v.name ? ` - ${v.name}` : ""} (per ${p.baseUnit})`, unit: p.baseUnit })));
}

function OtherProduce() {
  const [rows, setRows] = useState<Produce[]>([]);
  const [enterprises, setEnterprises] = useState<FarmEnterprise[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [f, setF] = useState({ date: todayKey(), product: "", quantity: "", unit: "kg", enterpriseId: "", variantId: "", note: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Produce[]>("/farm/production/produce").then(setRows).catch((err) => setError(errText(err, "Could not load produce")));
  useEffect(() => {
    void load();
    apiGet<FarmEnterprise[]>("/farm/enterprises").then(setEnterprises).catch(() => {});
    apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
  }, []);
  const options = variantOptions(products);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/production/produce", {
        date: f.date, product: f.product.trim(), quantity: Number(f.quantity), unit: f.unit.trim(), enterpriseId: f.enterpriseId || undefined, variantId: f.variantId || undefined, note: f.note.trim() || undefined,
      });
      setF({ ...f, product: "", quantity: "", note: "" });
      await load();
    } catch (err) {
      setError(errText(err, "Could not save it"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <ErrorBox error={error} />
        </div>
        <label className="col-span-2">
          What
          <input className={inputClass} value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} placeholder="Honey, manure, fish, wool..." required />
        </label>
        <label>
          Quantity
          <input type="number" inputMode="decimal" step="0.001" min="0" className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
        </label>
        <label>
          Unit
          <input className={inputClass} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} required />
        </label>
        <label>
          Date
          <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label>
          Enterprise
          <select className={inputClass} value={f.enterpriseId} onChange={(e) => setF({ ...f, enterpriseId: e.target.value })}>
            <option value="">-</option>
            {enterprises.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2">
          Put into stock as (optional)
          <select
            className={inputClass}
            value={f.variantId}
            onChange={(e) => {
              const o = options.find((x) => x.id === e.target.value);
              setF({ ...f, variantId: e.target.value, unit: o?.unit ?? f.unit });
            }}
          >
            <option value="">Do not put in stock (record only)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 sm:col-span-4">
          Note
          <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </label>
        <div className="col-span-2 sm:col-span-4">
          <Btn busy={busy} disabled={!f.product.trim() || !f.quantity}>Save</Btn>
        </div>
      </form>
      {rows.length > 0 && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-secondary-500">
              <th className="py-1">Date</th>
              <th>What</th>
              <th>Quantity</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-secondary-100 ${r.voidedAt ? "text-secondary-400 line-through" : ""}`}>
                <td className="py-1.5 whitespace-nowrap">{day(r.date)}</td>
                <td>
                  {r.product}
                  {r.enterpriseName && <span className="text-xs text-secondary-500"> · {r.enterpriseName}</span>}
                </td>
                <td>
                  {r.quantity} {r.unit}
                </td>
                <td>{r.stockVariantId ? "In stock" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ProduceSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Settings>("/farm/production/settings").then(setS).catch((err) => setError(errText(err, "Could not load the settings")));
  useEffect(() => {
    void load();
    apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
  }, []);
  if (!s) return <p className="text-sm text-secondary-500">Loading...</p>;
  const options = variantOptions(products);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await fn();
      setSaved(msg);
      await load();
      apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => {});
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <ErrorBox error={error} />
      {saved && <p style={{ color: SHAMBA_BRAND.navy }}>{saved}</p>}
      {(!s.milk || !s.eggs) && (
        <div className="rounded-lg p-3" style={{ background: "#fbf6e3" }}>
          <p>Milk and eggs go into stock as POS products so they can be sold at the till. No products yet? Make them now (you can change the prices under Products).</p>
          <div className="mt-2">
            <Btn type="button" busy={busy} onClick={() => void run(() => apiPost("/farm/production/settings/create-products", {}), "Made the milk and egg products.")}>
              Make milk and egg products
            </Btn>
          </div>
        </div>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          Milk goes into stock as
          <select className={inputClass} value={s.milk?.id ?? ""} onChange={(e) => void run(() => apiPut("/farm/production/settings", { milkVariantId: e.target.value || null }), "Saved.")}>
            <option value="">Not set (milk is only recorded)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Eggs go into stock as
          <select className={inputClass} value={s.eggs?.id ?? ""} onChange={(e) => void run(() => apiPut("/farm/production/settings", { eggVariantId: e.target.value || null }), "Saved.")}>
            <option value="">Not set (eggs are only recorded)</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Eggs in one unit of the egg product
          <select className={inputClass} value={s.eggsPerUnit} onChange={(e) => void run(() => apiPut("/farm/production/settings", { eggsPerUnit: Number(e.target.value) }), "Saved.")}>
            <option value={30}>30 (a tray)</option>
            <option value={12}>12 (a dozen)</option>
            <option value={1}>1 (single eggs)</option>
          </select>
        </label>
        {s.branches.length > 1 && (
          <label>
            Produce goes into the stock of
            <select className={inputClass} value={s.branchId ?? ""} onChange={(e) => void run(() => apiPut("/farm/production/settings", { branchId: e.target.value }), "Saved.")}>
              {s.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
    </div>
  );
}

export default function ProductionPage() {
  return (
    <ShambaAppFrame>
      {() => (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Production</h1>
            <p className="text-sm text-secondary-600">
              Milk and egg yields by day, week and month. Record them on the <Link href="/shamba/milk" className="underline">Milk</Link> and{" "}
              <Link href="/shamba/eggs" className="underline">Eggs</Link> pages.
            </p>
          </div>
          <Trends />
          <Card>
            <ActionTabs
              tabs={[
                ["Other produce", <OtherProduce key="p" />],
                ["Settings", <ProduceSettings key="s" />],
              ]}
            />
          </Card>
        </div>
      )}
    </ShambaAppFrame>
  );
}
