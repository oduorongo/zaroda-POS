"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../lib/api";
import { Card, ShambaAppFrame } from "../../components/shamba/frame";
import { SHAMBA_BRAND, SHAMBA_INK, STATUS_LABEL, inputClass, limitText, type FarmOverview } from "../../lib/shamba";

function Usage({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-secondary-600">
          {used.toLocaleString("en-KE")} of {limitText(cap)}
        </span>
      </div>
      {cap !== null && (
        <div className="mt-1 h-2 rounded-full bg-background">
          <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? SHAMBA_BRAND.orange : SHAMBA_BRAND.navy }} />
        </div>
      )}
    </div>
  );
}

interface Linked { id: string; name: string; unit: string; price: number; inStock: number }
const TERMINAL_URL = process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com";
const qty = (n: number) => n.toLocaleString("en-KE", { maximumFractionDigits: 1 });

/** What is in stock to sell: milk and eggs (from the produce settings), with a way to the till and the prices. */
function ReadyToSell({ canManage }: { canManage: boolean }) {
  const [s, setS] = useState<{ milk: Linked | null; eggs: Linked | null } | null>(null);
  useEffect(() => {
    apiGet<{ milk: Linked | null; eggs: Linked | null }>("/farm/production/settings").then(setS).catch(() => setS({ milk: null, eggs: null }));
  }, []);
  if (!s) return null;
  const rows = [s.milk, s.eggs].filter((x): x is Linked => !!x);
  return (
    <Card title="Ready to sell">
      {rows.length === 0 ? (
        <p className="text-sm text-secondary-600">
          Milk and eggs are not linked to products yet. Open <Link href="/shamba/production" className="underline">Yields &amp; produce</Link> &gt; Settings and make them, so they go into stock for the till.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-2">
              <span>{r.name}</span>
              <span>
                <b>
                  {qty(r.inStock)} {r.unit}
                  {r.inStock === 1 ? "" : "s"}
                </b>{" "}
                <span className="text-secondary-500">at KES {r.price.toLocaleString("en-KE")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <a href={TERMINAL_URL} className="rounded-lg px-4 py-2 font-semibold text-white no-underline" style={{ background: SHAMBA_BRAND.orange }}>
          Open the till
        </a>
        <Link href="/sales" className="self-center underline">Sales</Link>
        {canManage && <Link href="/products" className="self-center underline">Change prices</Link>}
        <Link href="/inventory" className="self-center underline">Stock</Link>
      </div>
      <p className="mt-3 text-xs text-secondary-500">
        Sell at the till: tap your PIN, pick Fresh milk or Eggs, type the litres or trays, take cash or M-Pesa. Milk and eggs from treated animals never go into stock.
      </p>
    </Card>
  );
}

/** Orange warning when a feed has less than a week left at the rate it is being fed. */
function FeedAlert() {
  const [low, setLow] = useState<{ variantId: string; name: string; daysLeft: number | null }[]>([]);
  useEffect(() => {
    apiGet<{ lowFeeds: { variantId: string; name: string; daysLeft: number | null }[] }>("/farm/feed/report").then((r) => setLow(r.lowFeeds)).catch(() => setLow([]));
  }, []);
  if (!low.length) return null;
  return (
    <Link href="/shamba/feed" className="block rounded-xl border-2 px-4 py-3 text-sm font-semibold no-underline" style={{ borderColor: SHAMBA_BRAND.orange, background: "#fff4e8", color: "#7a3d00" }}>
      Feed running low: {low.map((f) => `${f.name} (${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"} left)`).join(", ")}. Open Feed →
    </Link>
  );
}

function Dashboard() {
  const [data, setData] = useState<FarmOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ farmName: "", county: "", subCounty: "", ward: "" });

  const load = () =>
    apiGet<FarmOverview>("/farm/overview").then(
      (d) => {
        setData(d);
        setForm({ farmName: d.settings?.farmName ?? "", county: d.settings?.county ?? "", subCounty: d.settings?.subCounty ?? "", ward: d.settings?.ward ?? "" });
      },
      (e) => setError(e instanceof ApiError ? e.message : "Could not load the farm"),
    );
  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiPatch("/farm/settings", form);
      setEditing(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save");
    }
  }

  if (error && !data) return <p className="text-red-700">{error}</p>;
  if (!data) return <p className="text-secondary-500">Loading...</p>;
  const canManage = data.me.isOwner || data.me.roles.includes("FARM_OWNER") || data.me.roles.includes("FARM_MANAGER");
  const days = data.currentPeriodEnd ? Math.ceil((new Date(data.currentPeriodEnd).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>{data.settings?.farmName ?? "My farm"}</h1>
          <p className="text-sm text-secondary-600">{[data.settings?.ward, data.settings?.subCounty, data.settings?.county].filter(Boolean).join(", ") || "Location not set"}</p>
        </div>
        {canManage && (
          <button type="button" className="rounded-lg border border-border bg-surface px-3 py-1.5 text-sm" onClick={() => setEditing((v) => !v)}>
            {editing ? "Cancel" : "Edit farm details"}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error}</p>}

      {editing && (
        <Card title="Farm details">
          <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-2">
            {(["farmName", "county", "subCounty", "ward"] as const).map((k) => (
              <label key={k}>
                {{ farmName: "Farm name", county: "County", subCounty: "Sub-county", ward: "Ward" }[k]}
                <input className={inputClass} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} required={k === "farmName"} />
              </label>
            ))}
            <div>
              <button type="submit" className="rounded-lg px-4 py-2 font-semibold text-white" style={{ background: SHAMBA_BRAND.navy }}>
                Save
              </button>
            </div>
          </form>
        </Card>
      )}

      <FeedAlert />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Overdue", value: data.livestock.overdue, href: "/shamba/health", warn: data.livestock.overdue > 0 },
          { label: "Due this week", value: data.livestock.dueWeek, href: "/shamba/health", warn: false },
          { label: "Births in 30 days", value: data.livestock.birthsSoon, href: "/shamba/health", warn: false },
          { label: "Milk/meat/eggs withheld", value: data.livestock.inWithdrawal, href: "/shamba/health#withdrawals", warn: data.livestock.inWithdrawal > 0 },
        ].map((t) => (
          <Link key={t.label} href={t.href} className="rounded-xl border bg-surface p-3 shadow-sm" style={{ borderColor: t.warn ? SHAMBA_BRAND.orange : "#e5e7eb" }}>
            <span className="block text-2xl font-bold" style={{ color: t.warn ? SHAMBA_BRAND.orange : SHAMBA_BRAND.navy }}>{t.value}</span>
            <span className="text-xs text-secondary-600">{t.label}</span>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={`${data.plan.name} plan`}>
          <p className="text-sm">
            <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: data.status === "SUSPENDED" ? "#b91c1c" : SHAMBA_BRAND.navy }}>
              {STATUS_LABEL[data.status]}
            </span>{" "}
            {days !== null && data.status !== "SUSPENDED" && <span className="text-secondary-600">{days > 0 ? `${days} days left in this period` : "Ends today"}</span>}
          </p>
          <div className="mt-4 space-y-3">
            <Usage label="Acres (fields and paddocks)" used={data.usage.acres} cap={data.plan.limits.acres} />
            <Usage label="Users with a farm role" used={data.usage.users} cap={data.plan.limits.users} />
            <Usage label="Livestock" used={data.usage.head} cap={data.plan.limits.head} />
            <Usage label="Birds" used={data.usage.birds} cap={data.plan.limits.birds} />
          </div>
          <Link href="/shamba/plan" className="mt-4 inline-block text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>
            Plan, payments and SMS credits
          </Link>
        </Card>
        <Card title="Your farm">
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <Link href="/shamba/animals" className="underline">Animals and flocks</Link>
              <span>
                {data.counts.animals} animals · {data.counts.groups} groups
              </span>
            </li>
            <li className="flex justify-between">
              <Link href="/shamba/layout" className="underline">Farm layout</Link>
              <span>{data.counts.units} parts</span>
            </li>
            <li className="flex justify-between">
              <Link href="/shamba/enterprises" className="underline">Enterprises</Link>
              <span>{data.counts.enterprises}</span>
            </li>
            <li className="flex justify-between">
              <Link href="/shamba/staff" className="underline">Staff and farm roles</Link>
              <span>{data.usage.users}</span>
            </li>
          </ul>
          <ul className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
            <li className="flex justify-between">
              <Link href="/shamba/milk" className="underline">Record milk</Link>
              <Link href="/shamba/eggs" className="underline">Record eggs</Link>
              <Link href="/shamba/production" className="underline">Yields</Link>
              <Link href="/shamba/crops" className="underline">Crops</Link>
              <Link href="/shamba/feed" className="underline">Feed</Link>
              <Link href="/shamba/workers" className="underline">Workers</Link>
              <Link href="/shamba/buyers" className="underline">Buyers</Link>
            </li>
          </ul>
          <p className="mt-4 text-xs text-secondary-500"><Link href="/shamba/reports" className="underline">Reports</Link>: profit per enterprise, cost per litre and egg, registers, Excel and PDF.</p>
        </Card>
        <ReadyToSell canManage={canManage} />
      </div>
    </div>
  );
}

export default function ShambaHome() {
  return <ShambaAppFrame>{() => <Dashboard />}</ShambaAppFrame>;
}
