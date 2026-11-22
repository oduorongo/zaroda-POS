"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, WithdrawalBadge, errText } from "../../../components/shamba/livestock";
import { BREEDS, SHAMBA_BRAND, SPECIES, ageText, inputClass, todayKey, type FarmAnimal, type FarmGroup, type FarmUnit } from "../../../lib/shamba";

const GROUP_FIRST = ["CHICKEN", "DUCK", "TURKEY", "FISH", "BEE"];

function AddAnimal({ units, onDone }: { units: FarmUnit[]; onDone: () => void }) {
  const [f, setF] = useState({ tag: "", name: "", species: "CATTLE", breed: "", sex: "FEMALE", birthDate: "", source: "BOUGHT", boughtOn: "", boughtPrice: "", unitId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/animals", {
        tag: f.tag.trim(),
        name: f.name || undefined,
        species: f.species,
        breed: f.breed || undefined,
        sex: f.sex,
        birthDate: f.birthDate || undefined,
        source: f.source,
        boughtOn: f.source === "BOUGHT" && f.boughtOn ? f.boughtOn : undefined,
        boughtPrice: f.source === "BOUGHT" && f.boughtPrice ? Number(f.boughtPrice) : undefined,
        unitId: f.unitId || undefined,
      });
      setF({ ...f, tag: "", name: "", birthDate: "", boughtOn: "", boughtPrice: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not add the animal"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="sm:col-span-3">
        <ErrorBox error={error} />
      </div>
      <label>
        Ear tag / number
        <input className={inputClass} value={f.tag} onChange={(e) => setF({ ...f, tag: e.target.value })} placeholder="e.g. KC010" required />
      </label>
      <label>
        Name
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
      </label>
      <label>
        Kind
        <select className={inputClass} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value, breed: "" })}>
          {Object.entries(SPECIES)
            .filter(([k]) => !GROUP_FIRST.includes(k))
            .map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
        </select>
      </label>
      <label>
        Breed
        <input className={inputClass} list="breeds" value={f.breed} onChange={(e) => setF({ ...f, breed: e.target.value })} />
        <datalist id="breeds">
          {(BREEDS[f.species] ?? []).map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <label>
        Sex
        <select className={inputClass} value={f.sex} onChange={(e) => setF({ ...f, sex: e.target.value })}>
          <option value="FEMALE">Female</option>
          <option value="MALE">Male</option>
        </select>
      </label>
      <label>
        Born on
        <input type="date" className={inputClass} value={f.birthDate} max={todayKey()} onChange={(e) => setF({ ...f, birthDate: e.target.value })} />
      </label>
      <label>
        Came from
        <select className={inputClass} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
          <option value="BOUGHT">Bought</option>
          <option value="BORN">Born here</option>
        </select>
      </label>
      {f.source === "BOUGHT" && (
        <>
          <label>
            Bought on
            <input type="date" className={inputClass} value={f.boughtOn} max={todayKey()} onChange={(e) => setF({ ...f, boughtOn: e.target.value })} />
          </label>
          <label>
            Price (KES)
            <input type="number" min="0" inputMode="decimal" className={inputClass} value={f.boughtPrice} onChange={(e) => setF({ ...f, boughtPrice: e.target.value })} />
          </label>
        </>
      )}
      <label className="sm:col-span-2">
        Kept in
        <select className={inputClass} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">Not set</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-3">
        <Btn busy={busy} disabled={!f.tag.trim()}>
          Add animal
        </Btn>
      </div>
    </form>
  );
}

function AddGroup({ units, onDone }: { units: FarmUnit[]; onDone: () => void }) {
  const [f, setF] = useState({ species: "CHICKEN", name: "", breed: "", purpose: "", placedOn: todayKey(), headCount: "", unitId: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/groups", { ...f, breed: f.breed || undefined, purpose: f.purpose || undefined, unitId: f.unitId || undefined, headCount: Number(f.headCount) });
      setF({ ...f, name: "", headCount: "" });
      onDone();
    } catch (err) {
      setError(errText(err, "Could not add the group"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="grid gap-3 text-sm sm:grid-cols-3">
      <div className="sm:col-span-3">
        <ErrorBox error={error} />
      </div>
      <label>
        Kind
        <select className={inputClass} value={f.species} onChange={(e) => setF({ ...f, species: e.target.value, breed: "" })}>
          {Object.entries(SPECIES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        Group name
        <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Layers flock 2" required />
      </label>
      <label>
        Breed
        <input className={inputClass} list="group-breeds" value={f.breed} onChange={(e) => setF({ ...f, breed: e.target.value })} />
        <datalist id="group-breeds">
          {(BREEDS[f.species] ?? []).map((b) => (
            <option key={b} value={b} />
          ))}
        </datalist>
      </label>
      <label>
        How many
        <input type="number" min="0" inputMode="numeric" className={inputClass} value={f.headCount} onChange={(e) => setF({ ...f, headCount: e.target.value })} required />
      </label>
      <label>
        Placed on
        <input type="date" className={inputClass} value={f.placedOn} max={todayKey()} onChange={(e) => setF({ ...f, placedOn: e.target.value })} required />
      </label>
      <label>
        Purpose
        <input className={inputClass} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="Eggs, meat, fattening..." />
      </label>
      <label className="sm:col-span-2">
        Kept in
        <select className={inputClass} value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>
          <option value="">Not set</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <div className="sm:col-span-3">
        <Btn busy={busy} disabled={f.name.trim().length < 2 || f.headCount === ""}>
          Add group
        </Btn>
      </div>
    </form>
  );
}

function Animals() {
  const [tab, setTab] = useState<"animals" | "groups">("animals");
  const [animals, setAnimals] = useState<FarmAnimal[] | null>(null);
  const [groups, setGroups] = useState<FarmGroup[] | null>(null);
  const [units, setUnits] = useState<FarmUnit[]>([]);
  const [search, setSearch] = useState("");
  const [species, setSpecies] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const q = new URLSearchParams({ status, ...(species ? { species } : {}), ...(search.trim() ? { search: search.trim() } : {}) });
      const [a, g, u] = await Promise.all([apiGet<FarmAnimal[]>(`/farm/animals?${q}`), apiGet<FarmGroup[]>(`/farm/groups${status === "ACTIVE" ? "" : "?closed=1"}`), apiGet<FarmUnit[]>("/farm/units")]);
      setAnimals(a);
      setGroups(g);
      setUnits(u.filter((x) => x.active));
    } catch (err) {
      setError(errText(err, "Could not load the animals"));
    }
  };
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, species, status]);

  const unitName = new Map(units.map((u) => [u.id, u.name]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Animals</h1>
        <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-white" style={{ background: SHAMBA_BRAND.orange }} onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : tab === "animals" ? "+ Add animal" : "+ Add group"}
        </button>
      </div>
      <ErrorBox error={error} />

      <div className="flex gap-2">
        {(["animals", "groups"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTab(t);
              setAdding(false);
            }}
            className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold sm:flex-none"
            style={tab === t ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { color: SHAMBA_BRAND.navy, borderColor: "#cbd5e1", background: "white" }}
          >
            {t === "animals" ? `One by one (${animals?.length ?? 0})` : `Groups and flocks (${groups?.length ?? 0})`}
          </button>
        ))}
      </div>

      {adding && <Card title={tab === "animals" ? "Add an animal" : "Add a group or flock"}>{tab === "animals" ? <AddAnimal units={units} onDone={() => void load()} /> : <AddGroup units={units} onDone={() => void load()} />}</Card>}

      {tab === "animals" ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <input className={`${inputClass} col-span-2 mt-0`} placeholder="Search tag or name" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className={`${inputClass} mt-0`} value={species} onChange={(e) => setSpecies(e.target.value)}>
              <option value="">All kinds</option>
              {Object.entries(SPECIES)
                .filter(([k]) => !GROUP_FIRST.includes(k))
                .map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
            </select>
            <select className={`${inputClass} mt-0`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ACTIVE">On the farm</option>
              <option value="ALL">All, incl. sold/dead</option>
            </select>
          </div>
          {!animals ? (
            <p className="text-sm text-secondary-500">Loading...</p>
          ) : animals.length === 0 ? (
            <p className="text-sm text-secondary-500">No animals yet. Add your cows, goats, pigs... one by one with their ear tag.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {animals.map((a) => (
                <li key={a.id}>
                  <Link href={`/shamba/animals/${a.id}`} className="block rounded-xl border border-secondary-200 bg-white p-3 shadow-sm hover:border-secondary-400">
                    <div className="flex items-center justify-between gap-2">
                      <strong style={{ color: SHAMBA_BRAND.navy }}>
                        {a.tag}
                        {a.name && <span className="font-normal text-secondary-600"> · {a.name}</span>}
                      </strong>
                      <WithdrawalBadge w={a.withdrawal} />
                    </div>
                    <span className="block text-xs text-secondary-500">
                      {[SPECIES[a.species], a.breed, a.sex === "FEMALE" ? "Female" : "Male", ageText(a.birthDate), a.unitId && unitName.get(a.unitId)].filter(Boolean).join(" · ")}
                    </span>
                    {a.status !== "ACTIVE" && <span className="text-xs font-semibold text-red-700">{a.status}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : !groups ? (
        <p className="text-sm text-secondary-500">Loading...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-secondary-500">No groups yet. Poultry flocks, fish ponds and hives are kept as groups with a head count.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/shamba/groups/${g.id}`} className={`block rounded-xl border border-secondary-200 bg-white p-3 shadow-sm hover:border-secondary-400 ${g.active ? "" : "opacity-60"}`}>
                <div className="flex items-center justify-between gap-2">
                  <strong style={{ color: SHAMBA_BRAND.navy }}>{g.name}</strong>
                  <WithdrawalBadge w={g.withdrawal} />
                </div>
                <span className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>{g.headCount.toLocaleString("en-KE")}</span>
                <span className="block text-xs text-secondary-500">{[SPECIES[g.species], g.breed, `${ageText(g.placedOn)} since placed`, g.unitId && unitName.get(g.unitId), !g.active && "Closed"].filter(Boolean).join(" · ")}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ShambaAnimalsPage() {
  return <ShambaAppFrame>{() => <Animals />}</ShambaAppFrame>;
}
