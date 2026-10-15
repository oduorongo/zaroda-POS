"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiGet, apiPut, ApiError } from "../../lib/api";

interface Caretaker {
  id: string;
  fullName: string;
  email: string;
  propertyIds: string[];
}

interface PropertyOption {
  id: string;
  name: string;
}

const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";

/** Choose which properties each caretaker may work on. A caretaker with none ticked sees nothing. */
export function CaretakersSection({ properties }: { properties: PropertyOption[] }) {
  const [caretakers, setCaretakers] = useState<Caretaker[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Caretaker[]>("/rental/caretakers")
      .then(setCaretakers)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your caretakers."));
  }, []);

  async function save(c: Caretaker, propertyIds: string[]) {
    setBusyId(c.id);
    setError(null);
    setSavedId(null);
    try {
      setCaretakers(await apiPut<Caretaker[]>(`/rental/caretakers/${c.id}/properties`, { propertyIds }));
      setSavedId(c.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function toggle(c: Caretaker, propertyId: string) {
    const next = c.propertyIds.includes(propertyId) ? c.propertyIds.filter((id) => id !== propertyId) : [...c.propertyIds, propertyId];
    setCaretakers((list) => (list ?? []).map((x) => (x.id === c.id ? { ...x, propertyIds: next } : x)));
    setSavedId(null);
  }

  if (!caretakers) return error ? <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p> : <p className="text-sm text-secondary-500">Loading...</p>;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      <p className="text-sm text-secondary-500">
        A caretaker only sees and records rent, repairs and meter readings for the properties you tick here. Add caretakers on the{" "}
        <Link href="/staff" className="underline">Staff page</Link> (role CARETAKER). Starter includes 1 caretaker; Pay-as-you-collect includes up to 5.
      </p>
      {caretakers.length === 0 && <p className="rounded-lg border border-border bg-surface p-3 text-sm">You have no caretakers yet.</p>}
      {caretakers.map((c) => (
        <div key={c.id} className="rounded-lg border border-border bg-surface p-3">
          <p className="font-semibold">{c.fullName}</p>
          <p className="text-xs text-secondary-500">{c.email}</p>
          {c.propertyIds.length === 0 && <p className="mt-2 text-xs text-amber-400">No properties ticked yet, so this caretaker cannot see anything.</p>}
          <div className="mt-2 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {properties.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={c.propertyIds.includes(p.id)} onChange={() => toggle(c, p.id)} />
                {p.name}
              </label>
            ))}
            {properties.length === 0 && <p className="text-sm text-secondary-500">Add a property first.</p>}
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button className={button} disabled={busyId === c.id} onClick={() => void save(c, c.propertyIds)}>Save</button>
            {savedId === c.id && <span className="text-xs text-green-400">Saved.</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
