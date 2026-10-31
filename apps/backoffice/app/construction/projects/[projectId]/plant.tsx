"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { apiGet } from "../../../../lib/api";
import { CON_BRAND, conSend, errorText, hasConRole, isUpgrade, kes } from "../../../../lib/construction";
import { todayEat } from "../../../../lib/con-site";
import { useConMe } from "../../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, UpgradeCard, inputClass } from "../../../../components/construction/ui";
import type { TabProps } from "./types";

interface Cost { rows: { plantId: string; name: string; regNo: string | null; ownership: string; rateUnit: string; hireRate: number | null; hours: number; days: number; fuelLitres: number; fuelCost: number; hireCost: number; total: number }[]; total: number }
interface Log { id: string; plant: string; date: string; hours: number; fuelLitres: number | null; fuelCost: number | null; operator: string | null }
interface Plant { id: string; name: string; regNo: string | null; isActive: boolean }

export function PlantTab({ project: p }: TabProps) {
  const me = useConMe();
  const canLog = hasConRole(me, "CON_PROCUREMENT") || !!me?.projectRoles.some((r) => r.projectId === p.id && ["CON_PROJECT_MGR", "CON_SITE_SUPERVISOR", "CON_STOREKEEPER"].includes(r.role));
  const [cost, setCost] = useState<Cost | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [plant, setPlant] = useState<Plant[]>([]);
  const [f, setF] = useState({ plantId: "", date: todayEat(), hours: "8", fuelLitres: "", fuelCost: "", operator: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLogs(await apiGet<Log[]>(`/construction/projects/${p.id}/plant-logs`));
      setPlant((await apiGet<Plant[]>("/construction/plant")).filter((x) => x.isActive));
      setCost(await apiGet<Cost>(`/construction/projects/${p.id}/plant-cost`).catch(() => null));
    } catch (e) {
      if (isUpgrade(e)) setUpgrade(errorText(e, ""));
      else setError(errorText(e, "Could not load plant."));
    }
  }, [p.id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await conSend("POST", `/construction/projects/${p.id}/plant-logs`, { plantId: f.plantId, date: f.date, hours: Number(f.hours), fuelLitres: f.fuelLitres ? Number(f.fuelLitres) : undefined, fuelCost: f.fuelCost ? Number(f.fuelCost) : undefined, operator: f.operator || undefined });
      setF({ ...f, fuelLitres: "", fuelCost: "" });
      await load();
    } catch (e) {
      setError(errorText(e, "Could not save the log."));
    } finally {
      setBusy(false);
    }
  }

  if (upgrade) return <UpgradeCard message={upgrade} />;

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {cost && (
        <Panel title={`Plant cost on this project: ${kes(cost.total)}`} action={<Link href="/construction/plant" className="text-sm" style={{ color: CON_BRAND.orange }}>Plant register</Link>}>
          {cost.rows.length === 0 ? <p className="text-sm text-secondary-500">No plant logged yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-secondary-500"><tr><th className="py-1">Plant</th><th className="text-right">Days</th><th className="text-right">Hours</th><th className="text-right">Fuel (L)</th><th className="text-right">Fuel</th><th className="text-right">Hire</th><th className="text-right">Total</th></tr></thead>
                <tbody className="divide-y divide-border">
                  {cost.rows.map((r) => (
                    <tr key={r.plantId}>
                      <td className="py-1.5">{r.name}{r.regNo ? ` (${r.regNo})` : ""} <span className="text-xs text-secondary-500">{r.ownership === "HIRED" ? `hired ${kes(r.hireRate ?? 0)}/${r.rateUnit.toLowerCase()}` : "owned"}</span></td>
                      <td className="text-right">{r.days}</td><td className="text-right">{r.hours}</td><td className="text-right">{r.fuelLitres}</td>
                      <td className="text-right">{kes(r.fuelCost)}</td><td className="text-right">{kes(r.hireCost)}</td><td className="text-right font-semibold">{kes(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

      {canLog && (
        <Panel title="Log a day's plant use">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Plant">
              <select className={inputClass} value={f.plantId} onChange={(e) => setF({ ...f, plantId: e.target.value })}>
                <option value="">Choose...</option>
                {plant.map((x) => <option key={x.id} value={x.id}>{x.name}{x.regNo ? ` (${x.regNo})` : ""}</option>)}
              </select>
            </Field>
            <Field label="Date"><input type="date" className={inputClass} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Hours worked"><input className={inputClass} inputMode="decimal" value={f.hours} onChange={(e) => setF({ ...f, hours: e.target.value })} /></Field>
            <Field label="Fuel (litres)"><input className={inputClass} inputMode="decimal" value={f.fuelLitres} onChange={(e) => setF({ ...f, fuelLitres: e.target.value })} /></Field>
            <Field label="Fuel cost (KES)"><input className={inputClass} inputMode="decimal" value={f.fuelCost} onChange={(e) => setF({ ...f, fuelCost: e.target.value })} /></Field>
            <Field label="Operator"><input className={inputClass} value={f.operator} onChange={(e) => setF({ ...f, operator: e.target.value })} /></Field>
          </div>
          <p className="mt-1 text-xs text-secondary-500">One entry per machine per day; logging the same day again corrects it.</p>
          <div className="mt-3"><PrimaryButton disabled={busy || !f.plantId || f.hours === ""} onClick={save}>{busy ? "Saving..." : "Save log"}</PrimaryButton></div>
        </Panel>
      )}

      <Panel title="Plant logs">
        {logs.length === 0 && <p className="text-sm text-secondary-500">None yet.</p>}
        <ul className="divide-y divide-border text-sm">
          {logs.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1.5">
              <span>{l.date} · {l.plant}</span>
              <span className="text-xs text-secondary-500">{l.hours} h{l.fuelLitres ? ` · ${l.fuelLitres} L` : ""}{l.fuelCost ? ` · ${kes(l.fuelCost)}` : ""}{l.operator ? ` · ${l.operator}` : ""}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
