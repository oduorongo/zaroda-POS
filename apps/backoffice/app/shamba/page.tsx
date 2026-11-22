"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../lib/api";
import { Card, ShambaAppFrame } from "../../components/shamba/frame";
import { SHAMBA_BRAND, STATUS_LABEL, inputClass, limitText, type FarmOverview } from "../../lib/shamba";

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
        <div className="mt-1 h-2 rounded-full bg-secondary-100">
          <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: pct >= 90 ? SHAMBA_BRAND.orange : SHAMBA_BRAND.navy }} />
        </div>
      )}
    </div>
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
          <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{data.settings?.farmName ?? "My farm"}</h1>
          <p className="text-sm text-secondary-600">{[data.settings?.ward, data.settings?.subCounty, data.settings?.county].filter(Boolean).join(", ") || "Location not set"}</p>
        </div>
        {canManage && (
          <button type="button" className="rounded-lg border border-secondary-300 bg-white px-3 py-1.5 text-sm" onClick={() => setEditing((v) => !v)}>
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
          <Link href="/shamba/pricing" className="mt-4 inline-block text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>
            See plans
          </Link>
        </Card>
        <Card title="Your farm">
          <ul className="space-y-2 text-sm">
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
          <p className="mt-4 text-xs text-secondary-500">
            Animals, milk and eggs, crops, feed mixing and selling come next. Set up your layout and enterprises now so they are ready.
          </p>
        </Card>
      </div>
    </div>
  );
}

export default function ShambaHome() {
  return <ShambaAppFrame>{() => <Dashboard />}</ShambaAppFrame>;
}
