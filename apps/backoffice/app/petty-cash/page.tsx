"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Box {
  id: string;
  name: string;
  branchId: string | null;
  branchName: string | null;
  floatAmount: number;
  holderName: string | null;
  active: boolean;
  balance: number;
  topUpNeeded: number;
  lastCountedOn: string | null;
}
interface Branch {
  id: string;
  name: string;
}
interface Category {
  key: string;
  label: string;
}
interface BookLine {
  id: string;
  kind: "PAYMENT" | "TOP_UP" | "COUNT";
  date: string;
  voucherNumber: string | null;
  category: string | null;
  description: string | null;
  receivedBy: string | null;
  topUpFrom: string | null;
  countedAmount: number | null;
  recordedByName: string | null;
  voided: boolean;
  voidReason: string | null;
  moneyIn: number;
  moneyOut: number;
  balance: number;
}
interface Book {
  box: Box;
  from: string;
  to: string;
  opening: number;
  lines: BookLine[];
  paidOut: number;
  toppedUp: number;
  closing: number;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const niceDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const field = "mt-1 w-full rounded-md border border-border bg-background p-2 text-base sm:text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const FROM = [
  ["CASH", "The till (cash drawer)"],
  ["MPESA", "M-Pesa"],
  ["BANK", "The bank"],
] as const;
type Action = "pay" | "topup" | "count" | null;

/** Petty cash: small cash boxes kept apart from the till, with vouchers, top-ups, counts and the petty cash book. */
export default function PettyCashPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [boxes, setBoxes] = useState<Box[] | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [boxId, setBoxId] = useState<string>("");
  const [action, setAction] = useState<Action>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";
  const box = boxes?.find((b) => b.id === boxId) ?? null;

  const load = useCallback(async () => {
    try {
      const [b, br, c] = await Promise.all([apiGet<Box[]>("/petty-cash/boxes"), apiGet<Branch[]>("/branches"), apiGet<Category[]>("/expenses/categories")]);
      setBoxes(b);
      setBranches(br);
      setCategories(c);
      setBoxId((cur) => cur || b.find((x) => x.active)?.id || b[0]?.id || "");
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load petty cash.");
    }
  }, []);

  const loadBook = useCallback(async () => {
    if (!boxId) return setBook(null);
    try {
      setBook(await apiGet<Book>(`/petty-cash/boxes/${boxId}/book?from=${from}&to=${to}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the petty cash book.");
    }
  }, [boxId, from, to]);

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

  useEffect(() => {
    if (session) void loadBook();
  }, [session, loadBook]);

  const done = (msg: string) => {
    setNotice(msg);
    setError(null);
    setAction(null);
    void load();
    void loadBook();
  };
  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  async function voidLine(l: BookLine) {
    const what = l.kind === "PAYMENT" ? `voucher ${l.voucherNumber}` : l.kind === "TOP_UP" ? "this top-up" : "this count";
    const reason = window.prompt(`Void ${what}? Say why:`);
    if (!reason?.trim()) return;
    try {
      await apiPost(`/petty-cash/entries/${l.id}/void`, { reason: reason.trim() });
      done("Voided. The books are corrected on the next posting.");
    } catch (err) {
      fail(err, "Could not void it.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="print:hidden">
        <Nav session={session} />
        <PageHeader />
      </div>
      <main className="mx-auto max-w-4xl space-y-5 px-4 py-6">
        <div className="print:hidden">
          <h1 className="text-xl font-bold">Petty cash</h1>
          <p className="text-sm text-secondary-500">
            A cash box for small costs, kept apart from the till. Each payment gets a voucher and is also an expense, so it reaches your profit and your books.
          </p>
        </div>

        {error && <p className="rounded-md bg-error-50 p-3 text-sm text-error-700 print:hidden">{error}</p>}
        {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-700 print:hidden">{notice}</p>}

        <div className="grid gap-3 sm:grid-cols-2 print:hidden">
          {boxes?.map((b) => (
            <button
              key={b.id}
              onClick={() => {
                setBoxId(b.id);
                setAction(null);
              }}
              className={`rounded-lg border p-4 text-left ${b.id === boxId ? "border-primary-600 bg-primary-600/5" : "border-border bg-surface"} ${b.active ? "" : "opacity-60"}`}
            >
              <p className="font-semibold">
                {b.name} {!b.active && <span className="text-xs font-normal">(closed)</span>}
              </p>
              <p className="font-mono text-2xl font-bold">{kes(b.balance)}</p>
              <p className="text-xs text-secondary-500">
                Float {kes(b.floatAmount)}
                {b.topUpNeeded > 0 ? ` · ${kes(b.topUpNeeded)} to top up` : " · full"}
                {b.branchName ? ` · ${b.branchName}` : ""}
                {b.holderName ? ` · kept by ${b.holderName}` : ""}
              </p>
              <p className="text-xs text-secondary-500">{b.lastCountedOn ? `Last counted ${niceDay(b.lastCountedOn)}` : "Never counted"}</p>
            </button>
          ))}
          {canEdit && !creating && (
            <button onClick={() => setCreating(true)} className="rounded-lg border border-dashed border-border p-4 text-sm text-primary-600 hover:bg-secondary-500/10">
              + New petty cash box
            </button>
          )}
        </div>
        {boxes && boxes.length === 0 && !creating && <p className="text-sm text-secondary-500 print:hidden">No petty cash box yet.</p>}
        {creating && <NewBox branches={branches} onDone={(m) => { setCreating(false); done(m); }} onCancel={() => setCreating(false)} onError={fail} />}

        {box && canEdit && box.active && (
          <div className="flex flex-wrap gap-2 print:hidden">
            <button onClick={() => setAction(action === "pay" ? null : "pay")} className={primary}>Pay out (voucher)</button>
            <button onClick={() => setAction(action === "topup" ? null : "topup")} className="rounded-md border border-border px-4 py-2 text-sm">Top up</button>
            <button onClick={() => setAction(action === "count" ? null : "count")} className="rounded-md border border-border px-4 py-2 text-sm">Count the box</button>
            <BoxSettings box={box} onDone={done} onError={fail} />
          </div>
        )}
        {box && action === "pay" && <Pay box={box} categories={categories} onDone={done} onError={fail} />}
        {box && action === "topup" && <TopUp box={box} onDone={done} onError={fail} />}
        {box && action === "count" && <Count box={box} onDone={done} onError={fail} />}

        {book && (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm print:border-0 print:p-0">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Petty cash book: {book.box.name}</h2>
                <p className="text-xs text-secondary-500">
                  {niceDay(book.from)} to {niceDay(book.to)}
                  {book.box.holderName ? ` · kept by ${book.box.holderName}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-2 print:hidden">
                <label className="text-xs">
                  From
                  <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={field} />
                </label>
                <label className="text-xs">
                  To
                  <input type="date" value={to} max={today()} onChange={(e) => setTo(e.target.value)} className={field} />
                </label>
                <button onClick={() => window.print()} className="rounded-md border border-border px-3 py-2 text-sm">Print</button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-secondary-500">
                    <th className="py-1 pr-2">Date</th>
                    <th className="pr-2">Voucher</th>
                    <th className="pr-2">Details</th>
                    <th className="pr-2 text-right">In</th>
                    <th className="pr-2 text-right">Out</th>
                    <th className="pr-2 text-right">Balance</th>
                    <th className="print:hidden" />
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-1" colSpan={5}>Brought forward</td>
                    <td className="pr-2 text-right font-mono">{kes(book.opening)}</td>
                    <td className="print:hidden" />
                  </tr>
                  {book.lines.map((l) => (
                    <tr key={l.id} className={`border-b border-border align-top ${l.voided ? "text-secondary-500 line-through" : ""}`}>
                      <td className="whitespace-nowrap py-1 pr-2">{niceDay(l.date)}</td>
                      <td className="whitespace-nowrap pr-2">{l.voucherNumber ?? ""}</td>
                      <td className="pr-2">
                        {l.kind === "PAYMENT" && `${l.category ?? ""}: ${l.description ?? ""} (to ${l.receivedBy ?? ""})`}
                        {l.kind === "TOP_UP" && (l.description ?? "Top-up")}
                        {l.kind === "COUNT" && `${l.description ?? "Counted"} (counted ${kes(l.countedAmount ?? 0)})`}
                        {l.recordedByName ? <span className="block text-secondary-500">by {l.recordedByName}</span> : null}
                        {l.voided && <span className="block no-underline">Voided: {l.voidReason}</span>}
                      </td>
                      <td className="pr-2 text-right font-mono">{l.moneyIn ? kes(l.moneyIn) : ""}</td>
                      <td className="pr-2 text-right font-mono">{l.moneyOut ? kes(l.moneyOut) : ""}</td>
                      <td className="pr-2 text-right font-mono">{kes(l.balance)}</td>
                      <td className="print:hidden">
                        {canEdit && !l.voided && (
                          <button onClick={() => void voidLine(l)} className="text-error-700 hover:underline">Void</button>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-1" colSpan={3}>Paid out {kes(book.paidOut)} · topped up {kes(book.toppedUp)}</td>
                    <td colSpan={2} className="pr-2 text-right">Carried forward</td>
                    <td className="pr-2 text-right font-mono">{kes(book.closing)}</td>
                    <td className="print:hidden" />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="hidden pt-8 text-xs print:block">Checked by: ____________________ Signature: ____________________ Date: ______________</p>
          </section>
        )}
      </main>
    </div>
  );
}

type Done = (msg: string) => void;
type Fail = (err: unknown, fallback: string) => void;

function NewBox({ branches, onDone, onCancel, onError }: { branches: Branch[]; onDone: Done; onCancel: () => void; onError: Fail }) {
  const [name, setName] = useState("Petty cash");
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [floatAmount, setFloatAmount] = useState("5000");
  const [holderName, setHolderName] = useState("");
  const [from, setFrom] = useState<"CASH" | "MPESA" | "BANK">("CASH");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await apiPost("/petty-cash/boxes", { name: name.trim(), branchId: branchId || undefined, floatAmount: Number(floatAmount), holderName: holderName.trim() || undefined, from });
      onDone(`${name.trim()} is set up with ${kes(Number(floatAmount))}.`);
    } catch (err) {
      onError(err, "Could not create the box.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 print:hidden">
      <h2 className="font-semibold sm:col-span-2">New petty cash box</h2>
      <label className="text-sm">
        Name
        <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </label>
      <label className="text-sm">
        Branch
        <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={field}>
          <option value="">Whole business</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Float (KES)
        <input required type="number" inputMode="decimal" min={1} step="0.01" value={floatAmount} onChange={(e) => setFloatAmount(e.target.value)} className={field} />
        <span className="mt-1 block text-xs text-secondary-500">What the box is kept topped up to.</span>
      </label>
      <label className="text-sm">
        Kept by <span className="text-secondary-500">(optional)</span>
        <input maxLength={100} value={holderName} onChange={(e) => setHolderName(e.target.value)} placeholder="e.g. Jane, the storekeeper" className={field} />
      </label>
      <label className="text-sm sm:col-span-2">
        The float comes from
        <select value={from} onChange={(e) => setFrom(e.target.value as typeof from)} className={field}>
          {FROM.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={busy || !(Number(floatAmount) > 0)} className={primary}>{busy ? "Saving..." : "Create the box"}</button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}

function Pay({ box, categories, onDone, onError }: { box: Box; categories: Category[]; onDone: Done; onError: Fail }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("TRANSPORT");
  const [description, setDescription] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [withVat, setWithVat] = useState(false);
  const [taxAmount, setTaxAmount] = useState("");
  const [supplierPin, setSupplierPin] = useState("");
  const [kraInvoiceNo, setKraInvoiceNo] = useState("");
  const [busy, setBusy] = useState(false);
  const tooMuch = Number(amount) > box.balance;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiPost<{ voucherNumber: string; balance: number }>(`/petty-cash/boxes/${box.id}/pay`, {
        amount: Number(amount),
        category,
        description: description.trim(),
        receivedBy: receivedBy.trim(),
        occurredOn,
        ...(withVat && taxAmount ? { taxAmount: Number(taxAmount), supplierPin: supplierPin.trim() || undefined, kraInvoiceNo: kraInvoiceNo.trim() || undefined } : {}),
      });
      onDone(`Voucher ${r.voucherNumber}: ${kes(Number(amount))} paid to ${receivedBy.trim()}. ${kes(r.balance)} left in ${box.name}.`);
    } catch (err) {
      onError(err, "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 print:hidden">
      <h2 className="font-semibold sm:col-span-2">Pay out of {box.name} ({kes(box.balance)} in the box)</h2>
      <label className="text-sm">
        Amount (KES)
        <input required type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        {tooMuch && <span className="mt-1 block text-xs text-error-700">More than is in the box. Top it up first.</span>}
      </label>
      <label className="text-sm">
        What for
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={field}>
          {categories.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Details
        <input required minLength={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Boda to deliver to Rongo" className={field} />
      </label>
      <label className="text-sm">
        Paid to
        <input required minLength={2} maxLength={100} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} placeholder="Who took the money" className={field} />
      </label>
      <label className="text-sm">
        Date
        <input type="date" value={occurredOn} max={today()} onChange={(e) => setOccurredOn(e.target.value)} className={field} />
      </label>
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" checked={withVat} onChange={(e) => setWithVat(e.target.checked)} /> It has an eTIMS receipt with VAT
      </label>
      {withVat && (
        <>
          <label className="text-sm">
            VAT in the amount (KES)
            <input type="number" min={0} step="0.01" value={taxAmount} onChange={(e) => setTaxAmount(e.target.value)} className={field} />
          </label>
          <label className="text-sm">
            Seller&apos;s KRA PIN
            <input value={supplierPin} onChange={(e) => setSupplierPin(e.target.value)} placeholder="A123456789B" className={field} />
          </label>
          <label className="text-sm">
            eTIMS invoice number
            <input maxLength={50} value={kraInvoiceNo} onChange={(e) => setKraInvoiceNo(e.target.value)} className={field} />
          </label>
        </>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy || tooMuch || !(Number(amount) > 0) || description.trim().length < 2 || receivedBy.trim().length < 2} className={primary}>
          {busy ? "Saving..." : "Record the voucher"}
        </button>
      </div>
    </form>
  );
}

function TopUp({ box, onDone, onError }: { box: Box; onDone: Done; onError: Fail }) {
  const [amount, setAmount] = useState(box.topUpNeeded > 0 ? String(box.topUpNeeded) : "");
  const [from, setFrom] = useState<"CASH" | "MPESA" | "BANK">("CASH");
  const [occurredOn, setOccurredOn] = useState(today);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiPost<{ balance: number }>(`/petty-cash/boxes/${box.id}/top-up`, { amount: Number(amount), from, occurredOn });
      onDone(`${kes(Number(amount))} put into ${box.name}. It now holds ${kes(r.balance)}.`);
    } catch (err) {
      onError(err, "Could not record the top-up.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-3 print:hidden">
      <h2 className="font-semibold sm:col-span-3">Top up {box.name}</h2>
      <label className="text-sm">
        Amount (KES)
        <input required type="number" inputMode="decimal" min={1} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
        {box.topUpNeeded > 0 && <span className="mt-1 block text-xs text-secondary-500">{kes(box.topUpNeeded)} brings it back to its float.</span>}
      </label>
      <label className="text-sm">
        From
        <select value={from} onChange={(e) => setFrom(e.target.value as typeof from)} className={field}>
          {FROM.map(([k, l]) => (
            <option key={k} value={k}>{l}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Date
        <input type="date" value={occurredOn} max={today()} onChange={(e) => setOccurredOn(e.target.value)} className={field} />
      </label>
      <div className="sm:col-span-3">
        <button type="submit" disabled={busy || !(Number(amount) > 0)} className={primary}>{busy ? "Saving..." : "Record the top-up"}</button>
      </div>
    </form>
  );
}

function Count({ box, onDone, onError }: { box: Box; onDone: Done; onError: Fail }) {
  const [counted, setCounted] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const diff = counted === "" ? null : Math.round((Number(counted) - box.balance) * 100) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await apiPost<{ difference: number }>(`/petty-cash/boxes/${box.id}/count`, { counted: Number(counted), description: description.trim() || undefined });
      onDone(r.difference === 0 ? `${box.name} counted: correct.` : `${box.name} counted: ${kes(Math.abs(r.difference))} ${r.difference < 0 ? "short (recorded as a cost)" : "over (recorded as other income)"}.`);
    } catch (err) {
      onError(err, "Could not record the count.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 print:hidden">
      <h2 className="font-semibold sm:col-span-2">Count {box.name}</h2>
      <label className="text-sm">
        Cash counted in the box (KES)
        <input required type="number" inputMode="decimal" min={0} step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} className={field} />
        <span className="mt-1 block text-xs text-secondary-500">There should be {kes(box.balance)}.</span>
      </label>
      <label className="text-sm">
        Note <span className="text-secondary-500">(optional)</span>
        <input maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. receipt for KES 200 lost" className={field} />
      </label>
      {diff !== null && (
        <p className={`text-sm sm:col-span-2 ${diff === 0 ? "text-success-700" : "text-error-700"}`}>
          {diff === 0 ? "Correct." : `${kes(Math.abs(diff))} ${diff < 0 ? "short" : "over"}.`}
        </p>
      )}
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy || counted === ""} className={primary}>{busy ? "Saving..." : "Record the count"}</button>
      </div>
    </form>
  );
}

function BoxSettings({ box, onDone, onError }: { box: Box; onDone: Done; onError: Fail }) {
  async function change() {
    const f = window.prompt(`New float for ${box.name} (KES):`, String(box.floatAmount));
    if (!f || !(Number(f) > 0)) return;
    const holder = window.prompt("Who keeps the box?", box.holderName ?? "");
    try {
      await apiPatch(`/petty-cash/boxes/${box.id}`, { floatAmount: Number(f), ...(holder !== null ? { holderName: holder } : {}) });
      onDone("Box saved.");
    } catch (err) {
      onError(err, "Could not save the box.");
    }
  }
  async function close() {
    if (box.balance > 0 && !window.confirm(`${box.name} still holds ${kes(box.balance)}. Close it anyway? (Count it to zero first if the cash went back to the till.)`)) return;
    try {
      await apiPatch(`/petty-cash/boxes/${box.id}`, { active: false });
      onDone(`${box.name} is closed.`);
    } catch (err) {
      onError(err, "Could not close the box.");
    }
  }
  return (
    <>
      <button onClick={() => void change()} className="text-sm text-primary-600 hover:underline">Float / keeper</button>
      <button onClick={() => void close()} className="text-sm text-error-700 hover:underline">Close the box</button>
    </>
  );
}
