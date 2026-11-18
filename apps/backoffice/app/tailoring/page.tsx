"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { variantLabel } from "../../lib/variant-label";

interface Tailor {
  id: string;
  name: string;
  phone: string | null;
  idNumber: string | null;
  notes: string | null;
  active: boolean;
  openJobs: number;
  piecesWithTailor: number;
  piecesMade: number;
  earned: number;
  paid: number;
  owed: number;
}
interface Branch {
  id: string;
  name: string;
}
interface Variant {
  id: string;
  sku: string;
  name?: string | null;
  madeAhead?: boolean;
  tailorRate?: string | number | null;
}
interface Product {
  id: string;
  name: string;
  variants: Variant[];
}
interface HandIn {
  id: string;
  goodQty: number;
  rejectedQty: number;
  labourAmount: string;
  notes: string | null;
  receivedByName: string | null;
  createdAt: string;
}
interface Job {
  id: string;
  jobNumber: string;
  quantity: number;
  quantityGood: number;
  quantityRejected: number;
  ratePerPiece: string;
  materialsCost: string;
  status: "OPEN" | "DONE" | "CANCELLED";
  dueDate: string | null;
  notes: string | null;
  closeNote: string | null;
  createdAt: string;
  tailor: { id: string; name: string };
  variant: Variant & { product: { name: string } };
  handIns: HandIn[];
}
interface MaterialsPlan {
  variant: { id: string; name: string; tailorRate: number | null };
  lines: { variantId: string; name: string; quantity: number; inStock: number; short: number; unitCost: number | null }[];
  cost: { total: number; uncosted: number };
  enough: boolean;
}
interface Payment {
  id: string;
  amount: string;
  method: "CASH" | "MPESA" | "BANK";
  reference: string | null;
  paidOn: string;
  notes: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  tailor: { name: string };
}
interface StatementLine {
  kind: "HAND_IN" | "PAYMENT";
  id: string;
  date: string;
  detail: string;
  earned: number;
  paid: number;
  owed: number;
  voided: boolean;
}

type Tab = "jobs" | "tailors" | "pay";
const kes = (n: number | string) => `KES ${Number(n).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(d).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const field = "mt-1 w-full rounded-md border border-border bg-background p-2 text-base sm:text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const METHOD = { CASH: "Cash", MPESA: "M-Pesa", BANK: "Bank" } as const;

/** Uniform makers: give tailors jobs (materials leave stock), take in finished pieces (into stock), and pay the tailors. */
export default function TailoringPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("jobs");
  const [tailors, setTailors] = useState<Tailor[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [show, setShow] = useState<"OPEN" | "DONE" | "CANCELLED">("OPEN");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      const [t, b, p, j, pay] = await Promise.all([
        apiGet<Tailor[]>("/tailoring/tailors"),
        apiGet<Branch[]>("/branches"),
        apiGet<Product[]>("/products"),
        apiGet<Job[]>(`/tailoring/jobs?status=${show}`),
        apiGet<Payment[]>("/tailoring/payments"),
      ]);
      setTailors(t);
      setBranches(b);
      setProducts(p);
      setJobs(j);
      setPayments(pay);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load tailoring.");
    }
  }, [show]);

  useEffect(() => {
    const s = getSession();
    if (!s) return router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return router.replace("/login");
    }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  const done = (msg: string) => {
    setNotice(msg);
    setError(null);
    void load();
  };
  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  if (!session) return null;
  const owedTotal = tailors.reduce((t, x) => t + Math.max(0, x.owed), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold">Tailoring</h1>
            <p className="text-sm text-secondary-500">
              Give tailors jobs, take in the pieces they finish, and pay them. Each piece&apos;s materials are set on its{" "}
              <Link href="/products" className="text-primary-600 hover:underline">product</Link> (Recipe).
            </p>
          </div>
          <p className="text-sm">
            Owed to tailors: <strong className="font-mono">{kes(owedTotal)}</strong>
          </p>
        </div>

        <div className="flex gap-1 rounded-lg border border-border bg-surface p-1 text-sm">
          {(["jobs", "tailors", "pay"] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`flex-1 rounded-md px-3 py-2 font-medium ${tab === t ? "bg-primary-600 text-white" : "hover:bg-secondary-500/10"}`}>
              {t === "jobs" ? "Jobs" : t === "tailors" ? "Tailors" : "Pay"}
            </button>
          ))}
        </div>

        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-700">{error}</p>}
        {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}

        {tab === "jobs" && (
          <>
            {canEdit && <NewJob tailors={tailors.filter((t) => t.active)} branches={branches} products={products} onDone={done} onError={fail} />}
            <div className="flex gap-2 text-sm">
              {(["OPEN", "DONE", "CANCELLED"] as const).map((s) => (
                <button key={s} onClick={() => setShow(s)} className={`rounded-full border px-3 py-1 ${show === s ? "border-primary-600 bg-primary-600 text-white" : "border-border"}`}>
                  {s === "OPEN" ? "With tailors" : s === "DONE" ? "Finished" : "Cancelled"}
                </button>
              ))}
            </div>
            {!jobs && <p className="text-sm text-secondary-500">Loading...</p>}
            {jobs && jobs.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No jobs here.</p>}
            <div className="space-y-3">
              {jobs?.map((j) => <JobCard key={j.id} job={j} canEdit={canEdit} onDone={done} onError={fail} />)}
            </div>
          </>
        )}

        {tab === "tailors" && <Tailors tailors={tailors} canEdit={canEdit} onDone={done} onError={fail} />}
        {tab === "pay" && <Pay tailors={tailors} payments={payments} canEdit={canEdit} onDone={done} onError={fail} />}
      </main>
    </div>
  );
}

type Done = (msg: string) => void;
type Fail = (err: unknown, fallback: string) => void;

function NewJob({ tailors, branches, products, onDone, onError }: { tailors: Tailor[]; branches: Branch[]; products: Product[]; onDone: Done; onError: Fail }) {
  const [open, setOpen] = useState(false);
  const [tailorId, setTailorId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [variantId, setVariantId] = useState("");
  const [search, setSearch] = useState("");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [plan, setPlan] = useState<MaterialsPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!branchId && branches[0]) setBranchId(branches[0].id);
  }, [branches, branchId]);

  const pieces = useMemo(
    () =>
      products
        .flatMap((p) => p.variants.map((v) => ({ ...v, label: variantLabel(p.name, v) })))
        .sort((a, b) => Number(!!b.madeAhead) - Number(!!a.madeAhead) || a.label.localeCompare(b.label)),
    [products],
  );
  const matches = search.trim() ? pieces.filter((p) => p.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 12) : [];
  const picked = pieces.find((p) => p.id === variantId);

  useEffect(() => {
    const qty = Number(quantity);
    if (!variantId || !branchId || !Number.isInteger(qty) || qty < 1) return setPlan(null);
    const t = setTimeout(() => {
      apiGet<MaterialsPlan>(`/tailoring/materials?branchId=${branchId}&variantId=${variantId}&quantity=${qty}`)
        .then((p) => {
          setPlan(p);
          setPlanError(null);
        })
        .catch((err) => setPlanError(err instanceof ApiError ? err.message : "Could not check the materials."));
    }, 300);
    return () => clearTimeout(t);
  }, [variantId, branchId, quantity]);

  function pick(v: (typeof pieces)[number]) {
    setVariantId(v.id);
    setSearch("");
    setRate(v.tailorRate === null || v.tailorRate === undefined ? "" : String(Number(v.tailorRate)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const job = await apiPost<{ jobNumber: string; uncostedMaterials: number }>("/tailoring/jobs", {
        tailorId,
        branchId,
        variantId,
        quantity: Number(quantity),
        ...(rate.trim() ? { ratePerPiece: Number(rate) } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      onDone(`${job.jobNumber} given out. The materials have left stock.${job.uncostedMaterials ? ` ${job.uncostedMaterials} material${job.uncostedMaterials === 1 ? " has" : "s have"} no cost yet, so the pieces will look cheaper than they are.` : ""}`);
      setOpen(false);
      setVariantId("");
      setQuantity("");
      setNotes("");
      setDueDate("");
    } catch (err) {
      onError(err, "Could not give out the job.");
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button onClick={() => setOpen(true)} className={`${primary} w-full sm:w-auto`} disabled={tailors.length === 0} title={tailors.length === 0 ? "Add a tailor first" : undefined}>
        + Give a tailor a job
      </button>
    );

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">Give a tailor a job</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Tailor
          <select required value={tailorId} onChange={(e) => setTailorId(e.target.value)} className={field}>
            <option value="">Choose...</option>
            {tailors.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
                {t.piecesWithTailor ? ` (${t.piecesWithTailor} pieces in hand)` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Materials come from
          <select required value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </label>
        <div className="text-sm sm:col-span-2">
          Piece and size
          {picked ? (
            <p className="mt-1 flex items-center justify-between rounded-md border border-border bg-background p-2">
              <span>{picked.label}</span>
              <button type="button" onClick={() => setVariantId("")} className="text-xs text-primary-600 hover:underline">Change</button>
            </p>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to find, e.g. shirt 12" className={field} />
              {matches.length > 0 && (
                <ul className="mt-1 max-h-56 overflow-auto rounded-md border border-border bg-background">
                  {matches.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => pick(m)} className="w-full p-2 text-left hover:bg-secondary-500/10">
                        {m.label}
                        {!m.madeAhead && <span className="ml-2 text-xs text-secondary-500">(no materials list yet?)</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
        <label className="text-sm">
          How many pieces
          <input required type="number" inputMode="numeric" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          Pay per piece (KES)
          <input type="number" inputMode="decimal" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="The piece's usual rate" className={field} />
        </label>
        <label className="text-sm">
          Due back <span className="text-secondary-500">(optional)</span>
          <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={field} />
        </label>
        <label className="text-sm">
          Notes <span className="text-secondary-500">(optional)</span>
          <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Kisumu Girls order" className={field} />
        </label>
      </div>

      {planError && <p className="text-sm text-error-700">{planError}</p>}
      {plan && (
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="mb-2 font-medium">Materials handed out with this job</p>
          {plan.lines.length === 0 ? (
            <p className="text-error-700">
              {plan.variant.name} has no list of materials yet. Open it under <Link href={`/products/recipe/${plan.variant.id}`} className="underline">Products → Recipe</Link> and choose &quot;Made in advance&quot;.
            </p>
          ) : (
            <ul className="space-y-1">
              {plan.lines.map((l) => (
                <li key={l.variantId} className="flex justify-between gap-2">
                  <span>{l.name}</span>
                  <span className={l.short > 0 ? "font-semibold text-error-700" : ""}>
                    {l.quantity} <span className="text-secondary-500">of {l.inStock} in stock</span>
                  </span>
                </li>
              ))}
              <li className="flex justify-between border-t border-border pt-1">
                <span>Materials cost</span>
                <span className="font-mono">{kes(plan.cost.total)}</span>
              </li>
              {rate && Number(quantity) > 0 && (
                <li className="flex justify-between text-secondary-500">
                  <span>Each piece will cost (materials + pay)</span>
                  <span className="font-mono">{kes(plan.cost.total / Number(quantity) + Number(rate))}</span>
                </li>
              )}
            </ul>
          )}
          {!plan.enough && plan.lines.length > 0 && <p className="mt-2 text-error-700">Not enough materials. Receive more, or give a smaller job.</p>}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" disabled={busy || !tailorId || !variantId || !plan?.enough || plan.lines.length === 0} className={primary}>
          {busy ? "Giving out..." : "Give out the job"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}

function JobCard({ job, canEdit, onDone, onError }: { job: Job; canEdit: boolean; onDone: Done; onError: Fail }) {
  const [good, setGood] = useState("");
  const [rejected, setRejected] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const left = job.quantity - job.quantityGood - job.quantityRejected;
  const late = job.status === "OPEN" && job.dueDate && job.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
  const item = variantLabel(job.variant.product.name, job.variant);

  async function handIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost(`/tailoring/jobs/${job.id}/hand-in`, { goodQty: Number(good || 0), rejectedQty: Number(rejected || 0), ...(notes.trim() ? { notes: notes.trim() } : {}) });
      onDone(`${Number(good || 0)} good piece${Number(good || 0) === 1 ? "" : "s"} of ${item} taken into stock from ${job.tailor.name}.`);
      setGood("");
      setRejected("");
      setNotes("");
    } catch (err) {
      onError(err, "Could not record the hand-in.");
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    const reason = window.prompt(`Close ${job.jobNumber}? The ${left} piece${left === 1 ? "" : "s"} still with ${job.tailor.name} will not come, and their materials are written off with the job. Why?`);
    if (!reason?.trim()) return;
    try {
      await apiPost(`/tailoring/jobs/${job.id}/close`, { reason: reason.trim() });
      onDone(`${job.jobNumber} closed.`);
    } catch (err) {
      onError(err, "Could not close the job.");
    }
  }

  async function cancel() {
    if (!window.confirm(`Cancel ${job.jobNumber}? Its materials go back into stock.`)) return;
    try {
      await apiPost(`/tailoring/jobs/${job.id}/cancel`, {});
      onDone(`${job.jobNumber} cancelled and its materials returned to stock.`);
    } catch (err) {
      onError(err, "Could not cancel the job.");
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {item} x {job.quantity}
            {late && <span className="ml-2 rounded bg-error-50 px-1.5 py-0.5 text-xs text-error-700">Late</span>}
          </p>
          <p className="text-xs text-secondary-500">
            {job.jobNumber} · {job.tailor.name} · {kes(job.ratePerPiece)} a piece · given {day(job.createdAt)}
            {job.dueDate ? ` · due ${day(job.dueDate)}` : ""}
          </p>
          {job.notes && <p className="text-xs text-secondary-500">{job.notes}</p>}
        </div>
        <div className="text-right text-xs">
          <p>
            <strong className="text-base">{job.quantityGood}</strong> good · {job.quantityRejected} rejected
          </p>
          {job.status === "OPEN" ? <p className="text-secondary-500">{left} still with the tailor</p> : <p className="text-secondary-500">{job.status === "DONE" ? "Finished" : "Cancelled"}</p>}
        </div>
      </div>
      {job.closeNote && <p className="text-xs text-secondary-500">Closed early: {job.closeNote}</p>}
      {job.handIns.length > 0 && (
        <ul className="space-y-0.5 border-t border-border pt-2 text-xs text-secondary-600">
          {job.handIns.map((h) => (
            <li key={h.id}>
              {day(h.createdAt)}: {h.goodQty} good{h.rejectedQty ? `, ${h.rejectedQty} rejected` : ""} · earned {kes(h.labourAmount)}
              {h.notes ? ` · ${h.notes}` : ""}
            </li>
          ))}
        </ul>
      )}
      {canEdit && job.status === "OPEN" && (
        <form onSubmit={handIn} className="grid grid-cols-2 gap-2 border-t border-border pt-3 sm:grid-cols-4">
          <label className="text-xs">
            Good pieces handed in
            <input type="number" inputMode="numeric" min={0} max={left} value={good} onChange={(e) => setGood(e.target.value)} className={field} />
          </label>
          <label className="text-xs">
            Rejected
            <input type="number" inputMode="numeric" min={0} max={left} value={rejected} onChange={(e) => setRejected(e.target.value)} className={field} />
          </label>
          <label className="col-span-2 text-xs">
            Note <span className="text-secondary-500">(optional)</span>
            <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} className={field} />
          </label>
          <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-4">
            <button type="submit" disabled={busy || Number(good || 0) + Number(rejected || 0) < 1} className={primary}>
              {busy ? "Saving..." : "Take in pieces"}
            </button>
            {job.quantityGood + job.quantityRejected === 0 ? (
              <button type="button" onClick={() => void cancel()} className="text-xs text-error-700 hover:underline">Cancel job</button>
            ) : (
              <button type="button" onClick={() => void close()} className="text-xs text-error-700 hover:underline">Close (no more coming)</button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}

function Tailors({ tailors, canEdit, onDone, onError }: { tailors: Tailor[]; canEdit: boolean; onDone: Done; onError: Fail }) {
  const [editing, setEditing] = useState<Tailor | "new" | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [statement, setStatement] = useState<{ id: string; lines: StatementLine[] } | null>(null);

  function start(t: Tailor | "new") {
    setEditing(t);
    setName(t === "new" ? "" : t.name);
    setPhone(t === "new" ? "" : (t.phone?.replace(/^254/, "0") ?? ""));
    setIdNumber(t === "new" ? "" : (t.idNumber ?? ""));
    setNotes(t === "new" ? "" : (t.notes ?? ""));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: name.trim(), phone: phone.trim() || undefined, idNumber: idNumber.trim() || undefined, notes: notes.trim() || undefined };
      if (editing === "new") await apiPost("/tailoring/tailors", body);
      else if (editing) await apiPatch(`/tailoring/tailors/${editing.id}`, { ...body, active: editing.active });
      onDone(editing === "new" ? `${name.trim()} added.` : "Tailor saved.");
      setEditing(null);
    } catch (err) {
      onError(err, "Could not save the tailor.");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(t: Tailor) {
    try {
      await apiPatch(`/tailoring/tailors/${t.id}`, { name: t.name, phone: t.phone ?? undefined, idNumber: t.idNumber ?? undefined, notes: t.notes ?? undefined, active: !t.active });
      onDone(t.active ? `${t.name} marked as not working.` : `${t.name} is working again.`);
    } catch (err) {
      onError(err, "Could not change that.");
    }
  }

  async function openStatement(t: Tailor) {
    if (statement?.id === t.id) return setStatement(null);
    try {
      const s = await apiGet<{ lines: StatementLine[] }>(`/tailoring/tailors/${t.id}/statement`);
      setStatement({ id: t.id, lines: s.lines });
    } catch (err) {
      onError(err, "Could not load the statement.");
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && !editing && (
        <button onClick={() => start("new")} className={`${primary} w-full sm:w-auto`}>+ Add a tailor</button>
      )}
      {editing && (
        <form onSubmit={save} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">{editing === "new" ? "Add a tailor" : `Change ${editing.name}`}</h2>
          <label className="text-sm">
            Name
            <input required minLength={2} maxLength={100} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            Phone <span className="text-secondary-500">(optional)</span>
            <input inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={field} />
          </label>
          <label className="text-sm">
            ID number <span className="text-secondary-500">(optional)</span>
            <input maxLength={30} value={idNumber} onChange={(e) => setIdNumber(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            Notes <span className="text-secondary-500">(optional)</span>
            <input maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. sweaters only, works from home" className={field} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy || name.trim().length < 2} className={primary}>{busy ? "Saving..." : "Save"}</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}
      {tailors.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No tailors yet. Add the people who sew for you.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {tailors.map((t) => (
          <li key={t.id} className="space-y-2 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {t.name} {!t.active && <span className="ml-1 rounded bg-secondary-500/15 px-1.5 py-0.5 text-xs">Not working</span>}
                </p>
                <p className="text-xs text-secondary-500">
                  {[t.phone?.replace(/^254/, "0"), t.idNumber && `ID ${t.idNumber}`, t.notes].filter(Boolean).join(" · ") || "No details"}
                </p>
                <p className="text-xs text-secondary-500">
                  {t.piecesMade} pieces made · {t.piecesWithTailor} in hand on {t.openJobs} job{t.openJobs === 1 ? "" : "s"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-secondary-500">{t.owed < 0 ? "Paid in advance" : "Owed"}</p>
                <p className="font-mono text-base font-bold">{kes(Math.abs(t.owed))}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-4 text-xs">
              <button onClick={() => void openStatement(t)} className="text-primary-600 hover:underline">{statement?.id === t.id ? "Hide statement" : "Statement"}</button>
              {canEdit && (
                <>
                  <button onClick={() => start(t)} className="text-primary-600 hover:underline">Change</button>
                  <button onClick={() => void toggle(t)} className="text-error-700 hover:underline">{t.active ? "Not working now" : "Working again"}</button>
                </>
              )}
            </div>
            {statement?.id === t.id && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-secondary-500">
                      <th className="py-1">Date</th>
                      <th>What</th>
                      <th className="text-right">Earned</th>
                      <th className="text-right">Paid</th>
                      <th className="text-right">Owed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statement.lines.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-2 text-secondary-500">Nothing yet.</td>
                      </tr>
                    )}
                    {statement.lines.map((l) => (
                      <tr key={l.id} className={`border-t border-border ${l.voided ? "text-secondary-500 line-through" : ""}`}>
                        <td className="whitespace-nowrap py-1 pr-2">{day(l.date)}</td>
                        <td className="pr-2">{l.detail}</td>
                        <td className="text-right font-mono">{l.earned ? kes(l.earned) : ""}</td>
                        <td className="text-right font-mono">{l.paid ? kes(l.paid) : ""}</td>
                        <td className="text-right font-mono">{kes(l.owed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pay({ tailors, payments, canEdit, onDone, onError }: { tailors: Tailor[]; payments: Payment[]; canEdit: boolean; onDone: Done; onError: Fail }) {
  const [tailorId, setTailorId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"CASH" | "MPESA" | "BANK">("MPESA");
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const chosen = tailors.find((t) => t.id === tailorId);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost("/tailoring/payments", { tailorId, amount: Number(amount), method, paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) });
      onDone(`Payment of ${kes(amount)} to ${chosen?.name ?? "the tailor"} recorded.`);
      setAmount("");
      setReference("");
    } catch (err) {
      onError(err, "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function voidPayment(p: Payment) {
    const reason = window.prompt(`Void this payment of ${kes(p.amount)} to ${p.tailor.name}? Say why:`);
    if (!reason?.trim()) return;
    try {
      await apiPost(`/tailoring/payments/${p.id}/void`, { reason: reason.trim() });
      onDone("Payment voided.");
    } catch (err) {
      onError(err, "Could not void the payment.");
    }
  }

  return (
    <div className="space-y-3">
      {canEdit && (
        <form onSubmit={pay} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Pay a tailor</h2>
          <label className="text-sm">
            Tailor
            <select required value={tailorId} onChange={(e) => setTailorId(e.target.value)} className={field}>
              <option value="">Choose...</option>
              {tailors.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.owed < 0 ? `paid ${kes(-t.owed)} ahead` : `owed ${kes(t.owed)}`})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Amount (KES)
            <input required type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
            {chosen && chosen.owed > 0 && (
              <button type="button" onClick={() => setAmount(String(chosen.owed))} className="mt-1 text-xs text-primary-600 hover:underline">
                Pay all owed ({kes(chosen.owed)})
              </button>
            )}
          </label>
          <label className="text-sm">
            Paid by
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)} className={field}>
              <option value="MPESA">M-Pesa</option>
              <option value="CASH">Cash</option>
              <option value="BANK">Bank</option>
            </select>
          </label>
          <label className="text-sm">
            M-Pesa code / reference <span className="text-secondary-500">(optional)</span>
            <input maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            Date paid
            <input type="date" value={paidOn} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setPaidOn(e.target.value)} className={field} />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy || !tailorId || !(Number(amount) > 0)} className={`${primary} w-full sm:w-auto`}>
              {busy ? "Saving..." : "Record payment"}
            </button>
          </div>
          {chosen && Number(amount) > chosen.owed && (
            <p className="text-xs text-secondary-500 sm:col-span-2">This is more than {chosen.name} is owed; the extra counts as paid in advance against their next pieces.</p>
          )}
        </form>
      )}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {payments.length === 0 && <li className="p-4 text-sm text-secondary-500">No payments yet.</li>}
        {payments.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${p.voidedAt ? "text-secondary-500" : ""}`}>
            <div>
              <p className={p.voidedAt ? "line-through" : "font-medium"}>
                {p.tailor.name} · {kes(p.amount)}
              </p>
              <p className="text-xs text-secondary-500">
                {day(p.paidOn)} · {METHOD[p.method]}
                {p.reference ? ` ${p.reference}` : ""}
                {p.voidedAt ? ` · voided: ${p.voidReason}` : ""}
              </p>
            </div>
            {canEdit && !p.voidedAt && (
              <button onClick={() => void voidPayment(p)} className="text-xs text-error-700 hover:underline">Void</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
