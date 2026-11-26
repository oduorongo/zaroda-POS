"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../../../../lib/api";
import { Card, ShambaAppFrame } from "../../../../components/shamba/frame";
import { SuggestedPriceCard } from "../../../../components/shamba/valuation";
import { ActionTabs, Btn, ErrorBox, HealthForm, HealthList, WeightForm, WithdrawalBanner, errText } from "../../../../components/shamba/livestock";
import {
  BREEDING_KINDS,
  EXIT_KINDS,
  SHAMBA_BRAND,
  SPECIES,
  TASK_KINDS,
  ageText,
  day,
  inputClass,
  todayKey,
  type DueTask,
  type FarmAnimal,
  type FarmUnit,
  type HealthEvent,
} from "../../../../lib/shamba";

type Ref = { id: string; tag: string; name: string | null };
interface AnimalDetail extends FarmAnimal {
  unitName: string | null;
  dam: Ref | null;
  sire: Ref | null;
  young: (Ref & { sex: string; birthDate: string | null; status: string })[];
  health: HealthEvent[];
  breeding: { id: string; date: string; kind: string; sireCode: string | null; inseminator: string | null; expectedBirth: string | null; notes: string | null; voidedAt: string | null; voidReason: string | null }[];
  weights: { id: string; date: string; kg: string; bodyCondition: string | null }[];
  due: DueTask[];
  statusNote: string | null;
  exitAmount: string | null;
  exitParty: string | null;
}

function BreedingForm({ a, onDone }: { a: AnimalDetail; onDone: () => void }) {
  const [f, setF] = useState({ date: todayKey(), kind: "AI", sireCode: "", inseminator: "", notes: "" });
  const [young, setYoung] = useState<{ tag: string; sex: string; name: string }[]>([{ tag: "", sex: "FEMALE", name: "" }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/breeding", {
        animalId: a.id,
        date: f.date,
        kind: f.kind,
        sireCode: f.sireCode || undefined,
        inseminator: f.inseminator || undefined,
        notes: f.notes || undefined,
        offspring: f.kind === "BIRTH" ? young.filter((y) => y.tag.trim()).map((y) => ({ tag: y.tag.trim(), sex: y.sex, name: y.name || undefined })) : undefined,
      });
      setYoung([{ tag: "", sex: "FEMALE", name: "" }]);
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2">
        <ErrorBox error={error} />
      </div>
      <label>
        What happened
        <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {Object.entries(BREEDING_KINDS).map(([k, l]) => (
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
      {(f.kind === "AI" || f.kind === "SERVED") && (
        <>
          <label>
            {f.kind === "AI" ? "Semen / bull code" : "Bull / buck"}
            <input className={inputClass} value={f.sireCode} onChange={(e) => setF({ ...f, sireCode: e.target.value })} />
          </label>
          {f.kind === "AI" && (
            <label>
              Inseminator
              <input className={inputClass} value={f.inseminator} onChange={(e) => setF({ ...f, inseminator: e.target.value })} />
            </label>
          )}
        </>
      )}
      {f.kind === "BIRTH" && (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="font-semibold">The young (each gets its own record)</legend>
          {young.map((y, i) => (
            <div key={i} className="grid grid-cols-3 gap-2">
              <input className={`${inputClass} mt-0`} placeholder="Tag" value={y.tag} onChange={(e) => setYoung(young.map((x, j) => (j === i ? { ...x, tag: e.target.value } : x)))} />
              <select className={`${inputClass} mt-0`} value={y.sex} onChange={(e) => setYoung(young.map((x, j) => (j === i ? { ...x, sex: e.target.value } : x)))}>
                <option value="FEMALE">Female</option>
                <option value="MALE">Male</option>
              </select>
              <input className={`${inputClass} mt-0`} placeholder="Name" value={y.name} onChange={(e) => setYoung(young.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </div>
          ))}
          <button type="button" className="text-xs underline" onClick={() => setYoung([...young, { tag: "", sex: "FEMALE", name: "" }])}>
            + Another (twins...)
          </button>
        </fieldset>
      )}
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

function MoveForm({ a, onDone }: { a: AnimalDetail; onDone: () => void }) {
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [unitId, setUnitId] = useState(a.unitId ?? "");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<FarmUnit[]>("/farm/units").then((u) => setUnits(u.filter((x) => x.active)), () => undefined);
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    try {
      await apiPatch(`/farm/animals/${a.id}`, { unitId });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not move it"));
    }
  }
  return (
    <form onSubmit={save} className="space-y-3 text-sm">
      <ErrorBox error={error} />
      <label className="block">
        Move to
        <select className={inputClass} value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
          <option value="">Choose...</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <Btn disabled={!unitId || unitId === a.unitId}>Move</Btn>
    </form>
  );
}

function ExitForm({ a, onDone }: { a: AnimalDetail; onDone: () => void }) {
  const [f, setF] = useState({ status: "SOLD", date: todayKey(), amount: "", party: "", permitNo: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!window.confirm(`Record ${a.tag} as ${EXIT_KINDS[f.status].toLowerCase()}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/farm/animals/${a.id}/exit`, { status: f.status, date: f.date, amount: f.amount ? Number(f.amount) : undefined, party: f.party || undefined, permitNo: f.permitNo || undefined, note: f.note || undefined });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not save"));
    } finally {
      setBusy(false);
    }
  }
  const paid = f.status === "SOLD" || f.status === "SLAUGHTERED";
  return (
    <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-2">
      <div className="sm:col-span-2">
        <ErrorBox error={error} />
      </div>
      <label>
        What happened
        <select className={inputClass} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          {Object.entries(EXIT_KINDS).map(([k, l]) => (
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
      {paid && (
        <>
          <label>
            Amount (KES)
            <input type="number" min="0" inputMode="decimal" className={inputClass} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          </label>
          <label>
            {f.status === "SOLD" ? "Buyer" : "Slaughterhouse"}
            <input className={inputClass} value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} />
          </label>
          <label>
            Movement permit no.
            <input className={inputClass} value={f.permitNo} onChange={(e) => setF({ ...f, permitNo: e.target.value })} />
          </label>
        </>
      )}
      <label className={paid ? "" : "sm:col-span-2"}>
        Note
        <input className={inputClass} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={f.status === "DIED" ? "Cause of death" : ""} />
      </label>
      <div className="sm:col-span-2">
        <Btn busy={busy} tone="navy">
          Record
        </Btn>
      </div>
    </form>
  );
}

function AnimalPage() {
  const { id } = useParams<{ id: string }>();
  const [a, setA] = useState<AnimalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiGet<AnimalDetail>(`/farm/animals/${id}`).then(setA, (e) => setError(errText(e, "Could not load the animal")));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!a) return error ? <ErrorBox error={error} /> : <p className="text-secondary-500">Loading...</p>;
  const active = a.status === "ACTIVE";
  const reload = () => void load();
  const lastWeight = a.weights[0];

  return (
    <div className="space-y-4">
      <Link href="/shamba/animals" className="text-sm underline">
        ← Animals
      </Link>
      <div>
        <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>
          {a.tag}
          {a.name && <span className="font-normal"> · {a.name}</span>}
        </h1>
        <p className="text-sm text-secondary-600">
          {[SPECIES[a.species], a.breed, a.sex === "FEMALE" ? "Female" : "Male", ageText(a.birthDate) && `${ageText(a.birthDate)} old`, a.unitName].filter(Boolean).join(" · ")}
        </p>
        {!active && (
          <p className="mt-1 text-sm font-semibold text-red-700">
            {a.status} on {day(a.statusDate)}
            {a.exitAmount && ` · KES ${Number(a.exitAmount).toLocaleString("en-KE")}`}
            {a.exitParty && ` · ${a.exitParty}`}
            {a.statusNote && ` · ${a.statusNote}`}
          </p>
        )}
      </div>

      <WithdrawalBanner w={a.withdrawal} />
      <ErrorBox error={error} />

      {active && (
        <ActionTabs
          tabs={[
            ["Health", <HealthForm key="h" target={{ animalId: a.id }} species={a.species} onDone={reload} />],
            ...(a.sex === "FEMALE" ? ([["Breeding", <BreedingForm key="b" a={a} onDone={reload} />]] as [string, React.ReactNode][]) : []),
            ["Weight", <WeightForm key="w" target={{ animalId: a.id }} onDone={reload} />],
            ["Move", <MoveForm key="m" a={a} onDone={reload} />],
            ["Sold / died", <ExitForm key="x" a={a} onDone={reload} />],
          ]}
        />
      )}

      {a.due.length > 0 && (
        <Card title="Coming up">
          <ul className="space-y-1 text-sm">
            {a.due.map((t) => (
              <li key={t.id} className="flex justify-between gap-2">
                <span>{TASK_KINDS[t.kind] ?? t.title}</span>
                <span className={day(t.dueOn) < todayKey() ? "font-semibold text-red-700" : "text-secondary-600"}>{day(t.dueOn)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <SuggestedPriceCard id={a.id} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Health">
          <HealthList events={a.health} onChanged={reload} />
        </Card>
        <div className="space-y-4">
          {a.sex === "FEMALE" && (
            <Card title="Breeding">
              {a.breeding.length === 0 ? (
                <p className="text-sm text-secondary-500">Nothing recorded yet.</p>
              ) : (
                <ul className="divide-y divide-secondary-100 text-sm">
                  {a.breeding.map((b) => (
                    <li key={b.id} className={`py-2 ${b.voidedAt ? "text-secondary-400 line-through" : ""}`}>
                      <strong>{BREEDING_KINDS[b.kind] ?? b.kind}</strong> · {day(b.date)}
                      <span className="block text-xs text-secondary-500">
                        {[b.sireCode, b.inseminator, b.expectedBirth && `Expected birth ${day(b.expectedBirth)}`, b.notes, b.voidReason && `Void: ${b.voidReason}`].filter(Boolean).join(" · ")}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          <Card title="Family">
            <ul className="space-y-1 text-sm">
              <li>
                Mother: {a.dam ? <Link className="underline" href={`/shamba/animals/${a.dam.id}`}>{a.dam.tag}</Link> : "—"}
              </li>
              <li>
                Father: {a.sire ? <Link className="underline" href={`/shamba/animals/${a.sire.id}`}>{a.sire.tag}</Link> : a.sireCode ?? "—"}
              </li>
              {a.young.length > 0 && (
                <li>
                  Young:{" "}
                  {a.young.map((y, i) => (
                    <span key={y.id}>
                      {i > 0 && ", "}
                      <Link className="underline" href={`/shamba/animals/${y.id}`}>
                        {y.tag}
                      </Link>
                    </span>
                  ))}
                </li>
              )}
            </ul>
          </Card>
          <Card title="Weights">
            {lastWeight ? (
              <ul className="space-y-1 text-sm">
                {a.weights.map((w) => (
                  <li key={w.id} className="flex justify-between">
                    <span>{day(w.date)}</span>
                    <span>
                      {Number(w.kg)} kg{w.bodyCondition && ` · BCS ${Number(w.bodyCondition)}`}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-secondary-500">No weights yet.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function ShambaAnimalPage() {
  return <ShambaAppFrame>{() => <AnimalPage />}</ShambaAppFrame>;
}
