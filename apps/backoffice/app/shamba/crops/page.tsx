"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { CROP_STATUS, SHAMBA_BRAND, day, inputClass, todayKey, type FarmEnterprise, type FarmUnit } from "../../../lib/shamba";

interface SeasonRow {
  id: string;
  crop: string;
  variety: string | null;
  acres: number;
  unitName: string;
  plantedOn: string | null;
  expectedHarvest: string | null;
  status: "PLANNED" | "GROWING" | "HARVESTING" | "CLOSED";
  harvestedKg: number;
  totalCost: number;
  kgPerAcre: number | null;
  costPerKg: number | null;
  safeHarvestFrom: string | null;
}

const CROPS = ["Maize", "Beans", "Napier grass", "Sorghum", "Potatoes", "Kale (sukuma wiki)", "Cabbage", "Tomatoes", "Onions", "Bananas", "Avocado", "Tea", "Coffee", "Sugarcane", "Rhodes grass", "Lucerne"];
const LAND = ["FIELD", "PADDOCK", "OTHER"];
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

function NewSeason({ onDone }: { onDone: () => void }) {
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [enterprises, setEnterprises] = useState<FarmEnterprise[]>([]);
  const [f, setF] = useState({ unitId: "", crop: "", variety: "", acres: "", plantedOn: "", expectedHarvest: "", enterpriseId: "", seedSupplier: "", seedCertNo: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiGet<FarmUnit[]>("/farm/units").then((u) => setUnits(u.filter((x) => x.active && LAND.includes(x.kind)))).catch(() => {});
    apiGet<FarmEnterprise[]>("/farm/enterprises").then(setEnterprises).catch(() => {});
  }, []);
  const unit = units.find((u) => u.id === f.unitId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/crops/seasons", {
        unitId: f.unitId, crop: f.crop.trim(), variety: f.variety.trim() || undefined, acres: Number(f.acres), plantedOn: f.plantedOn || undefined,
        expectedHarvest: f.expectedHarvest || undefined, enterpriseId: f.enterpriseId || undefined, seedSupplier: f.seedSupplier.trim() || undefined, seedCertNo: f.seedCertNo.trim() || undefined,
      });
      setF({ ...f, crop: "", variety: "", acres: "", plantedOn: "", expectedHarvest: "", seedSupplier: "", seedCertNo: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not add the season"));
    } finally {
      setBusy(false);
    }
  }

  if (!units.length) return <p className="text-sm text-secondary-500">No fields yet. Add fields with their acres under Layout first.</p>;
  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-4">
        <ErrorBox error={error} />
      </div>
      <label className="col-span-2">
        Field
        <select className={inputClass} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })} required>
          <option value="">Choose a field</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
              {u.acres ? ` (${Number(u.acres)} acres)` : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Crop
        <input className={inputClass} list="crops" value={f.crop} onChange={(e) => setF({ ...f, crop: e.target.value })} required />
        <datalist id="crops">
          {CROPS.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label>
        Variety
        <input className={inputClass} value={f.variety} onChange={(e) => setF({ ...f, variety: e.target.value })} placeholder="e.g. H614D, Rosecoco" />
      </label>
      <label>
        Acres
        <input type="number" inputMode="decimal" step="0.01" min="0.01" max={unit?.acres ?? undefined} className={inputClass} value={f.acres} onChange={(e) => setF({ ...f, acres: e.target.value })} placeholder={unit?.acres ? `up to ${Number(unit.acres)}` : ""} required />
      </label>
      <label>
        Planted on
        <input type="date" className={inputClass} value={f.plantedOn} max={todayKey()} onChange={(e) => setF({ ...f, plantedOn: e.target.value })} />
      </label>
      <label>
        Expected harvest
        <input type="date" className={inputClass} value={f.expectedHarvest} onChange={(e) => setF({ ...f, expectedHarvest: e.target.value })} />
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
        Seed supplier
        <input className={inputClass} value={f.seedSupplier} onChange={(e) => setF({ ...f, seedSupplier: e.target.value })} placeholder="e.g. Kenya Seed Company" />
      </label>
      <label className="col-span-2">
        Seed lot / certificate no. (KEPHIS)
        <input className={inputClass} value={f.seedCertNo} onChange={(e) => setF({ ...f, seedCertNo: e.target.value })} />
      </label>
      <div className="col-span-2 sm:col-span-4">
        <Btn busy={busy} disabled={!f.unitId || !f.crop.trim() || !f.acres}>Add season</Btn>
      </div>
    </form>
  );
}

export default function CropsPage() {
  const [rows, setRows] = useState<SeasonRow[] | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiGet<SeasonRow[]>(`/farm/crops/seasons${showClosed ? "?status=ALL" : ""}`).then(setRows).catch((err) => setError(errText(err, "Could not load the crops")));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClosed]);

  return (
    <ShambaAppFrame>
      {() => (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Crops</h1>
              <p className="text-sm text-secondary-600">Each crop in each field for a season: field work, sprays, harvests, and what it cost per acre and per kg.</p>
            </div>
            <Btn type="button" onClick={() => setAdding(!adding)}>{adding ? "Close" : "New season"}</Btn>
          </div>
          <ErrorBox error={error} />
          {adding && (
            <Card title="New crop season">
              <NewSeason onDone={() => { setAdding(false); void load(); }} />
            </Card>
          )}
          {!rows ? (
            <p className="text-sm text-secondary-500">Loading...</p>
          ) : rows.length === 0 ? (
            <Card>
              <p className="text-sm text-secondary-600">No crop seasons yet. Press New season to plant the first one.</p>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map((s) => (
                <Link key={s.id} href={`/shamba/crops/${s.id}`} className="block rounded-xl border border-secondary-200 bg-white p-4 no-underline shadow-sm hover:border-secondary-400">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>
                        {s.crop}
                        {s.variety ? ` · ${s.variety}` : ""}
                      </p>
                      <p className="text-sm text-secondary-600">
                        {s.unitName} · {s.acres} acres{s.plantedOn ? ` · planted ${day(s.plantedOn)}` : ""}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary-100 px-2 py-0.5 text-xs font-semibold text-secondary-700">{CROP_STATUS[s.status]}</span>
                  </div>
                  {s.safeHarvestFrom && (
                    <p className="mt-2 rounded-lg px-2 py-1 text-xs font-semibold" style={{ background: "#fff4e8", color: "#7a3d00" }}>
                      Sprayed: no harvest until {s.safeHarvestFrom}
                    </p>
                  )}
                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-secondary-500">
                    <span>
                      Harvested
                      <b className="block text-sm text-secondary-900">{s.harvestedKg.toLocaleString("en-KE")} kg</b>
                    </span>
                    <span>
                      Cost
                      <b className="block text-sm text-secondary-900">{kes(s.totalCost)}</b>
                    </span>
                    <span>
                      {s.costPerKg !== null ? "Per kg" : "Expected"}
                      <b className="block text-sm text-secondary-900">{s.costPerKg !== null ? kes(s.costPerKg) : s.expectedHarvest ? day(s.expectedHarvest) : "-"}</b>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-secondary-600">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show closed seasons
          </label>
        </div>
      )}
    </ShambaAppFrame>
  );
}
