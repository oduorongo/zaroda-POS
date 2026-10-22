"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Row {
  variantId: string;
  title: string;
  sku: string;
  category: string | null;
  price: number;
  schoolPrice: number | null;
  onSchoolList: boolean;
  cost: number | null;
  taxRate: number;
}
interface Edit {
  onSchoolList: boolean;
  schoolPrice: string; // "" = the normal price
}

const field = "rounded-md border border-border bg-surface p-1.5 text-sm";
const PAGE = 500;

/** Which products schools can order, and what they pay. Anything left blank uses the normal price. */
export default function SchoolPricesPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [search, setSearch] = useState("");
  const [onlyListed, setOnlyListed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      setRows(await apiGet<Row[]>("/school-supplier/price-list"));
      setEdits({});
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your products.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const current = (r: Row): Edit => edits[r.variantId] ?? { onSchoolList: r.onSchoolList, schoolPrice: r.schoolPrice === null ? "" : String(r.schoolPrice) };
  const change = (r: Row, patch: Partial<Edit>) => setEdits((e) => ({ ...e, [r.variantId]: { ...current(r), ...patch } }));

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!q || r.title.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q) || (r.category ?? "").toLowerCase().includes(q)) && (!onlyListed || current(r).onSchoolList));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, search, onlyListed, edits]);

  const dirty = Object.keys(edits).length;
  const listedCount = (rows ?? []).filter((r) => current(r).onSchoolList).length;

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const entries = Object.entries(edits).map(([variantId, e]) => ({
        variantId,
        onSchoolList: e.onSchoolList,
        schoolPrice: e.schoolPrice.trim() === "" ? null : Number(e.schoolPrice),
      }));
      for (let i = 0; i < entries.length; i += 400) await apiPut("/school-supplier/price-list", { entries: entries.slice(i, i + 400) });
      setNotice(`Saved ${entries.length} ${entries.length === 1 ? "change" : "changes"}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  function listAllShown() {
    for (const r of shown.slice(0, PAGE)) if (!current(r).onSchoolList) change(r, { onSchoolList: true });
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">School price list</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/schools" className="text-primary-600 hover:underline">Schools</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">
          Tick the products schools may order. Type a school price if it is different from your counter price; leave it empty to use the normal price. Prices are before VAT. Schools only see this list after they sign in.
        </p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex-1 text-sm">
            Find a product
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, code or category" className={`${field} mt-1 w-full`} />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={onlyListed} onChange={(e) => setOnlyListed(e.target.checked)} />
            Only the ones on the list ({listedCount})
          </label>
          {canEdit && (
            <button onClick={listAllShown} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary-500/10">
              Put all shown on the list
            </button>
          )}
        </div>

        {!rows && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {rows && rows.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">You have no products yet. Add them on the Products screen first.</p>}

        {shown.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-secondary-500">
                  <th className="p-2">On list</th>
                  <th className="p-2">Product</th>
                  <th className="p-2 text-right">Counter price</th>
                  <th className="p-2 text-right">School price</th>
                  <th className="p-2 text-right">VAT</th>
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, PAGE).map((r) => {
                  const c = current(r);
                  return (
                    <tr key={r.variantId} className={`border-t border-border ${edits[r.variantId] ? "bg-primary-600/5" : ""}`}>
                      <td className="p-2">
                        <input type="checkbox" disabled={!canEdit} checked={c.onSchoolList} onChange={(e) => change(r, { onSchoolList: e.target.checked })} />
                      </td>
                      <td className="p-2">
                        {r.title}
                        <span className="block text-xs text-secondary-500">
                          {r.sku}
                          {r.category ? ` · ${r.category}` : ""}
                        </span>
                      </td>
                      <td className="p-2 text-right font-mono">{r.price.toFixed(2)}</td>
                      <td className="p-2 text-right">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          disabled={!canEdit}
                          value={c.schoolPrice}
                          onChange={(e) => change(r, { schoolPrice: e.target.value })}
                          placeholder={r.price.toFixed(2)}
                          className={`${field} w-28 text-right`}
                        />
                      </td>
                      <td className="p-2 text-right text-xs text-secondary-500">{r.taxRate ? `${Math.round(r.taxRate * 100)}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {shown.length > PAGE && <p className="text-xs text-secondary-500">Showing the first {PAGE} of {shown.length}. Search to narrow it down.</p>}

        {canEdit && (
          <div className="sticky bottom-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 shadow-lg">
            <span className="text-sm text-secondary-500">{dirty === 0 ? "No changes yet." : `${dirty} unsaved ${dirty === 1 ? "change" : "changes"}.`}</span>
            <button disabled={busy || dirty === 0} onClick={() => void save()} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
              {busy ? "Saving..." : "Save changes"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
