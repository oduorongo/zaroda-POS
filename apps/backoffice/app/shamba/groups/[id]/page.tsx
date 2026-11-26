"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../../lib/api";
import { Card, ShambaAppFrame } from "../../../../components/shamba/frame";
import { SuggestedPriceCard } from "../../../../components/shamba/valuation";
import { ActionTabs, Btn, ErrorBox, HealthForm, HealthList, WeightForm, WithdrawalBanner, errText } from "../../../../components/shamba/livestock";
import { COUNT_REASONS, SHAMBA_BRAND, SHAMBA_INK, SPECIES, TASK_KINDS, ageText, day, inputClass, todayKey, type DueTask, type FarmGroup, type HealthEvent } from "../../../../lib/shamba";

interface GroupDetail extends FarmGroup {
  unitName: string | null;
  counts: { id: string; date: string; change: number; reason: string; note: string | null; amount: string | null }[];
  health: HealthEvent[];
  weights: { id: string; date: string; kg: string }[];
  due: DueTask[];
}

function CountForm({ g, onDone }: { g: GroupDetail; onDone: () => void }) {
  const [f, setF] = useState({ date: todayKey(), reason: "DIED", count: "", amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/farm/groups/${g.id}/counts`, { date: f.date, reason: f.reason, count: Number(f.count), amount: f.amount ? Number(f.amount) : undefined, note: f.note || undefined });
      setF({ ...f, count: "", amount: "", note: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }
  const paid = ["SOLD", "BOUGHT", "SLAUGHTERED"].includes(f.reason);
  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-3 text-sm">
      <div className="col-span-2">
        <ErrorBox error={error} />
      </div>
      <label>
        What happened
        <select className={inputClass} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>
          {Object.entries(COUNT_REASONS)
            .filter(([k]) => k !== "PLACED")
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </select>
      </label>
      <label>
        How many
        <input type="number" inputMode="numeric" className={inputClass} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} required />
      </label>
      <label>
        Date
        <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </label>
      {paid && (
        <label>
          Amount (KES)
          <input type="number" min="0" inputMode="decimal" className={inputClass} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        </label>
      )}
      <label className="col-span-2">
        Note
        <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </label>
      <div className="col-span-2">
        <Btn busy={busy} disabled={!f.count}>
          Save
        </Btn>
      </div>
    </form>
  );
}

function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const [g, setG] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiGet<GroupDetail>(`/farm/groups/${id}`).then(setG, (e) => setError(errText(e, "Could not load the group")));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function close() {
    if (!g || !window.confirm(`Close ${g.name}? It stays on record.`)) return;
    try {
      await apiPost(`/farm/groups/${g.id}/close`, {});
      await load();
    } catch (err) {
      setError(errText(err, "Could not close it"));
    }
  }

  if (!g) return error ? <ErrorBox error={error} /> : <p className="text-secondary-500">Loading...</p>;
  const reload = () => void load();

  return (
    <div className="space-y-4">
      <Link href="/shamba/animals" className="text-sm underline">
        ← Animals
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>{g.name}</h1>
          <p className="text-sm text-secondary-600">{[SPECIES[g.species], g.breed, g.purpose, `placed ${day(g.placedOn)} (${ageText(g.placedOn)})`, g.unitName, !g.active && "Closed"].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="text-4xl font-bold" style={{ color: SHAMBA_INK }}>{g.headCount.toLocaleString("en-KE")}</span>
      </div>

      <WithdrawalBanner w={g.withdrawal} />
      <ErrorBox error={error} />

      {g.active && (
        <ActionTabs
          tabs={[
            ["Count change", <CountForm key="c" g={g} onDone={reload} />],
            ["Health", <HealthForm key="h" target={{ groupId: g.id }} species={g.species} onDone={reload} />],
            ["Weight", <WeightForm key="w" target={{ groupId: g.id }} onDone={reload} />],
          ]}
        />
      )}

      {g.due.length > 0 && (
        <Card title="Coming up">
          <ul className="space-y-1 text-sm">
            {g.due.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span>{TASK_KINDS[t.kind] ? `${TASK_KINDS[t.kind]}: ${t.title.split(":")[0]}` : t.title}</span>
                <span className={day(t.dueOn) < todayKey() ? "font-semibold text-red-700" : "text-secondary-600"}>{day(t.dueOn)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SuggestedPriceCard id={id} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Head count history">
          <ul className="divide-y divide-border text-sm">
            {g.counts.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 py-1.5">
                <span>
                  {day(c.date)} · {COUNT_REASONS[c.reason] ?? c.reason}
                  {c.note && <span className="text-secondary-500"> · {c.note}</span>}
                  {c.amount && <span className="text-secondary-500"> · KES {Number(c.amount).toLocaleString("en-KE")}</span>}
                </span>
                <strong style={{ color: c.change < 0 ? "#b91c1c" : SHAMBA_BRAND.navy }}>{c.change > 0 ? `+${c.change}` : c.change}</strong>
              </li>
            ))}
          </ul>
          {g.active && g.headCount === 0 && (
            <div className="mt-3">
              <Btn type="button" tone="navy" onClick={() => void close()}>
                Close this group
              </Btn>
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Health">
            <HealthList events={g.health} onChanged={reload} />
          </Card>
          {g.weights.length > 0 && (
            <Card title="Average weights">
              <ul className="space-y-1 text-sm">
                {g.weights.map((w) => (
                  <li key={w.id} className="flex justify-between">
                    <span>{day(w.date)}</span>
                    <span>{Number(w.kg)} kg</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ShambaGroupPage() {
  return <ShambaAppFrame>{() => <GroupPage />}</ShambaAppFrame>;
}
