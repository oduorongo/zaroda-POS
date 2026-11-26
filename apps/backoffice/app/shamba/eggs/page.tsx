"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, SHAMBA_INK, day, inputClass, todayKey } from "../../../lib/shamba";

interface Flock { id: string; name: string; species: string; headCount: number; active: boolean; withheldUntil: string | null }
interface EggRecord {
  id: string; groupId: string; groupName: string; date: string; birds: number; goodEggs: number; cracked: number; small: number;
  feedKg: number | null; deaths: number; withheld: boolean; toStock: number; layPct: number | null; voidedAt: string | null; voidReason: string | null;
}
interface EggList { groups: Flock[]; records: EggRecord[] }

const blank = { goodEggs: "", cracked: "", small: "", feedKg: "", deaths: "" };
const trays = (n: number) => `${Math.floor(n / 30)} trays${n % 30 ? ` ${n % 30}` : ""}`;

function EggForm({ flocks, onDone }: { flocks: Flock[]; onDone: (msg: string) => void }) {
  const open = flocks.filter((f) => f.active);
  const [groupId, setGroupId] = useState(open[0]?.id ?? "");
  const [date, setDate] = useState(todayKey());
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flock = open.find((x) => x.id === groupId);
  const laid = Number(f.goodEggs || 0) + Number(f.cracked || 0) + Number(f.small || 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const n = (v: string) => (v === "" ? undefined : Number(v));
      const r = await apiPost<{ toStock: number; layPct: number | null; withheldUntil: string | null; stockNote: string | null }>("/farm/production/eggs", {
        groupId, date, goodEggs: Number(f.goodEggs || 0), cracked: n(f.cracked), small: n(f.small), feedKg: n(f.feedKg), deaths: n(f.deaths),
      });
      setF(blank);
      onDone(
        [
          `Saved: lay ${r.layPct ?? "-"}%.`,
          r.withheldUntil ? `The flock was treated, so the eggs are withheld and not for sale until after ${r.withheldUntil}.` : r.toStock ? `${r.toStock} trays went into stock.` : "",
          r.stockNote ?? "",
        ].filter(Boolean).join(" "),
      );
    } catch (err) {
      setError(errText(err, "Could not save the eggs"));
    } finally {
      setBusy(false);
    }
  }

  if (!open.length) return <p className="text-sm text-secondary-500">No poultry flocks. Add a flock under Animals first.</p>;
  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
      <div className="col-span-2 sm:col-span-3">
        <ErrorBox error={error} />
      </div>
      <label className="col-span-2 sm:col-span-2">
        Flock
        <select className={inputClass} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          {open.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.headCount} birds)
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" className={inputClass} value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
      </label>
      {flock?.withheldUntil && (
        <p className="col-span-2 rounded-lg px-3 py-2 font-semibold sm:col-span-3" style={{ background: "#fff4e8", color: "#7a3d00" }}>
          {flock.name} was treated: its eggs cannot be sold until after {flock.withheldUntil}. They will be recorded as withheld.
        </p>
      )}
      {([
        ["goodEggs", "Good eggs", true],
        ["cracked", "Cracked", false],
        ["small", "Small", false],
        ["feedKg", "Feed eaten (kg)", false],
        ["deaths", "Birds died", false],
      ] as const).map(([k, label, required]) => (
        <label key={k}>
          {label}
          <input
            type="number"
            inputMode={k === "feedKg" ? "decimal" : "numeric"}
            step={k === "feedKg" ? "0.1" : "1"}
            min="0"
            className="mt-1 w-full rounded-lg border border-border bg-surface p-3 text-lg text-foreground"
            value={f[k]}
            onChange={(e) => setF({ ...f, [k]: e.target.value })}
            required={required}
          />
        </label>
      ))}
      <p className="col-span-2 text-secondary-600 sm:col-span-3">
        {laid > 0 && flock ? `${laid} eggs from ${flock.headCount} birds: lay ${Math.round((laid / Math.max(1, flock.headCount)) * 1000) / 10}%. Good eggs: ${trays(Number(f.goodEggs || 0))}.` : "Count the good eggs; cracked and small eggs are kept out of stock."}
      </p>
      <div className="col-span-2 sm:col-span-3">
        <Btn busy={busy} disabled={!groupId || f.goodEggs === ""}>Save eggs</Btn>
      </div>
    </form>
  );
}

export default function EggsPage() {
  const [data, setData] = useState<EggList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    try {
      setData(await apiGet<EggList>("/farm/production/eggs"));
    } catch (err) {
      setError(errText(err, "Could not load the egg records"));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function voidRecord(id: string) {
    const reason = window.prompt("Why void this record? (it is kept, marked void; its eggs leave stock and any deaths are given back)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/production/eggs/${id}/void`, { reason });
      await load();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }

  return (
    <ShambaAppFrame>
      {(session) => (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Eggs</h1>
            <p className="text-sm text-secondary-600">Each flock&apos;s eggs for the day, with feed and deaths. Good eggs go into stock as trays; eggs from treated birds are withheld.</p>
          </div>
          <ErrorBox error={error} />
          {done && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_INK }}>{done}</p>}
          <Card title="Record today's eggs">
            {data ? <EggForm key={data.groups.map((g) => g.id + g.headCount).join()} flocks={data.groups} onDone={(m) => { setDone(m); void load(); }} /> : <p className="text-sm text-secondary-500">Loading...</p>}
          </Card>
          {data && data.records.length > 0 && (
            <Card title="Last 14 days">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-secondary-500">
                      <th className="py-1">Date</th>
                      <th>Flock</th>
                      <th>Good</th>
                      <th>Cracked</th>
                      <th>Small</th>
                      <th>Lay %</th>
                      <th>Feed kg</th>
                      <th>Died</th>
                      <th>To stock</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.records.map((r) => (
                      <tr key={r.id} className={`border-t border-border ${r.voidedAt ? "text-secondary-400 line-through" : ""}`} title={r.voidReason ?? undefined}>
                        <td className="py-1.5 whitespace-nowrap">{day(r.date)}</td>
                        <td>{r.groupName}</td>
                        <td>{r.goodEggs}</td>
                        <td>{r.cracked}</td>
                        <td>{r.small}</td>
                        <td className="font-semibold">{r.layPct ?? "-"}</td>
                        <td>{r.feedKg ?? "-"}</td>
                        <td>{r.deaths || ""}</td>
                        <td>{r.withheld ? <span className="text-xs font-semibold" style={{ color: SHAMBA_BRAND.orange }}>withheld</span> : r.toStock ? `${r.toStock} trays` : "-"}</td>
                        <td className="text-right">
                          {!r.voidedAt && (session.role === "OWNER" || session.role === "MANAGER") && (
                            <button type="button" onClick={() => void voidRecord(r.id)} className="text-xs text-red-700 hover:underline">
                              Void
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </ShambaAppFrame>
  );
}
