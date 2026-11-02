"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../lib/api";
import { getSession } from "../../../lib/auth";
import { errorText, kes } from "../../../lib/construction";
import { ConShell } from "../../../components/construction/con-shell";
import { ErrorBox, Field, Panel, PrimaryButton, inputClass } from "../../../components/construction/ui";

interface Variant { id: string; sku: string; cost: string | null; quantityMode: "COUNT" | "WEIGHT" }
interface Material { id: string; name: string; baseUnit: string | null; isActive: boolean; category: { id: string; name: string } | null; variants: Variant[] }
interface Category { id: string; name: string }

// Units measured in parts (2.5 tonnes) need fractional quantities; the rest are whole counts.
const UNITS: { unit: string; fractional: boolean }[] = [
  { unit: "bag", fractional: false },
  { unit: "tonne", fractional: true },
  { unit: "m³", fractional: true },
  { unit: "m²", fractional: true },
  { unit: "m", fractional: true },
  { unit: "kg", fractional: true },
  { unit: "litre", fractional: true },
  { unit: "piece", fractional: false },
  { unit: "length", fractional: false },
  { unit: "sheet", fractional: false },
  { unit: "roll", fractional: false },
  { unit: "lorry trip", fractional: false },
];
const codeFrom = (name: string) => `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 16) || "MAT"}-${Math.floor(100 + Math.random() * 900)}`;
const blank = { name: "", unit: "bag", cost: "", categoryId: "" };

/** What the business buys and uses on site (cement, sand, steel...). Kept in the shared catalogue so LPOs and site stock use the same items. */
export default function MaterialsPage() {
  return (
    <ConShell title="Materials">
      <Materials />
    </ConShell>
  );
}

function Materials() {
  const canEdit = ["OWNER", "MANAGER"].includes(getSession()?.role ?? "");
  const [items, setItems] = useState<Material[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, c] = await Promise.all([apiGet<Material[]>("/products"), apiGet<Category[]>("/categories").catch(() => [])]);
      setItems(m);
      setCategories(c);
    } catch (e) {
      setError(errorText(e, "Could not load materials."));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter((m) => m.name.toLowerCase().includes(q) || m.category?.name.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(errorText(e, "That did not work."));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = () =>
    run(async () => {
      const unit = UNITS.find((u) => u.unit === form.unit)!;
      const product = await apiPost<{ id: string }>("/products", { name: form.name.trim(), baseUnit: unit.unit, categoryId: form.categoryId || undefined });
      await apiPost(`/products/${product.id}/variants`, { sku: codeFrom(form.name), price: 0, cost: form.cost ? Number(form.cost) : undefined, quantityMode: unit.fractional ? "WEIGHT" : "COUNT" });
    }).then((ok) => ok && setForm(blank));

  const setCost = (m: Material) => {
    const v = m.variants[0];
    if (!v) return;
    const input = prompt(`Buying price per ${m.baseUnit ?? "unit"} of ${m.name} (KES)`, v.cost ?? "");
    if (input === null) return;
    const n = Number(input.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) return setError("Enter a price in KES, e.g. 850");
    void run(() => apiPatch(`/products/${m.id}/variants/${v.id}`, { cost: n }));
  };

  return (
    <div className="space-y-4">
      <ErrorBox message={error} />
      {canEdit && (
        <Panel title="Add a material">
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Name">
              <input className={inputClass} value={form.name} placeholder="e.g. Cement 50kg" onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="Unit">
              <select className={inputClass} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}>
                {UNITS.map((u) => <option key={u.unit}>{u.unit}</option>)}
              </select>
            </Field>
            <Field label="Buying price per unit (KES)">
              <input className={inputClass} inputMode="decimal" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
            </Field>
            <Field label="Group">
              <select className={inputClass} value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                <option value="">None</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3">
            <PrimaryButton disabled={busy || !form.name.trim()} onClick={add}>{busy ? "Saving..." : "Add material"}</PrimaryButton>
          </div>
        </Panel>
      )}

      <Panel title={`Materials (${items.length})`}>
        <input className={`${inputClass} mb-3`} placeholder="Search materials" value={search} onChange={(e) => setSearch(e.target.value)} />
        {shown.length === 0 && <p className="text-sm text-secondary-500">{items.length ? "Nothing matches that." : "No materials yet. Add cement, sand, ballast, steel and the rest you buy."}</p>}
        <ul className="divide-y divide-border text-sm">
          {shown.map((m) => {
            const cost = m.variants[0]?.cost;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <p className="font-semibold">{m.name}</p>
                  <p className="text-xs text-secondary-500">per {m.baseUnit ?? "unit"}{m.category ? ` · ${m.category.name}` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  {canEdit ? (
                    <button type="button" className="underline decoration-dotted" onClick={() => setCost(m)}>{cost === null || cost === undefined ? "Set price" : kes(Number(cost))}</button>
                  ) : (
                    <span>{cost === null || cost === undefined ? "-" : kes(Number(cost))}</span>
                  )}
                  {canEdit && (
                    <button type="button" className="text-xs text-red-700" onClick={() => confirm(`Remove ${m.name}? It is kept in past records.`) && run(() => apiDelete(`/products/${m.id}`))}>
                      Remove
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
