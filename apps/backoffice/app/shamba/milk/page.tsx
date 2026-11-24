"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, inputClass, todayKey } from "../../../lib/shamba";

type Session = "AM" | "NOON" | "PM";
type Use = "SOLD" | "CALVES" | "HOME" | "DISCARDED";
interface SheetAnimal { id: string; tag: string; name: string | null; species: string; dry: boolean; withheldUntil: string | null }
interface SheetGroup { id: string; name: string; species: string; headCount: number; withheldUntil: string | null }
interface MilkRecord { id: string; animalId: string | null; groupId: string | null; session: Session; litres: number; use: Use; withheld: boolean; toStock: number }
interface Sheet { date: string; animals: SheetAnimal[]; groups: SheetGroup[]; records: MilkRecord[] }
interface Line { litres: string; use: Use }

const SESSIONS: Record<Session, string> = { AM: "Morning", NOON: "Midday", PM: "Evening" };
const USES: Record<Use, string> = { SOLD: "For sale", CALVES: "Fed to calves", HOME: "Home use", DISCARDED: "Poured away" };
const defaultSession = (): Session => {
  const h = new Date(Date.now() + 3 * 3600_000).getUTCHours();
  return h < 11 ? "AM" : h < 15 ? "NOON" : "PM";
};

function MilkSheet({ canVoid }: { canVoid: boolean }) {
  const [date, setDate] = useState(todayKey());
  const [session, setSession] = useState<Session>(defaultSession());
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [showDry, setShowDry] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const s = await apiGet<Sheet>(`/farm/production/milk?date=${date}`);
      setSheet(s);
      setLines({});
    } catch (err) {
      setError(errText(err, "Could not load the milking sheet"));
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const recorded = (id: string) => sheet?.records.find((r) => (r.animalId === id || r.groupId === id) && r.session === session);
  const line = (id: string, withheld: boolean): Line => lines[id] ?? { litres: "", use: withheld ? "DISCARDED" : "SOLD" };
  const setLine = (id: string, withheld: boolean, patch: Partial<Line>) => setLines({ ...lines, [id]: { ...line(id, withheld), ...patch } });

  const rows = [
    ...(sheet?.animals ?? []).filter((a) => showDry || !a.dry).map((a) => ({ id: a.id, kind: "animal" as const, label: `${a.tag}${a.name ? ` ${a.name}` : ""}`, note: a.dry ? "Dry" : null, withheldUntil: a.withheldUntil })),
    ...(sheet?.groups ?? []).map((g) => ({ id: g.id, kind: "group" as const, label: `${g.name} (${g.headCount})`, note: "Group", withheldUntil: g.withheldUntil })),
  ];
  const entries = rows
    .filter((r) => !recorded(r.id) && Number(lines[r.id]?.litres) > 0)
    .map((r) => ({ [r.kind === "animal" ? "animalId" : "groupId"]: r.id, litres: Number(lines[r.id].litres), use: line(r.id, !!r.withheldUntil).use }));
  const total = entries.reduce((s, e) => s + (e.litres as number), 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ saved: number; litres: number; toStock: number; withheld: string[]; stockNote: string | null }>("/farm/production/milk", { date, session, entries });
      setDone(
        [
          `Saved ${r.saved} ${r.saved === 1 ? "cow" : "cows"}: ${r.litres} litres, ${r.toStock} litres into stock for sale.`,
          r.withheld.length ? `Withheld (treated): ${r.withheld.join(", ")}.` : "",
          r.stockNote ?? "",
        ].filter(Boolean).join(" "),
      );
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the milking"));
    } finally {
      setBusy(false);
    }
  }

  async function voidRecord(id: string) {
    const reason = window.prompt("Why void this record? (it is kept, marked void, and its milk taken out of stock)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/production/milk/${id}/void`, { reason });
      await load();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }

  const nameOf = (r: MilkRecord) => {
    const a = sheet?.animals.find((x) => x.id === r.animalId);
    return a ? `${a.tag}${a.name ? ` ${a.name}` : ""}` : sheet?.groups.find((g) => g.id === r.groupId)?.name ?? "";
  };
  const sessionRecords = (sheet?.records ?? []).filter((r) => r.session === session);
  const dayTotal = (sheet?.records ?? []).reduce((s, r) => s + r.litres, 0);

  return (
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <label>
            Date
            <input type="date" className={inputClass} value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="col-span-2 sm:col-span-3">
            Milking
            <div className="mt-1 flex gap-1">
              {(Object.keys(SESSIONS) as Session[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSession(s)}
                  className="flex-1 rounded-lg border px-2 py-2.5 font-semibold"
                  style={session === s ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_BRAND.navy }}
                >
                  {SESSIONS[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm text-secondary-600">
          Whole day so far: <b>{Math.round(dayTotal * 10) / 10} litres</b>
        </p>
      </Card>

      <ErrorBox error={error} />
      {done && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_BRAND.navy }}>{done}</p>}

      <Card title={`${SESSIONS[session]} milking`}>
        {!sheet ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-secondary-500">No cows or goats in milk. Add female cattle or goats under Animals first.</p>
        ) : (
          <form onSubmit={save} className="space-y-2">
            {rows.map((r) => {
              const rec = recorded(r.id);
              const l = line(r.id, !!r.withheldUntil);
              return (
                <div key={r.id} className="rounded-lg border border-secondary-200 p-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>
                      {r.label} {r.note && <span className="text-xs font-normal text-secondary-500">· {r.note}</span>}
                    </span>
                    {r.withheldUntil && (
                      <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: SHAMBA_BRAND.orange }}>
                        Treated: not for sale until after {r.withheldUntil}
                      </span>
                    )}
                  </div>
                  {rec ? (
                    <p className="mt-1 text-sm text-secondary-600">
                      Recorded: {rec.litres} L · {USES[rec.use]}
                      {rec.withheld ? " (withheld)" : ""}
                    </p>
                  ) : (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        max="200"
                        placeholder="Litres"
                        aria-label={`Litres from ${r.label}`}
                        className="w-full rounded-lg border border-secondary-300 bg-white p-3 text-lg text-secondary-900"
                        value={l.litres}
                        onChange={(e) => setLine(r.id, !!r.withheldUntil, { litres: e.target.value })}
                      />
                      <select className="w-full rounded-lg border border-secondary-300 bg-white p-3 text-sm text-secondary-900" value={l.use} onChange={(e) => setLine(r.id, !!r.withheldUntil, { use: e.target.value as Use })}>
                        {(Object.keys(USES) as Use[])
                          .filter((u) => !(r.withheldUntil && u === "SOLD"))
                          .map((u) => (
                            <option key={u} value={u}>
                              {USES[u]}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>
              );
            })}
            {(sheet.animals.some((a) => a.dry)) && (
              <label className="flex items-center gap-2 text-sm text-secondary-600">
                <input type="checkbox" checked={showDry} onChange={(e) => setShowDry(e.target.checked)} />
                Show dry cows
              </label>
            )}
            <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/95 p-2 shadow">
              <span className="text-sm text-secondary-700">
                {entries.length} {entries.length === 1 ? "cow" : "cows"} · <b>{Math.round(total * 10) / 10} L</b>
              </span>
              <Btn busy={busy} disabled={!entries.length}>
                Save milking
              </Btn>
            </div>
          </form>
        )}
      </Card>

      {sessionRecords.length > 0 && (
        <Card title={`Recorded for the ${SESSIONS[session].toLowerCase()} milking`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th className="py-1">Cow</th>
                  <th>Litres</th>
                  <th>Use</th>
                  <th>To stock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sessionRecords.map((r) => (
                  <tr key={r.id} className="border-t border-secondary-100">
                    <td className="py-1.5">{nameOf(r)}</td>
                    <td>{r.litres}</td>
                    <td>
                      {USES[r.use]}
                      {r.withheld && <span className="ml-1 text-xs font-semibold" style={{ color: SHAMBA_BRAND.orange }}>withheld</span>}
                    </td>
                    <td>{r.toStock ? `${r.toStock} L` : "-"}</td>
                    <td className="text-right">
                      {canVoid && (
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
  );
}

export default function MilkPage() {
  return (
    <ShambaAppFrame>
      {(session) => (
        <div className="space-y-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Milk</h1>
            <p className="text-sm text-secondary-600">Litres from each cow at each milking. Milk for sale goes into stock for the till; milk from treated cows is withheld and cannot be sold.</p>
          </div>
          <MilkSheet canVoid={session.role === "OWNER" || session.role === "MANAGER"} />
        </div>
      )}
    </ShambaAppFrame>
  );
}
