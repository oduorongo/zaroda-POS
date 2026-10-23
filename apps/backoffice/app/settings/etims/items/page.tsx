"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, apiPut, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";

type State = "NEEDS_SETUP" | "READY" | "REGISTERED" | "NEEDS_UPDATE" | "REJECTED";
interface Row {
  variantId: string;
  sku: string;
  name: string;
  price: number;
  barcode: string | null;
  taxClass: { name: string; percent: number; isExempt: boolean } | null;
  itemClsCd: string | null;
  itemTyCd: string;
  pkgUnitCd: string;
  qtyUnitCd: string;
  taxTyCd: string | null;
  taxTyOverridden: boolean;
  itemCd: string | null;
  state: State;
  problems: string[];
  lastError: string | null;
}
interface Listing {
  counts: Record<State, number>;
  total: number;
  page: number;
  pageSize: number;
  listsDownloaded: boolean;
  rows: Row[];
}
interface ItemClass {
  itemClsCd: string;
  itemClsNm: string;
  taxTyCd: string | null;
}
interface CodeGroup {
  cdCls: string;
  codes: { cd: string; cdNm: string }[];
}
interface RegisterResult {
  sent: number;
  skipped: number;
  failed: { variantId: string; name: string; message: string }[];
  remaining: number;
  stopped: string | null;
}

const LABEL: Record<State, string> = { NEEDS_SETUP: "Needs setting up", READY: "Ready to send", REGISTERED: "With KRA", NEEDS_UPDATE: "Changed - needs sending again", REJECTED: "KRA refused" };
const TONE: Record<State, string> = { NEEDS_SETUP: "bg-amber-950 text-amber-200", READY: "bg-blue-950 text-blue-200", REGISTERED: "bg-green-950 text-green-300", NEEDS_UPDATE: "bg-amber-950 text-amber-200", REJECTED: "bg-red-950 text-red-300" };
const TABS: (State | "ALL")[] = ["ALL", "NEEDS_SETUP", "READY", "REGISTERED", "NEEDS_UPDATE", "REJECTED"];
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const explain = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Every product option and where it stands with KRA: choose its classification, check the tax type and units, and send it. */
export default function EtimsItemsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Listing | null>(null);
  const [tab, setTab] = useState<State | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<Row | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [codes, setCodes] = useState<CodeGroup[]>([]);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page) });
      if (tab !== "ALL") q.set("state", tab);
      if (search.trim()) q.set("search", search.trim());
      setData(await apiGet<Listing>(`/etims/items?${q.toString()}`));
      setError(null);
    } catch (e) {
      setError(explain(e, "Could not load the products."));
    }
  }, [tab, search, page]);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
    apiGet<CodeGroup[]>("/etims/codes").then(setCodes).catch(() => setCodes([]));
  }, [router]);
  useEffect(() => {
    if (!session) return;
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [session, load]);

  async function send(body: { variantIds?: string[]; all?: boolean }) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await apiPost<RegisterResult>("/etims/items/register", body);
      const parts = [`${r.sent} sent to KRA`];
      if (r.skipped) parts.push(`${r.skipped} already there`);
      if (r.failed.length) parts.push(`${r.failed.length} not sent`);
      if (r.remaining) parts.push(`${r.remaining} still to send - press the button again`);
      setNotice(`${parts.join(", ")}.`);
      if (r.stopped) setError(r.stopped);
      else if (r.failed.length) setError(r.failed.slice(0, 3).map((f) => `${f.name}: ${f.message}`).join(" | "));
      setPicked([]);
      await load();
    } catch (e) {
      setError(explain(e, "Could not send the products."));
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;
  const canWrite = session.role === "MANAGER" || session.role === "OWNER";
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const sendable = data ? data.counts.READY + data.counts.NEEDS_UPDATE : 0;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Products and KRA</h1>
          <Link href="/settings/etims" className={ghost}>eTIMS connection</Link>
        </div>
        <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Every product has to be registered with KRA before it can be sold on an eTIMS receipt. This only registers them with KRA&apos;s <strong>test</strong> system; your sales are not sent yet.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {data && !data.listsDownloaded && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">KRA&apos;s lists are not downloaded yet. Go to the eTIMS connection page and press &quot;Update from KRA&quot; first.</p>}

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button key={t} onClick={() => { setTab(t); setPage(1); }} className={`rounded-md border px-3 py-1.5 text-sm ${t === tab ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
              {t === "ALL" ? "All" : LABEL[t]}
              {data && t !== "ALL" ? ` (${data.counts[t]})` : ""}
            </button>
          ))}
          <input className="rounded-md border border-border bg-surface p-2 text-sm" placeholder="Search name, code, barcode" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button className={ghost} disabled={picked.length === 0 || busy} onClick={() => setClassifying(true)}>Set KRA classification for {picked.length || "the ticked"}</button>
            <button className={ghost} disabled={picked.length === 0 || busy} onClick={() => void send({ variantIds: picked })}>Send {picked.length || "the ticked"} to KRA</button>
            <button className={primary} disabled={sendable === 0 || busy} onClick={() => void send({ all: true })}>{busy ? "Sending..." : `Send everything ready (${sendable})`}</button>
          </div>
        )}

        {data && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-secondary-500">
                <tr>
                  {canWrite && <th className="p-2"></th>}
                  <th className="p-2">Product</th>
                  <th className="p-2 text-right">Price</th>
                  <th className="p-2">Tax</th>
                  <th className="p-2">KRA class</th>
                  <th className="p-2">Unit</th>
                  <th className="p-2">Status</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.variantId} className="border-t border-border align-top">
                    {canWrite && <td className="p-2"><input type="checkbox" checked={picked.includes(r.variantId)} onChange={() => toggle(r.variantId)} /></td>}
                    <td className="p-2">{r.name}<span className="block font-mono text-xs text-secondary-500">{r.sku}{r.itemCd ? ` · ${r.itemCd}` : ""}</span></td>
                    <td className="p-2 text-right font-mono">{kes(r.price)}</td>
                    <td className="p-2">{r.taxClass ? `${r.taxClass.isExempt ? "Exempt" : `${r.taxClass.percent}%`}` : "None"}<span className="block text-xs text-secondary-500">KRA type {r.taxTyCd ?? "?"}{r.taxTyOverridden ? " (set by hand)" : ""}</span></td>
                    <td className="p-2 font-mono text-xs">{r.itemClsCd ?? <span className="text-amber-500">not chosen</span>}</td>
                    <td className="p-2 text-xs">{r.qtyUnitCd} / {r.pkgUnitCd}</td>
                    <td className="p-2">
                      <span className={`rounded px-2 py-0.5 text-xs ${TONE[r.state]}`}>{LABEL[r.state]}</span>
                      {r.state === "NEEDS_SETUP" && r.problems.map((p) => <span key={p} className="mt-1 block text-xs text-amber-500">{p}</span>)}
                      {r.state === "REJECTED" && r.lastError && <span className="mt-1 block text-xs text-red-300">{r.lastError}</span>}
                    </td>
                    <td className="p-2 text-right">{canWrite && <button className="text-xs text-primary-400 hover:underline" onClick={() => setEditing(r)}>Edit</button>}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && <tr><td className="p-3 text-secondary-500" colSpan={8}>No products here.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {data && pages > 1 && (
          <div className="flex items-center justify-center gap-3 text-sm">
            <button className={ghost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Back</button>
            <span>Page {page} of {pages}</span>
            <button className={ghost} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        )}

        {editing && <EditModal row={editing} codes={codes} onClose={() => setEditing(null)} onDone={() => { setEditing(null); setNotice("Saved."); void load(); }} />}
        {classifying && <ClassifyModal count={picked.length} ids={picked} onClose={() => setClassifying(false)} onDone={(n) => { setClassifying(false); setNotice(`Classification set for ${n} products.`); void load(); }} />}
      </main>
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/60 p-4">
      <div className="my-6 w-full max-w-lg space-y-3 rounded-xl border border-border bg-background p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-sm text-secondary-500 hover:text-foreground">Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Search KRA's classification list and pick one. */
function ClassPicker({ value, onPick }: { value: string; onPick: (c: ItemClass) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<ItemClass[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setFound([]);
    const t = setTimeout(() => apiGet<ItemClass[]>(`/etims/item-classes?search=${encodeURIComponent(q.trim())}&limit=20`).then(setFound).catch(() => setFound([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      <label className="block text-sm">KRA product classification {value && <span className="font-mono text-xs text-secondary-500">(now {value})</span>}
        <input className={field} placeholder="Type what it is: flour, soft drink, accommodation..." value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      {found.length > 0 && (
        <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {found.map((c) => (
            <li key={c.itemClsCd}><button type="button" className="block w-full p-2 text-left text-sm hover:bg-secondary-500/10" onClick={() => { onPick(c); setQ(""); setFound([]); }}>{c.itemClsNm} <span className="font-mono text-xs text-secondary-500">{c.itemClsCd}{c.taxTyCd ? ` · usually tax ${c.taxTyCd}` : ""}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditModal({ row, codes, onClose, onDone }: { row: Row; codes: CodeGroup[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ itemClsCd: row.itemClsCd ?? "", itemTyCd: row.itemTyCd, pkgUnitCd: row.pkgUnitCd, qtyUnitCd: row.qtyUnitCd, taxTyCd: row.taxTyOverridden ? (row.taxTyCd ?? "") : "" });
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = (cls: string) => codes.find((g) => g.cdCls === cls)?.codes ?? [];
  const select = (label: string, value: string, onChange: (v: string) => void, options: { cd: string; cdNm: string }[], blank?: string) => (
    <label className="block text-sm">{label}
      <select className={field} value={value} onChange={(e) => onChange(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {!options.some((o) => o.cd === value) && value && <option value={value}>{value}</option>}
        {options.map((o) => <option key={o.cd} value={o.cd}>{o.cd} - {o.cdNm}</option>)}
      </select>
    </label>
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPut(`/etims/items/${row.variantId}`, { itemClsCd: f.itemClsCd || undefined, itemTyCd: f.itemTyCd, pkgUnitCd: f.pkgUnitCd, qtyUnitCd: f.qtyUnitCd, taxTyCd: f.taxTyCd || null });
      onDone();
    } catch (e) {
      setError(explain(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={row.name} onClose={onClose}>
      {error && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      <ClassPicker value={f.itemClsCd} onPick={(c) => { setF({ ...f, itemClsCd: c.itemClsCd }); setPicked(c.itemClsNm); }} />
      {picked && <p className="text-sm text-green-500">Chosen: {picked}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        {select("What it is", f.itemTyCd, (v) => setF({ ...f, itemTyCd: v }), list("24"))}
        {select("Quantity unit", f.qtyUnitCd, (v) => setF({ ...f, qtyUnitCd: v }), list("10"))}
        {select("Packaging unit", f.pkgUnitCd, (v) => setF({ ...f, pkgUnitCd: v }), list("17"))}
        {select("KRA tax type", f.taxTyCd, (v) => setF({ ...f, taxTyCd: v }), list("04"), `From the tax class (${row.taxTyCd ?? "?"})`)}
      </div>
      <p className="text-xs text-secondary-500">The tax type is worked out from the product&apos;s tax class. Only change it here if KRA says this product is a different kind (for example non-VAT). The item code KRA keeps it under is made when it is first sent and never changes.</p>
      <button className={primary} disabled={busy} onClick={() => void save()}>{busy ? "Saving..." : "Save"}</button>
    </Modal>
  );
}

function ClassifyModal({ count, ids, onClose, onDone }: { count: number; ids: string[]; onClose: () => void; onDone: (n: number) => void }) {
  const [chosen, setChosen] = useState<ItemClass | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!chosen) return;
    setBusy(true);
    try {
      const r = await apiPost<{ updated: number }>("/etims/items/classify", { variantIds: ids, itemClsCd: chosen.itemClsCd });
      onDone(r.updated);
    } catch (e) {
      setError(explain(e, "Could not save."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Classify ${count} products`} onClose={onClose}>
      {error && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{error}</p>}
      <p className="text-sm text-secondary-500">Give all the ticked products the same KRA classification (good for a whole shelf of the same kind of thing).</p>
      <ClassPicker value={chosen?.itemClsCd ?? ""} onPick={setChosen} />
      {chosen && <p className="text-sm text-green-500">Chosen: {chosen.itemClsNm}</p>}
      <button className={primary} disabled={busy || !chosen} onClick={() => void save()}>{busy ? "Saving..." : "Set it for all"}</button>
    </Modal>
  );
}
