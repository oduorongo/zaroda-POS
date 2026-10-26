"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

type Status = "ACTIVE" | "COMPLETED" | "TERMINATED";
interface Contract {
  id: string;
  contractNumber: string;
  reference: string | null;
  retentionPercent: number;
  retentionReleaseDays: number;
  title: string;
  status: Status;
  school: { id: string; name: string };
  tender: { id: string; tenderNumber: string; title: string } | null;
  startDate: string;
  endDate: string;
  daysLeft: number | null;
  originalValue: number;
  value: number;
  variations: { id: string; date: string; amount: number; reason: string }[];
  netInvoiced: number;
  remaining: number;
  overrun: number;
  usedPercent: number;
  owed: number;
  profit: number;
  profitPercent: number;
  notes: string | null;
  closedNote: string | null;
}
interface Detail extends Contract {
  orders: { id: string; orderNumber: string; status: string }[];
  invoices: { id: string; invoiceNumber: string; issueDate: string; total: number; paid: number; credited: number; status: string }[];
}
interface School {
  id: string;
  name: string;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const LABEL: Record<Status, string> = { ACTIVE: "Running", COMPLETED: "Completed", TERMINATED: "Ended early" };
const TONE: Record<Status, string> = { ACTIVE: "bg-green-900 text-green-200", COMPLETED: "bg-secondary-500/20 text-secondary-500", TERMINATED: "bg-red-950 text-red-300" };

/** Contracts to supply a school: what they are worth, what has been used, what is owed and what they earn. */
export default function SchoolContractsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState("ACTIVE");
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<{ schoolId: string; title: string; reference: string; startDate: string; endDate: string; value: string; retentionPercent: string; retentionReleaseDays: string } | null>(null);
  const [variation, setVariation] = useState({ amount: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      setContracts(await apiGet<Contract[]>(`/school-supplier/contracts${filter ? `?status=${filter}` : ""}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the contracts.");
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
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function show(c: Contract) {
    if (openId === c.id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(c.id);
    setDetail(null);
    setNotice(null);
    setVariation({ amount: "", reason: "" });
    try {
      setDetail(await apiGet<Detail>(`/school-supplier/contracts/${c.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open it.");
    }
  }

  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
      await load();
      if (openId) setDetail(await apiGet<Detail>(`/school-supplier/contracts/${openId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Contracts</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-tenders" className="text-primary-600 hover:underline">Tenders</Link>
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
            <Link href="/school-money" className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">An order for a school with a running contract is put under it automatically (if the school has just one). Every delivery is then invoiced against the contract, so you can see what is used, what is left, what is owed and what it earns.</p>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {canEdit && !form && <button onClick={() => setForm({ schoolId: "", title: "", reference: "", startDate: today(), endDate: "", value: "", retentionPercent: "", retentionReleaseDays: "" })} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">New contract (without a tender)</button>}
        {form && (
          <section className="grid gap-3 rounded-lg border border-primary-600 bg-surface p-4 text-sm sm:grid-cols-2">
            <label>School
              <select value={form.schoolId} onChange={(e) => setForm({ ...form, schoolId: e.target.value })} className={field}>
                <option value="">Choose...</option>
                {schools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
            <label>Their contract number <span className="text-secondary-500">(optional)</span><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className={field} /></label>
            <label className="sm:col-span-2">What is it for?<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={field} /></label>
            <label>Starts<input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={field} /></label>
            <label>Ends<input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={field} /></label>
            <label>Value, VAT included (KES)<input type="number" min={1} step="0.01" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className={field} /></label>
            <label>Retention held back (%) <span className="text-secondary-500">(blank = the school&apos;s usual)</span><input type="number" min={0} max={50} step="0.01" value={form.retentionPercent} onChange={(e) => setForm({ ...form, retentionPercent: e.target.value })} className={field} /></label>
            <label>Released after (days)<input type="number" min={0} max={1825} value={form.retentionReleaseDays} onChange={(e) => setForm({ ...form, retentionReleaseDays: e.target.value })} className={field} /></label>
            <div className="flex items-end gap-2">
              <button disabled={busy || !form.schoolId || form.title.trim().length < 2 || !form.endDate || !(Number(form.value) > 0)} onClick={() => void run(async () => { await apiPost("/school-supplier/contracts", { schoolId: form.schoolId, title: form.title.trim(), reference: form.reference.trim() || undefined, startDate: form.startDate, endDate: form.endDate, value: Number(form.value), retentionPercent: form.retentionPercent === "" ? undefined : Number(form.retentionPercent), retentionReleaseDays: form.retentionReleaseDays === "" ? undefined : Number(form.retentionReleaseDays) }); setForm(null); }, "Contract made.")} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">Make the contract</button>
              <button onClick={() => setForm(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {([["ACTIVE", "Running"], ["COMPLETED", "Completed"], ["TERMINATED", "Ended early"], ["", "All"]] as [string, string][]).map(([k, l]) => (
            <button key={l} onClick={() => setFilter(k)} className={`rounded-full border px-3 py-1 text-sm ${filter === k ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>{l}</button>
          ))}
        </div>
        {!contracts && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {contracts && contracts.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No contracts here. Win a tender, or make one yourself.</p>}

        <ul className="space-y-3">
          {contracts?.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-surface">
              <button onClick={() => void show(c)} className="w-full space-y-2 p-3 text-left">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{c.title}</p>
                    <p className="text-xs text-secondary-500">
                      {c.school.name} · <span className="font-mono">{c.contractNumber}</span>
                      {c.reference ? ` · ${c.reference}` : ""} · {c.startDate} to {c.endDate}{c.retentionPercent > 0 ? ` · ${c.retentionPercent}% retention` : ""}
                      {c.daysLeft !== null ? (c.daysLeft < 0 ? " (past its end date)" : c.daysLeft <= 30 ? ` (${c.daysLeft} days left)` : "") : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`rounded px-2 py-0.5 text-xs ${TONE[c.status]}`}>{LABEL[c.status]}</span>
                    <p className="mt-1 font-mono font-semibold">{kes(c.value)}</p>
                  </div>
                </div>
                <div className="h-2 w-full overflow-hidden rounded bg-secondary-500/20">
                  <div className={`h-full ${c.overrun > 0 ? "bg-red-500" : "bg-primary-600"}`} style={{ width: `${Math.min(100, c.usedPercent)}%` }} />
                </div>
                <p className="text-xs text-secondary-500">
                  Used {kes(c.netInvoiced)} ({c.usedPercent}%) · left {kes(c.remaining)}
                  {c.overrun > 0 ? <span className="ml-1 text-red-400">· invoiced {kes(c.overrun)} over the contract</span> : ""}
                  {c.owed > 0 ? ` · owed ${kes(c.owed)}` : ""}
                </p>
              </button>
              {openId === c.id && (
                <div className="space-y-3 border-t border-border p-3 text-sm">
                  {!detail && <p className="text-secondary-500">Loading...</p>}
                  {detail && (
                    <>
                      <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                        <div className="rounded-md border border-border p-2"><p className="text-xs text-secondary-500">Agreed</p><p className="font-mono">{kes(detail.originalValue)}</p></div>
                        <div className="rounded-md border border-border p-2"><p className="text-xs text-secondary-500">Changes</p><p className="font-mono">{kes(detail.value - detail.originalValue)}</p></div>
                        <div className="rounded-md border border-border p-2"><p className="text-xs text-secondary-500">Profit so far</p><p className={`font-mono ${detail.profit < 0 ? "text-red-400" : "text-green-400"}`}>{kes(detail.profit)} ({detail.profitPercent}%)</p></div>
                        <div className="rounded-md border border-border p-2"><p className="text-xs text-secondary-500">Owed now</p><p className="font-mono">{kes(detail.owed)}</p></div>
                      </div>
                      {detail.tender && <p className="text-secondary-600">From tender {detail.tender.tenderNumber}: {detail.tender.title}</p>}
                      {detail.closedNote && <p className="text-secondary-600">Closed: {detail.closedNote}</p>}

                      <div>
                        <p className="mb-1 text-xs uppercase text-secondary-500">Changes to the value</p>
                        {detail.variations.length === 0 && <p className="text-secondary-500">None.</p>}
                        {detail.variations.map((v) => (
                          <p key={v.id} className="flex justify-between border-t border-border py-1"><span>{v.date} - {v.reason}</span><span className={`font-mono ${v.amount < 0 ? "text-red-400" : ""}`}>{v.amount > 0 ? "+" : ""}{kes(v.amount)}</span></p>
                        ))}
                        {canEdit && detail.status === "ACTIVE" && (
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            <label>Change (KES, minus to reduce)<input type="number" step="0.01" value={variation.amount} onChange={(e) => setVariation({ ...variation, amount: e.target.value })} className="mt-1 block w-40 rounded-md border border-border bg-surface p-2" /></label>
                            <label className="flex-1">Why<input maxLength={300} value={variation.reason} onChange={(e) => setVariation({ ...variation, reason: e.target.value })} className={field} /></label>
                            <button disabled={busy || !Number(variation.amount) || variation.reason.trim().length < 3} onClick={() => void run(async () => { await apiPost(`/school-supplier/contracts/${detail.id}/variations`, { amount: Number(variation.amount), reason: variation.reason.trim() }); setVariation({ amount: "", reason: "" }); }, "Value changed.")} className="rounded-md border border-border px-3 py-2 hover:bg-secondary-500/10 disabled:opacity-50">Record the change</button>
                          </div>
                        )}
                      </div>

                      <div>
                        <p className="mb-1 text-xs uppercase text-secondary-500">Invoiced against it</p>
                        {detail.invoices.length === 0 && <p className="text-secondary-500">Nothing yet. Open an order and put it under this contract; its deliveries are then invoiced against it.</p>}
                        {detail.invoices.map((i) => (
                          <p key={i.id} className="flex flex-wrap justify-between gap-2 border-t border-border py-1">
                            <span><Link href={`/school-print/invoice/${i.id}`} target="_blank" className="text-primary-600 hover:underline">{i.invoiceNumber}</Link> · {i.issueDate}{i.status === "VOID" ? " · cancelled" : ""}</span>
                            <span className="font-mono">{kes(i.total)}{i.credited > 0 ? ` (credited ${kes(i.credited)})` : ""} · paid {kes(i.paid)}</span>
                          </p>
                        ))}
                        {detail.orders.length > 0 && <p className="mt-2 text-xs text-secondary-500">Orders: {detail.orders.map((o) => o.orderNumber).join(", ")}</p>}
                      </div>

                      {canEdit && detail.status === "ACTIVE" && (
                        <div className="flex flex-wrap gap-4 border-t border-border pt-3">
                          <button disabled={busy} onClick={() => { const n = window.prompt("The contract is finished. Any note?", "All supplied"); if (n === null || n.trim().length < 3) return; void run(() => apiPost(`/school-supplier/contracts/${detail.id}/close`, { outcome: "COMPLETED", note: n.trim() }), "Contract closed as completed."); }} className="text-primary-600 hover:underline">Close it as completed</button>
                          <button disabled={busy} onClick={() => { const n = window.prompt("Why is it ending early?", ""); if (n === null || n.trim().length < 3) return; void run(() => apiPost(`/school-supplier/contracts/${detail.id}/close`, { outcome: "TERMINATED", note: n.trim() }), "Contract ended."); }} className="text-error-600 hover:underline">End it early</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
