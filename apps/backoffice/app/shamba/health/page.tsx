"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, SHAMBA_INK, SPECIES, TASK_KINDS, day, inputClass, todayKey, type DueTask, type FarmDrug, type FarmProgramme } from "../../../lib/shamba";

interface WithdrawalRow {
  eventId: string;
  animalId: string | null;
  groupId: string | null;
  label: string;
  drug: string | null;
  treatedOn: string;
  milkUntil: string | null;
  meatUntil: string | null;
  eggUntil: string | null;
}

const linkFor = (x: { animalId: string | null; groupId: string | null }) => (x.animalId ? `/shamba/animals/${x.animalId}` : `/shamba/groups/${x.groupId}`);

function AddDrug({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", milkWithdrawalDays: "0", meatWithdrawalDays: "0", eggWithdrawalDays: "0", prescriptionOnly: false });
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPost("/farm/drugs", { name: f.name.trim(), milkWithdrawalDays: Number(f.milkWithdrawalDays), meatWithdrawalDays: Number(f.meatWithdrawalDays), eggWithdrawalDays: Number(f.eggWithdrawalDays), prescriptionOnly: f.prescriptionOnly });
      setF({ name: "", milkWithdrawalDays: "0", meatWithdrawalDays: "0", eggWithdrawalDays: "0", prescriptionOnly: false });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not add it"));
    }
  }
  return (
    <form onSubmit={save} className="grid grid-cols-3 gap-2 text-sm">
      <div className="col-span-3">
        <ErrorBox error={error} />
      </div>
      <label className="col-span-3">
        Drug or vaccine name
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </label>
      {(["milkWithdrawalDays", "meatWithdrawalDays", "eggWithdrawalDays"] as const).map((k) => (
        <label key={k}>
          {{ milkWithdrawalDays: "Milk days", meatWithdrawalDays: "Meat days", eggWithdrawalDays: "Egg days" }[k]}
          <input type="number" min="0" max="365" inputMode="numeric" className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required />
        </label>
      ))}
      <label className="col-span-3 flex items-center gap-2">
        <input type="checkbox" checked={f.prescriptionOnly} onChange={(e) => setF({ ...f, prescriptionOnly: e.target.checked })} />
        Prescription-only (only the vet or farm manager can record it)
      </label>
      <p className="col-span-3 text-xs text-secondary-500">Copy the withdrawal days from the label. Milk, meat or eggs cannot be sold until they end.</p>
      <div className="col-span-3">
        <Btn disabled={f.name.trim().length < 2}>Add</Btn>
      </div>
    </form>
  );
}

function AddProgramme({ drugs, onDone }: { drugs: FarmDrug[]; onDone: () => void }) {
  const [f, setF] = useState({ species: "CATTLE", name: "", kind: "VACCINATED", drugId: "", firstAgeDays: "", intervalDays: "" });
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiPost("/farm/programmes", { ...f, drugId: f.drugId || undefined, firstAgeDays: f.firstAgeDays ? Number(f.firstAgeDays) : undefined, intervalDays: Number(f.intervalDays) });
      setF({ ...f, name: "", firstAgeDays: "", intervalDays: "" });
      onDone();
    } catch (err) {
      setUpgrade(err instanceof ApiError && err.status === 402);
      setError(errText(err, "Could not add it"));
    }
  }
  return (
    <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm">
      <div className="col-span-2">
        <ErrorBox error={error} />
        {upgrade && (
          <Link href="/shamba/pricing" className="text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>
            See plans
          </Link>
        )}
      </div>
      <label>
        For
        <select className={inputClass} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value })}>
          {Object.entries(SPECIES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Kind
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          <option value="VACCINATED">Vaccination</option>
          <option value="DEWORMED">Deworming</option>
          <option value="DIPPED">Dipping / spraying</option>
        </select>
      </label>
      <label className="col-span-2">
        Name
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. FMD vaccination, Gumboro, Deworming" required />
      </label>
      <label className="col-span-2">
        Drug or vaccine
        <select className={inputClass} value={f.drugId} onChange={(e) => setF({ ...f, drugId: e.target.value })}>
          <option value="">Not set</option>
          {drugs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        First dose at age (days)
        <input type="number" min="0" inputMode="numeric" className={inputClass} value={f.firstAgeDays} onChange={(e) => setF({ ...f, firstAgeDays: e.target.value })} placeholder="now" />
      </label>
      <label>
        Then every (days)
        <input type="number" min="1" inputMode="numeric" className={inputClass} value={f.intervalDays} onChange={(e) => setF({ ...f, intervalDays: e.target.value })} required />
      </label>
      <p className="col-span-2 text-xs text-secondary-500">Every animal and group of this kind gets the dose on its due list. We text and email reminders 7, 3 and 1 days before.</p>
      <div className="col-span-2">
        <Btn disabled={f.name.trim().length < 2 || !f.intervalDays}>Add programme</Btn>
      </div>
    </form>
  );
}

function Health() {
  const [due, setDue] = useState<DueTask[] | null>(null);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [drugs, setDrugs] = useState<FarmDrug[]>([]);
  const [programmes, setProgrammes] = useState<FarmProgramme[]>([]);
  const [show, setShow] = useState<"" | "drug" | "programme">("");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [d, w, dr, p] = await Promise.all([
        apiGet<DueTask[]>("/farm/due?days=30"),
        apiGet<WithdrawalRow[]>("/farm/withdrawals"),
        apiGet<FarmDrug[]>("/farm/drugs"),
        apiGet<FarmProgramme[]>("/farm/programmes"),
      ]);
      setDue(d);
      setWithdrawals(w);
      setDrugs(dr);
      setProgrammes(p);
    } catch (err) {
      setError(errText(err, "Could not load"));
    }
  };
  useEffect(() => {
    void load();
  }, []);

  async function done(t: DueTask) {
    try {
      await apiPost(`/farm/due/${t.id}/done`, { date: todayKey() });
      await load();
    } catch (err) {
      setError(errText(err, "Could not tick it off"));
    }
  }
  async function retire(d: FarmDrug) {
    if (!window.confirm(`Remove ${d.name} from the list? Past treatments keep it.`)) return;
    await apiPost(`/farm/drugs/${d.id}/retire`, {}).then(load, (e) => setError(errText(e, "Could not remove it")));
  }
  async function stop(p: FarmProgramme) {
    if (!window.confirm(`Stop ${p.name}? Doses still waiting are cancelled.`)) return;
    await apiPost(`/farm/programmes/${p.id}/stop`, {}).then(load, (e) => setError(errText(e, "Could not stop it")));
  }

  const drugName = new Map(drugs.map((d) => [d.id, d.name]));
  const today = todayKey();
  const f = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "UTC" });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Health</h1>
      <ErrorBox error={error} />

      <Card title="Due in the next 30 days">
        {!due ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : due.length === 0 ? (
          <p className="text-sm text-secondary-500">Nothing due.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {due.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={linkFor(t)} className="min-w-0 flex-1">
                  <span className="block font-semibold" style={{ color: SHAMBA_INK }}>{t.title}</span>
                  <span className={`text-xs ${day(t.dueOn) < today ? "font-semibold text-red-700" : "text-secondary-500"}`}>
                    {TASK_KINDS[t.kind] ?? t.kind} · {day(t.dueOn) < today ? `overdue since ${f(day(t.dueOn))}` : day(t.dueOn) === today ? "today" : f(day(t.dueOn))}
                  </span>
                </Link>
                {t.programmeId ? (
                  <Link href={linkFor(t)} className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: SHAMBA_BRAND.navy, color: SHAMBA_INK }}>
                    Record dose
                  </Link>
                ) : (
                  <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: SHAMBA_BRAND.navy, color: SHAMBA_INK }} onClick={() => void done(t)}>
                    Done
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div id="withdrawals">
        <Card title="Not for sale (withdrawal)">
          {withdrawals.length === 0 ? (
            <p className="text-sm text-secondary-500">Nothing withheld - all milk, meat and eggs can be sold.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {withdrawals.map((w) => (
                <li key={w.eventId} className="py-2">
                  <Link href={linkFor(w)} className="font-semibold underline" style={{ color: SHAMBA_INK }}>
                    {w.label}
                  </Link>
                  <span className="block text-xs" style={{ color: "#7a3d00" }}>
                    {[w.milkUntil && `Milk until after ${f(w.milkUntil)}`, w.meatUntil && `Meat until after ${f(w.meatUntil)}`, w.eggUntil && `Eggs until after ${f(w.eggUntil)}`].filter(Boolean).join(" · ")}
                  </span>
                  <span className="block text-xs text-secondary-500">
                    {w.drug} on {f(w.treatedOn)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card
          title="Vaccination and deworming programmes"
          action={
            <button type="button" className="text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }} onClick={() => setShow(show === "programme" ? "" : "programme")}>
              {show === "programme" ? "Close" : "+ Add"}
            </button>
          }
        >
          {show === "programme" && (
            <div className="mb-3 rounded-xl bg-background p-3">
              <AddProgramme drugs={drugs} onDone={() => void load()} />
            </div>
          )}
          {programmes.length === 0 ? (
            <p className="text-sm text-secondary-500">No programmes yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {programmes.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{p.name}</strong> · {SPECIES[p.species]}
                    <span className="block text-xs text-secondary-500">
                      {[p.drugId && drugName.get(p.drugId), p.firstAgeDays !== null && `first at ${p.firstAgeDays} days old`, `every ${p.intervalDays} days`].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <button type="button" className="text-xs underline" onClick={() => void stop(p)}>
                    Stop
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Drugs and vaccines"
          action={
            <button type="button" className="text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }} onClick={() => setShow(show === "drug" ? "" : "drug")}>
              {show === "drug" ? "Close" : "+ Add"}
            </button>
          }
        >
          {show === "drug" && (
            <div className="mb-3 rounded-xl bg-background p-3">
              <AddDrug onDone={() => void load()} />
            </div>
          )}
          {drugs.length === 0 ? (
            <p className="text-sm text-secondary-500">No drugs yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {drugs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                  <span>
                    <strong>{d.name}</strong>
                    {d.prescriptionOnly && <span className="text-xs text-secondary-500"> · vet only</span>}
                    <span className="block text-xs text-secondary-500">
                      Withdrawal: milk {d.milkWithdrawalDays} d · meat {d.meatWithdrawalDays} d{d.eggWithdrawalDays ? ` · eggs ${d.eggWithdrawalDays} d` : ""}
                    </span>
                  </span>
                  <button type="button" className="text-xs underline" onClick={() => void retire(d)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

export default function ShambaHealthPage() {
  return <ShambaAppFrame>{() => <Health />}</ShambaAppFrame>;
}
