"use client";

import { useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { HEALTH_KINDS, SHAMBA_BRAND, SHAMBA_INK, day, inputClass, todayKey, withdrawalLines, type FarmDrug, type FarmProgramme, type HealthEvent, type Withdrawal } from "../../lib/shamba";

export const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

export function ErrorBox({ error }: { error: string | null }) {
  return error ? <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null;
}

export function Btn({ children, busy, disabled, tone = "orange", type = "submit", onClick }: { children: ReactNode; busy?: boolean; disabled?: boolean; tone?: "orange" | "navy"; type?: "submit" | "button"; onClick?: () => void }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={busy || disabled}
      className="w-full rounded-lg px-4 py-2.5 font-semibold text-white disabled:opacity-50 sm:w-auto"
      style={{ background: tone === "orange" ? SHAMBA_BRAND.orange : SHAMBA_BRAND.navy }}
    >
      {busy ? "Saving..." : children}
    </button>
  );
}

/** Orange banner: milk/meat/eggs from this animal or group cannot be sold yet. */
export function WithdrawalBanner({ w }: { w: Withdrawal }) {
  const lines = withdrawalLines(w);
  if (!lines.length) return null;
  return (
    <div className="rounded-xl border-2 px-4 py-3 text-sm font-semibold" style={{ borderColor: SHAMBA_BRAND.orange, background: "#fff4e8", color: "#7a3d00" }}>
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

export function WithdrawalBadge({ w }: { w: Withdrawal }) {
  const lines = withdrawalLines(w);
  if (!lines.length) return null;
  return (
    <span className="rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: SHAMBA_BRAND.orange }} title={lines.join("\n")}>
      Withheld
    </span>
  );
}

/** Record sickness, a treatment or a programme dose for one animal or a group. */
export function HealthForm({ target, species, onDone }: { target: { animalId?: string; groupId?: string }; species: string; onDone: () => void }) {
  const [drugs, setDrugs] = useState<FarmDrug[]>([]);
  const [programmes, setProgrammes] = useState<FarmProgramme[]>([]);
  const [f, setF] = useState({ date: todayKey(), kind: "TREATED", diagnosis: "", drugId: "", dose: "", vetName: "", cost: "", notes: "", programmeId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<FarmDrug[]>("/farm/drugs").then(setDrugs, () => undefined);
    apiGet<FarmProgramme[]>("/farm/programmes").then((p) => setProgrammes(p.filter((x) => x.species === species)), () => undefined);
  }, [species]);

  const drug = drugs.find((d) => d.id === f.drugId);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/health", {
        ...target,
        date: f.date,
        kind: f.kind,
        diagnosis: f.diagnosis || undefined,
        drugId: f.drugId || undefined,
        dose: f.dose || undefined,
        vetName: f.vetName || undefined,
        cost: f.cost ? Number(f.cost) : undefined,
        notes: f.notes || undefined,
        programmeId: f.programmeId || undefined,
      });
      setF({ ...f, diagnosis: "", drugId: "", dose: "", cost: "", notes: "", programmeId: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-2">
      <ErrorBox error={error} />
      <label>
        What happened
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(HEALTH_KINDS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Date
        <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </label>
      {programmes.length > 0 && ["VACCINATED", "DEWORMED", "DIPPED"].includes(f.kind) && (
        <label className="sm:col-span-2">
          Programme dose (ticks off what is due)
          <select
            className={inputClass}
            value={f.programmeId}
            onChange={(e) => {
              const p = programmes.find((x) => x.id === e.target.value);
              setF({ ...f, programmeId: e.target.value, drugId: p?.drugId ?? f.drugId, kind: p?.kind ?? f.kind });
            }}
          >
            <option value="">Not part of a programme</option>
            {programmes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="sm:col-span-2">
        Sickness / reason
        <input className={inputClass} value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} placeholder="e.g. Mastitis, East Coast Fever, routine" />
      </label>
      <label>
        Drug or vaccine
        <select className={inputClass} value={f.drugId} onChange={(e) => setF({ ...f, drugId: e.target.value })}>
          <option value="">None</option>
          {drugs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
              {d.prescriptionOnly ? " (vet only)" : ""}
            </option>
          ))}
        </select>
      </label>
      <label>
        Dose
        <input className={inputClass} value={f.dose} onChange={(e) => setF({ ...f, dose: e.target.value })} placeholder="e.g. 20 ml" />
      </label>
      {drug && (drug.milkWithdrawalDays > 0 || drug.meatWithdrawalDays > 0 || drug.eggWithdrawalDays > 0) && (
        <p className="rounded-lg px-3 py-2 text-xs font-semibold sm:col-span-2" style={{ background: "#fff4e8", color: "#7a3d00" }}>
          Withdrawal: milk {drug.milkWithdrawalDays} days, meat {drug.meatWithdrawalDays} days{drug.eggWithdrawalDays ? `, eggs ${drug.eggWithdrawalDays} days` : ""}. Sales are blocked until it ends.
        </p>
      )}
      <label>
        Vet
        <input className={inputClass} value={f.vetName} onChange={(e) => setF({ ...f, vetName: e.target.value })} />
      </label>
      <label>
        Cost (KES)
        <input type="number" min="0" step="0.01" inputMode="decimal" className={inputClass} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
      </label>
      <label className="sm:col-span-2">
        Notes
        <input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <div className="sm:col-span-2">
        <Btn busy={busy}>Save</Btn>
      </div>
    </form>
  );
}

export function WeightForm({ target, onDone }: { target: { animalId?: string; groupId?: string }; onDone: () => void }) {
  const [f, setF] = useState({ date: todayKey(), kg: "", bodyCondition: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/weights", { ...target, date: f.date, kg: Number(f.kg), bodyCondition: f.bodyCondition ? Number(f.bodyCondition) : undefined });
      setF({ ...f, kg: "", bodyCondition: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-4">
        <ErrorBox error={error} />
      </div>
      <label>
        Date
        <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} required />
      </label>
      <label>
        {target.groupId ? "Average kg" : "Kg"}
        <input type="number" min="0.001" step="0.001" inputMode="decimal" className={inputClass} value={f.kg} onChange={(e) => setF({ ...f, kg: e.target.value })} required />
      </label>
      {target.animalId && (
        <label>
          Body condition (1-5)
          <input type="number" min="1" max="5" step="0.5" inputMode="decimal" className={inputClass} value={f.bodyCondition} onChange={(e) => setF({ ...f, bodyCondition: e.target.value })} />
        </label>
      )}
      <div className="col-span-2 self-end sm:col-span-1">
        <Btn busy={busy} disabled={!f.kg}>Save</Btn>
      </div>
    </form>
  );
}

/** Health history, with void (never delete) for a wrong entry. */
export function HealthList({ events, onChanged }: { events: HealthEvent[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function voidIt(id: string) {
    const reason = window.prompt("Why is this entry wrong? (it stays on record, marked void)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/health/${id}/void`, { reason });
      onChanged();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }
  if (!events.length) return <p className="text-sm text-secondary-500">Nothing recorded yet.</p>;
  return (
    <>
      <ErrorBox error={error} />
      <ul className="divide-y divide-border text-sm">
        {events.map((e) => (
          <li key={e.id} className={`py-2 ${e.voidedAt ? "text-secondary-400 line-through" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                <strong>{HEALTH_KINDS[e.kind] ?? e.kind}</strong> · {day(e.date)}
                {e.diagnosis && <> · {e.diagnosis}</>}
              </span>
              {!e.voidedAt && (
                <button type="button" className="text-xs underline" onClick={() => void voidIt(e.id)}>
                  Void
                </button>
              )}
            </div>
            <span className="block text-xs text-secondary-500">
              {[e.drugName, e.dose, e.vetName, e.cost && `KES ${Number(e.cost).toLocaleString("en-KE")}`, e.notes].filter(Boolean).join(" · ")}
              {e.voidReason && ` · Void: ${e.voidReason}`}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Opens one form at a time on small screens. */
export function ActionTabs({ tabs }: { tabs: [string, ReactNode][] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {tabs.map(([label]) => (
          <button
            key={label}
            type="button"
            onClick={() => setOpen(open === label ? null : label)}
            className="rounded-full border px-3 py-1.5 text-sm font-semibold"
            style={open === label ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_INK }}
          >
            {label}
          </button>
        ))}
      </div>
      {open && <div className="mt-3 rounded-xl border border-border bg-background p-3">{tabs.find(([l]) => l === open)?.[1]}</div>}
    </div>
  );
}
