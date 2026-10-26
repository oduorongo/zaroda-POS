"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

type Status = "IDENTIFIED" | "PREPARING" | "SUBMITTED" | "WON" | "LOST" | "WITHDRAWN" | "CANCELLED";
interface Bid {
  cost: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  margin: number;
  marginPercent: number;
}
interface Tender {
  id: string;
  tenderNumber: string;
  entityName: string;
  title: string;
  status: Status;
  school: { id: string; name: string } | null;
  closingDate: string | null;
  submittedOn: string | null;
  submitOverride: string | null;
  outcomeNote: string | null;
  notes: string | null;
  contract: { id: string; contractNumber: string } | null;
  checklist: { id: string; title: string; done: boolean }[];
  lines: { id: string; variantId: string | null; description: string; quantity: number; unitCost: number; unitPrice: number; taxRate: number }[];
  bid: Bid;
}
interface Doc {
  id: string;
  name: string;
  reference: string | null;
  issuedOn: string | null;
  expiryDate: string | null;
  notes: string | null;
  state: "OK" | "EXPIRING" | "EXPIRED" | "NO_EXPIRY";
}
interface Readiness {
  closed: boolean;
  blockers: string[];
  warnings: string[];
}
interface School {
  id: string;
  name: string;
}
interface PriceRow {
  variantId: string;
  title: string;
  sku: string;
  price: number;
  schoolPrice: number | null;
  cost: number | null;
  taxRate: number;
}
interface BidLine {
  variantId: string | null;
  description: string;
  quantity: string;
  unitCost: string;
  unitPrice: string;
  taxRate: number;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const LABEL: Record<Status, string> = { IDENTIFIED: "Spotted", PREPARING: "Preparing", SUBMITTED: "Submitted", WON: "Won", LOST: "Lost", WITHDRAWN: "Withdrawn", CANCELLED: "Cancelled" };
const TONE: Record<Status, string> = {
  IDENTIFIED: "bg-secondary-500/20 text-secondary-500",
  PREPARING: "bg-amber-900 text-amber-200",
  SUBMITTED: "bg-blue-900 text-blue-200",
  WON: "bg-green-900 text-green-200",
  LOST: "bg-red-950 text-red-300",
  WITHDRAWN: "bg-secondary-500/20 text-secondary-500",
  CANCELLED: "bg-secondary-500/20 text-secondary-500",
};
const DOC_TONE: Record<Doc["state"], string> = { OK: "bg-green-900 text-green-200", EXPIRING: "bg-amber-900 text-amber-200", EXPIRED: "bg-red-950 text-red-300", NO_EXPIRY: "bg-secondary-500/20 text-secondary-500" };
const DOC_LABEL: Record<Doc["state"], string> = { OK: "Valid", EXPIRING: "Runs out soon", EXPIRED: "Expired", NO_EXPIRY: "No expiry" };
const FILTERS: [string, string][] = [
  ["", "All"],
  ["IDENTIFIED", "Spotted"],
  ["PREPARING", "Preparing"],
  ["SUBMITTED", "Submitted"],
  ["WON", "Won"],
  ["LOST", "Lost"],
];
const open = (s: Status) => s === "IDENTIFIED" || s === "PREPARING";

/** Tenders the business bids for: the checklist, the bid costing, the documents that must be valid, and what happened. A won tender becomes a contract. */
export default function SchoolTendersPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState("");
  const [tenders, setTenders] = useState<Tender[] | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [schools, setSchools] = useState<School[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [bidLines, setBidLines] = useState<BidLine[]>([]);
  const [search, setSearch] = useState("");
  const [newCheck, setNewCheck] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [form, setForm] = useState<{ entityName: string; tenderNumber: string; title: string; closingDate: string; schoolId: string; notes: string } | null>(null);
  const [docForm, setDocForm] = useState<{ id: string | null; name: string; reference: string; issuedOn: string; expiryDate: string } | null>(null);
  const [award, setAward] = useState({ schoolId: "", startDate: "", endDate: "", value: "" });

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const [t, d] = await Promise.all([apiGet<Tender[]>(`/school-supplier/tenders${filter ? `?status=${filter}` : ""}`), apiGet<Doc[]>("/school-supplier/compliance")]);
      setTenders(t);
      setDocs(d);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the tenders.");
    }
  }, [filter]);

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
    setSession(s);
    void apiGet<School[]>("/school-supplier/schools").then(setSchools).catch(() => undefined);
    void apiGet<PriceRow[]>("/school-supplier/price-list").then(setPrices).catch(() => undefined);
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  function openTender(t: Tender) {
    if (openId === t.id) {
      setOpenId(null);
      return;
    }
    setOpenId(t.id);
    setReady(null);
    setNotice(null);
    setBidLines(t.lines.map((l) => ({ variantId: l.variantId, description: l.description, quantity: String(l.quantity), unitCost: String(l.unitCost), unitPrice: String(l.unitPrice), taxRate: l.taxRate })));
    setAward({ schoolId: t.school?.id ?? "", startDate: new Date().toISOString().slice(0, 10), endDate: "", value: "" });
    if (t.status === "IDENTIFIED" || t.status === "PREPARING") void apiGet<Readiness>(`/school-supplier/tenders/${t.id}/readiness`).then(setReady).catch(() => undefined);
  }

  async function run(label: string, fn: () => Promise<unknown>, done: string, reopen = true) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      if (reopen && openId) void apiGet<Readiness>(`/school-supplier/tenders/${openId}/readiness`).then(setReady).catch(() => setReady(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${label}.`);
    } finally {
      setBusy(false);
    }
  }

  const found = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (t.length < 2) return [];
    return prices.filter((p) => p.title.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [search, prices]);

  const draftBid = useMemo(() => {
    let cost = 0;
    let sub = 0;
    let tax = 0;
    for (const l of bidLines) {
      const q = Number(l.quantity || 0);
      cost += q * Number(l.unitCost || 0);
      const line = Math.round(q * Number(l.unitPrice || 0) * 100) / 100;
      sub += line;
      tax += Math.round(line * l.taxRate * 100) / 100;
    }
    return { cost, sub, tax, margin: sub - cost, pct: sub > 0 ? Math.round(((sub - cost) / sub) * 10000) / 100 : 0 };
  }, [bidLines]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Tenders</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-contracts" className="text-primary-600 hover:underline">Contracts</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">Keep track of the tenders you are bidding for: what must be ready, what the bid costs and earns, and the documents that must still be valid when it closes. When you win, one button makes the contract.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        <section className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Documents you must keep valid</h2>
            {canEdit && !docForm && <button onClick={() => setDocForm({ id: null, name: "", reference: "", issuedOn: "", expiryDate: "" })} className="text-primary-600 hover:underline">Add a document</button>}
          </div>
          {docs.length === 0 && !docForm && <p className="text-secondary-500">None yet. Add your tax compliance certificate, business permit and the like: a tender cannot be submitted while one has expired.</p>}
          <ul className="divide-y divide-border">
            {docs.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <p className="font-medium">{d.name} {d.reference && <span className="font-mono text-xs text-secondary-500">{d.reference}</span>}</p>
                  <p className="text-xs text-secondary-500">{d.expiryDate ? `Runs out ${d.expiryDate}` : "Does not expire"}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`rounded px-2 py-0.5 text-xs ${DOC_TONE[d.state]}`}>{DOC_LABEL[d.state]}</span>
                  {canEdit && <button onClick={() => setDocForm({ id: d.id, name: d.name, reference: d.reference ?? "", issuedOn: d.issuedOn ?? "", expiryDate: d.expiryDate ?? "" })} className="text-xs text-primary-600 hover:underline">Change</button>}
                  {canEdit && <button onClick={() => window.confirm(`Remove ${d.name}?`) && void run("remove it", () => apiDelete(`/school-supplier/compliance/${d.id}`), "Removed.", false)} className="text-xs text-error-600 hover:underline">Remove</button>}
                </div>
              </li>
            ))}
          </ul>
          {docForm && (
            <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
              <label>Name<input value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })} placeholder="e.g. Tax compliance certificate" className={field} /></label>
              <label>Number <span className="text-secondary-500">(optional)</span><input value={docForm.reference} onChange={(e) => setDocForm({ ...docForm, reference: e.target.value })} className={field} /></label>
              <label>Issued on <span className="text-secondary-500">(optional)</span><input type="date" value={docForm.issuedOn} onChange={(e) => setDocForm({ ...docForm, issuedOn: e.target.value })} className={field} /></label>
              <label>Runs out on <span className="text-secondary-500">(blank = never)</span><input type="date" value={docForm.expiryDate} onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })} className={field} /></label>
              <div className="flex gap-2 sm:col-span-2">
                <button disabled={busy || docForm.name.trim().length < 2} onClick={() => void run("save it", async () => { const body = { name: docForm.name.trim(), reference: docForm.reference.trim() || undefined, issuedOn: docForm.issuedOn || undefined, expiryDate: docForm.expiryDate || undefined }; if (docForm.id) await apiPut(`/school-supplier/compliance/${docForm.id}`, body); else await apiPost("/school-supplier/compliance", body); setDocForm(null); }, "Saved.", false)} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Save</button>
                <button onClick={() => setDocForm(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
              </div>
            </div>
          )}
        </section>

        {canEdit && !form && <button onClick={() => setForm({ entityName: "", tenderNumber: "", title: "", closingDate: "", schoolId: "", notes: "" })} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">Register a tender</button>}
        {form && (
          <section className="grid gap-3 rounded-lg border border-primary-600 bg-surface p-4 text-sm sm:grid-cols-2">
            <label>Who invited it?<input value={form.entityName} onChange={(e) => setForm({ ...form, entityName: e.target.value })} placeholder="e.g. County Education Office" className={field} /></label>
            <label>Their tender number<input value={form.tenderNumber} onChange={(e) => setForm({ ...form, tenderNumber: e.target.value })} className={field} /></label>
            <label className="sm:col-span-2">What is it for?<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} /></label>
            <label>Closes on<input type="date" value={form.closingDate} onChange={(e) => setForm({ ...form, closingDate: e.target.value })} className={field} /></label>
            <label>One of your schools? <span className="text-secondary-500">(optional)</span>
              <select value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} className={field}>
                <option value="">No - someone else</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label className="sm:col-span-2">Notes <span className="text-secondary-500">(optional)</span><input maxLength={1000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={field} /></label>
            <div className="flex gap-2 sm:col-span-2">
              <button disabled={busy || form.entityName.trim().length < 2 || !form.tenderNumber.trim() || form.title.trim().length < 2} onClick={() => void run("register it", async () => { await apiPost("/school-supplier/tenders", { entityName: form.entityName.trim(), tenderNumber: form.tenderNumber.trim(), title: form.title.trim(), closingDate: form.closingDate || undefined, schoolId: form.schoolId || undefined, notes: form.notes.trim() || undefined }); setForm(null); }, "Tender registered with the standard checklist.", false)} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Register</button>
              <button onClick={() => setForm(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button key={label} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-sm ${filter === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>{label}</button>
          ))}
        </div>
        {!tenders && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {tenders && tenders.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No tenders here.</p>}

        <ul className="space-y-3">
          {tenders?.map((t) => {
            const done = t.checklist.filter((c) => c.done).length;
            const days = t.closingDate ? Math.round((new Date(`${t.closingDate}T00:00:00Z`).getTime() - new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`).getTime()) / 86_400_000) : null;
            return (
              <li key={t.id} className="rounded-lg border border-border bg-surface">
                <button onClick={() => openTender(t)} className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left">
                  <div>
                    <p className="font-semibold">{t.title}</p>
                    <p className="text-xs text-secondary-500">
                      {t.entityName} · <span className="font-mono">{t.tenderNumber}</span>
                      {t.closingDate ? ` · closes ${t.closingDate}` : ""}
                      {open(t.status) && days !== null ? (days < 0 ? " (closed)" : days <= 7 ? ` (${days} day${days === 1 ? "" : "s"} left)` : "") : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`rounded px-2 py-0.5 text-xs ${TONE[t.status]}`}>{LABEL[t.status]}</span>
                    {t.bid.total > 0 && <p className="mt-1 font-mono font-semibold">{kes(t.bid.total)}</p>}
                    {open(t.status) && <p className="text-xs text-secondary-500">{done} of {t.checklist.length} ready</p>}
                  </div>
                </button>
                {openId === t.id && (
                  <div className="space-y-4 border-t border-border p-3 text-sm">
                    {t.notes && <p className="text-secondary-600">{t.notes}</p>}
                    {t.submitOverride && <p className="rounded-md bg-amber-950 p-2 text-xs text-amber-200">Submitted by the owner in spite of a block: {t.submitOverride}</p>}
                    {t.outcomeNote && <p className="text-secondary-600">Note: {t.outcomeNote}</p>}
                    {t.contract && <p>Became contract <Link href="/school-contracts" className="text-primary-600 hover:underline">{t.contract.contractNumber}</Link>.</p>}

                    <div>
                      <p className="mb-1 text-xs uppercase text-secondary-500">Checklist</p>
                      <ul className="space-y-1">
                        {t.checklist.map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-2">
                            <label className="flex items-center gap-2">
                              <input type="checkbox" checked={c.done} disabled={!canEdit || busy || !open(t.status)} onChange={(e) => void run("tick it", () => apiPatch(`/school-supplier/tenders/${t.id}/checklist/${c.id}`, { done: e.target.checked }), "Updated.")} />
                              <span className={c.done ? "text-secondary-500 line-through" : ""}>{c.title}</span>
                            </label>
                            {canEdit && open(t.status) && <button onClick={() => void run("remove it", () => apiDelete(`/school-supplier/tenders/${t.id}/checklist/${c.id}`), "Removed.")} className="text-xs text-error-600 hover:underline">Remove</button>}
                          </li>
                        ))}
                      </ul>
                      {canEdit && open(t.status) && (
                        <div className="mt-2 flex gap-2">
                          <input value={newCheck} onChange={(e) => setNewCheck(e.target.value)} placeholder="Add something that must be ready" className="flex-1 rounded-md border border-border bg-surface p-2" />
                          <button disabled={busy || newCheck.trim().length < 2} onClick={() => void run("add it", async () => { await apiPost(`/school-supplier/tenders/${t.id}/checklist`, { title: newCheck.trim() }); setNewCheck(""); }, "Added.")} className="rounded-md border border-border px-3 hover:bg-secondary-500/10 disabled:opacity-50">Add</button>
                        </div>
                      )}
                    </div>

                    <div>
                      <p className="mb-1 text-xs uppercase text-secondary-500">The bid</p>
                      {open(t.status) && canEdit && (
                        <div className="mb-2">
                          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Add a product from your list: type part of its name" className={field} />
                          {found.length > 0 && (
                            <ul className="mt-1 rounded-md border border-border bg-surface">
                              {found.map((p) => (
                                <li key={p.variantId}>
                                  <button onClick={() => { setBidLines((l) => (l.some((x) => x.variantId === p.variantId) ? l : [...l, { variantId: p.variantId, description: p.title, quantity: "1", unitCost: String(p.cost ?? 0), unitPrice: String(p.schoolPrice ?? p.price), taxRate: p.taxRate }])); setSearch(""); }} className="flex w-full justify-between p-2 text-left hover:bg-secondary-500/10">
                                    <span>{p.title} <span className="text-xs text-secondary-500">{p.sku}</span></span>
                                    <span className="font-mono text-xs">{(p.schoolPrice ?? p.price).toFixed(2)}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                          <button onClick={() => setBidLines((l) => [...l, { variantId: null, description: "", quantity: "1", unitCost: "0", unitPrice: "0", taxRate: 0 }])} className="mt-1 text-xs text-primary-600 hover:underline">Add something that is not on your list (delivery, a service...)</button>
                        </div>
                      )}
                      {bidLines.length > 0 && (
                        <table className="w-full">
                          <thead>
                            <tr className="text-left text-xs uppercase text-secondary-500">
                              <th className="py-1">Item</th>
                              <th className="py-1 text-right">Qty</th>
                              <th className="py-1 text-right">Costs us</th>
                              <th className="py-1 text-right">Price (before VAT)</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {bidLines.map((l, i) => (
                              <tr key={i} className="border-t border-border">
                                <td className="py-1">
                                  {l.variantId ? l.description : <input value={l.description} disabled={!open(t.status)} onChange={(e) => setBidLines((x) => x.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} className="w-full rounded-md border border-border bg-surface p-1" />}
                                </td>
                                {(["quantity", "unitCost", "unitPrice"] as const).map((k) => (
                                  <td key={k} className="py-1 text-right">
                                    <input type="number" min={0} step="any" disabled={!open(t.status) || !canEdit} value={l[k]} onChange={(e) => setBidLines((x) => x.map((y, j) => (j === i ? { ...y, [k]: e.target.value } : y)))} className="w-24 rounded-md border border-border bg-surface p-1 text-right" />
                                  </td>
                                ))}
                                <td className="py-1 text-right">{open(t.status) && canEdit && <button onClick={() => setBidLines((x) => x.filter((_, j) => j !== i))} className="text-xs text-error-600 hover:underline">Remove</button>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                      {bidLines.length > 0 && (
                        <p className="mt-2 text-right text-xs text-secondary-500">
                          Costs {kes(draftBid.cost)} · priced {kes(draftBid.sub)} + VAT {kes(draftBid.tax)} = <span className="font-semibold text-foreground">{kes(draftBid.sub + draftBid.tax)}</span> ·{" "}
                          <span className={draftBid.margin < 0 ? "font-semibold text-red-400" : "font-semibold text-green-400"}>margin {kes(draftBid.margin)} ({draftBid.pct}%)</span>
                        </p>
                      )}
                      {open(t.status) && canEdit && (
                        <button disabled={busy || bidLines.some((l) => !l.description.trim() || !(Number(l.quantity) > 0))} onClick={() => void run("save it", () => apiPut(`/school-supplier/tenders/${t.id}/lines`, { lines: bidLines.map((l) => ({ variantId: l.variantId ?? undefined, description: l.description.trim(), quantity: Number(l.quantity), unitCost: Number(l.unitCost || 0), unitPrice: Number(l.unitPrice || 0), taxRate: l.taxRate })) }), "Bid saved.")} className="mt-2 rounded-md border border-border px-3 py-1.5 hover:bg-secondary-500/10 disabled:opacity-50">Save the bid</button>
                      )}
                    </div>

                    {open(t.status) && ready && (
                      <div className="space-y-1">
                        {ready.closed && <p className="rounded-md bg-red-950 p-2 text-xs text-red-300">The closing date has passed, so this tender can no longer be submitted.</p>}
                        {ready.blockers.map((b) => <p key={b} className="rounded-md bg-red-950 p-2 text-xs text-red-300">In the way: {b}</p>)}
                        {ready.warnings.map((w) => <p key={w} className="rounded-md bg-amber-950 p-2 text-xs text-amber-200">{w}</p>)}
                        {!ready.closed && ready.blockers.length === 0 && ready.warnings.length === 0 && <p className="rounded-md bg-green-950 p-2 text-xs text-green-300">Everything is ready to submit.</p>}
                      </div>
                    )}

                    {canEdit && (
                      <div className="flex flex-wrap gap-3">
                        {t.status === "IDENTIFIED" && <button disabled={busy} onClick={() => void run("start it", () => apiPost(`/school-supplier/tenders/${t.id}/start`, {}), "Marked as being prepared.")} className="text-primary-600 hover:underline">Start preparing</button>}
                        {open(t.status) && (
                          <button
                            disabled={busy}
                            onClick={() => {
                              let overrideReason: string | undefined;
                              if (ready && ready.blockers.length > 0) {
                                const why = window.prompt("Something is in the way (see above). Only the owner may submit anyway. Why is it all right?", "");
                                if (why === null) return;
                                overrideReason = why.trim() || undefined;
                              }
                              void run("submit it", () => apiPost(`/school-supplier/tenders/${t.id}/submit`, { overrideReason }), "Marked as submitted.");
                            }}
                            className="rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                          >
                            Mark as submitted
                          </button>
                        )}
                        {open(t.status) && <button disabled={busy} onClick={() => window.confirm("Delete this tender?") && void run("delete it", () => apiDelete(`/school-supplier/tenders/${t.id}`), "Deleted.", false)} className="text-error-600 hover:underline">Delete</button>}
                        {(t.status === "IDENTIFIED" || t.status === "PREPARING" || t.status === "SUBMITTED") && <button disabled={busy} onClick={() => { const n = window.prompt("Why are you pulling out? (optional)", ""); if (n === null) return; void run("withdraw it", () => apiPost(`/school-supplier/tenders/${t.id}/withdraw`, { note: n.trim() || undefined }), "Withdrawn.", false); }} className="text-secondary-500 hover:underline">Withdraw</button>}
                        {t.status === "SUBMITTED" && <button disabled={busy} onClick={() => { const n = window.prompt("What did you learn? (optional)", ""); if (n === null) return; void run("mark it", () => apiPost(`/school-supplier/tenders/${t.id}/lost`, { note: n.trim() || undefined }), "Marked as lost.", false); }} className="text-error-600 hover:underline">We lost it</button>}
                        {t.status === "SUBMITTED" && <button disabled={busy} onClick={() => { const n = window.prompt("The institution cancelled it. Any note? (optional)", ""); if (n === null) return; void run("mark it", () => apiPost(`/school-supplier/tenders/${t.id}/cancelled`, { note: n.trim() || undefined }), "Marked as cancelled.", false); }} className="text-secondary-500 hover:underline">They cancelled it</button>}
                      </div>
                    )}

                    {canEdit && t.status === "SUBMITTED" && (
                      <div className="space-y-2 rounded-md border border-border p-3">
                        <p className="font-semibold">We won it - make the contract</p>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label>The school the contract is with
                            <select value={award.schoolId} onChange={(e) => setAward({ ...award, schoolId: e.target.value })} className={field}>
                              <option value="">Choose...</option>
                              {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                            </select>
                          </label>
                          <label>Contract value <span className="text-secondary-500">(blank = the bid, {kes(t.bid.total)})</span>
                            <input type="number" min={1} step="0.01" value={award.value} onChange={(e) => setAward({ ...award, value: e.target.value })} className={field} />
                          </label>
                          <label>Starts<input type="date" value={award.startDate} onChange={(e) => setAward({ ...award, startDate: e.target.value })} className={field} /></label>
                          <label>Ends<input type="date" value={award.endDate} onChange={(e) => setAward({ ...award, endDate: e.target.value })} className={field} /></label>
                        </div>
                        <p className="text-xs text-secondary-500">A school that is new to you must be added under Schools first, so it can be invoiced.</p>
                        <button disabled={busy || !award.schoolId || !award.startDate || !award.endDate} onClick={() => void run("make the contract", async () => { const r = await apiPost<{ contractNumber: string }>(`/school-supplier/tenders/${t.id}/award`, { schoolId: award.schoolId, startDate: award.startDate, endDate: award.endDate, value: award.value ? Number(award.value) : undefined }); setNotice(`Contract ${r.contractNumber} made. Open Contracts to see it.`); }, "", false)} className="rounded-md bg-green-700 px-4 py-2 font-semibold text-white hover:bg-green-800 disabled:opacity-50">Make the contract</button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </main>
    </div>
  );
}
