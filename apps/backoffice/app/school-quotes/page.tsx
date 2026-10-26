"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, apiPut, apiDelete, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

type Status = "DRAFT" | "ISSUED" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "SUPERSEDED";
interface QuoteLine {
  id: string;
  variantId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}
interface Quote {
  id: string;
  quoteNumber: string | null;
  status: Status;
  school: { id: string; name: string };
  validUntil: string | null;
  terms: string | null;
  issueDate: string | null;
  decidedBy: string | null;
  decisionNote: string | null;
  order: { id: string; orderNumber: string } | null;
  revisionOf: { id: string; quoteNumber: string | null } | null;
  lines: QuoteLine[];
  subtotal: number;
  taxAmount: number;
  total: number;
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
  taxRate: number;
}
interface Draft {
  id: string | null;
  schoolId: string;
  validUntil: string;
  terms: string;
  lines: { variantId: string; title: string; quantity: string; unitPrice: string; taxRate: number }[];
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";
const LABEL: Record<Status, string> = { DRAFT: "Draft", ISSUED: "Sent - open", ACCEPTED: "Accepted", DECLINED: "Declined", EXPIRED: "Ran out", SUPERSEDED: "Replaced" };
const TONE: Record<Status, string> = {
  DRAFT: "bg-secondary-500/20 text-secondary-500",
  ISSUED: "bg-amber-900 text-amber-200",
  ACCEPTED: "bg-green-900 text-green-200",
  DECLINED: "bg-red-950 text-red-300",
  EXPIRED: "bg-secondary-500/20 text-secondary-500",
  SUPERSEDED: "bg-secondary-500/20 text-secondary-500",
};
const FILTERS: [string, string][] = [
  ["", "All"],
  ["DRAFT", "Drafts"],
  ["ISSUED", "Open"],
  ["ACCEPTED", "Accepted"],
  ["DECLINED", "Declined"],
  ["EXPIRED", "Ran out"],
];

/** Price quotations to schools: write one, send it, and when the school accepts it becomes an order at the quoted prices. */
export default function SchoolQuotesPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState("");
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [schools, setSchools] = useState<School[]>([]);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  const load = useCallback(async () => {
    try {
      setQuotes(await apiGet<Quote[]>(`/school-supplier/quotes${filter ? `?status=${filter}` : ""}`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the quotations.");
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

  const found = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (t.length < 2) return [];
    return prices.filter((p) => p.title.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t)).slice(0, 8);
  }, [search, prices]);

  const draftTotals = useMemo(() => {
    if (!draft) return { subtotal: 0, tax: 0 };
    let subtotal = 0;
    let tax = 0;
    for (const l of draft.lines) {
      const line = Math.round(Number(l.quantity || 0) * Number(l.unitPrice || 0) * 100) / 100;
      subtotal += line;
      tax += Math.round(line * l.taxRate * 100) / 100;
    }
    return { subtotal, tax };
  }, [draft]);

  function newDraft() {
    setDraft({ id: null, schoolId: "", validUntil: "", terms: "", lines: [] });
    setSearch("");
    setNotice(null);
  }

  function editDraft(q: Quote) {
    setDraft({
      id: q.id,
      schoolId: q.school.id,
      validUntil: q.validUntil ?? "",
      terms: q.terms ?? "",
      lines: q.lines.map((l) => ({ variantId: l.variantId, title: l.description, quantity: String(l.quantity), unitPrice: String(l.unitPrice), taxRate: l.taxRate })),
    });
    setSearch("");
    setNotice(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addLine(p: PriceRow) {
    setDraft((d) => (d && !d.lines.some((l) => l.variantId === p.variantId) ? { ...d, lines: [...d.lines, { variantId: p.variantId, title: p.title, quantity: "1", unitPrice: String(p.schoolPrice ?? p.price), taxRate: p.taxRate }] } : d));
    setSearch("");
  }

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        schoolId: draft.schoolId,
        validUntil: draft.validUntil || undefined,
        terms: draft.terms.trim() || undefined,
        lines: draft.lines.map((l) => ({ variantId: l.variantId, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice) })),
      };
      if (draft.id) await apiPut(`/school-supplier/quotes/${draft.id}`, body);
      else await apiPost("/school-supplier/quotes", body);
      setNotice("Saved as a draft. Open it and press Send to the school when it is ready.");
      setDraft(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save it.");
    } finally {
      setBusy(false);
    }
  }

  async function act(path: string, body: unknown, done: string, method: "post" | "delete" = "post") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (method === "delete") await apiDelete(path);
      else await apiPost(path, body);
      setNotice(done);
      await load();
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
          <h1 className="text-xl font-bold">School quotations</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/school-orders" className="text-primary-600 hover:underline">School orders</Link>
            <Link href="/schools" className="text-primary-600 hover:underline">Schools</Link>
            <Link href="/school-money" className="text-primary-600 hover:underline">Invoices &amp; payments</Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">Quote a school, send it, and when the school accepts it (in its portal, or you record that it did by phone or LPO) an order is made at the quoted prices. You then confirm and deliver as usual.</p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {canEdit && !draft && (
          <button onClick={newDraft} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">New quotation</button>
        )}

        {draft && (
          <section className="space-y-3 rounded-lg border border-primary-600 bg-surface p-4 text-sm">
            <h2 className="font-semibold">{draft.id ? "Change the draft" : "New quotation"}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                For which school?
                <select value={draft.schoolId} onChange={(e) => setDraft({ ...draft, schoolId: e.target.value })} className={field}>
                  <option value="">Choose...</option>
                  {schools.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Open until <span className="text-secondary-500">(blank = 30 days from sending)</span>
                <input type="date" value={draft.validUntil} onChange={(e) => setDraft({ ...draft, validUntil: e.target.value })} className={field} />
              </label>
            </div>

            <div>
              <label className="block">
                Add an item
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type part of a name or code" className={field} />
              </label>
              {found.length > 0 && (
                <ul className="mt-1 rounded-md border border-border bg-surface">
                  {found.map((p) => (
                    <li key={p.variantId}>
                      <button onClick={() => addLine(p)} className="flex w-full justify-between p-2 text-left hover:bg-secondary-500/10">
                        <span>{p.title} <span className="text-xs text-secondary-500">{p.sku}</span></span>
                        <span className="font-mono text-xs">{(p.schoolPrice ?? p.price).toFixed(2)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {draft.lines.length > 0 && (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs uppercase text-secondary-500">
                    <th className="py-1">Item</th>
                    <th className="py-1 text-right">Quantity</th>
                    <th className="py-1 text-right">Price before VAT</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l) => (
                    <tr key={l.variantId} className="border-t border-border">
                      <td className="py-1">{l.title}</td>
                      <td className="py-1 text-right">
                        <input type="number" min={0.001} step="any" value={l.quantity} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x) => (x.variantId === l.variantId ? { ...x, quantity: e.target.value } : x)) })} className="w-24 rounded-md border border-border bg-surface p-1 text-right" />
                      </td>
                      <td className="py-1 text-right">
                        <input type="number" min={0} step="0.01" value={l.unitPrice} onChange={(e) => setDraft({ ...draft, lines: draft.lines.map((x) => (x.variantId === l.variantId ? { ...x, unitPrice: e.target.value } : x)) })} className="w-28 rounded-md border border-border bg-surface p-1 text-right" />
                      </td>
                      <td className="py-1 text-right">
                        <button onClick={() => setDraft({ ...draft, lines: draft.lines.filter((x) => x.variantId !== l.variantId) })} className="text-error-600 hover:underline">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {draft.lines.length > 0 && (
              <p className="text-right text-xs text-secondary-500">
                Before VAT {kes(draftTotals.subtotal)} · VAT {kes(draftTotals.tax)} · <span className="font-semibold text-foreground">Total {kes(draftTotals.subtotal + draftTotals.tax)}</span>
              </p>
            )}

            <label className="block">
              Terms <span className="text-secondary-500">(optional, printed on the quotation)</span>
              <textarea rows={3} maxLength={1000} value={draft.terms} onChange={(e) => setDraft({ ...draft, terms: e.target.value })} className={field} />
            </label>
            <div className="flex gap-2">
              <button disabled={busy || !draft.schoolId || draft.lines.length === 0 || draft.lines.some((l) => !(Number(l.quantity) > 0))} onClick={() => void save()} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Saving..." : "Save draft"}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-500/10">Cancel</button>
            </div>
          </section>
        )}

        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([key, label]) => (
            <button key={label} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 text-sm ${filter === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
              {label}
            </button>
          ))}
        </div>
        {!quotes && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {quotes && quotes.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No quotations here.</p>}

        <ul className="space-y-3">
          {quotes?.map((q) => (
            <li key={q.id} className="rounded-lg border border-border bg-surface">
              <button onClick={() => setOpenId(openId === q.id ? null : q.id)} className="flex w-full flex-wrap items-start justify-between gap-2 p-3 text-left">
                <div>
                  <p className="font-semibold">
                    {q.school.name} <span className="font-mono text-xs text-secondary-500">{q.quoteNumber ?? "draft"}</span>
                  </p>
                  <p className="text-xs text-secondary-500">
                    {q.issueDate ? `Sent ${q.issueDate}` : "Not sent yet"}
                    {q.validUntil ? ` · open until ${q.validUntil}` : ""}
                    {q.revisionOf ? ` · replaces ${q.revisionOf.quoteNumber ?? "an earlier draft"}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`rounded px-2 py-0.5 text-xs ${TONE[q.status]}`}>{LABEL[q.status]}</span>
                  <p className="mt-1 font-mono font-semibold">{kes(q.total)}</p>
                </div>
              </button>
              {openId === q.id && (
                <div className="space-y-3 border-t border-border p-3 text-sm">
                  <table className="w-full">
                    <tbody>
                      {q.lines.map((l) => (
                        <tr key={l.id} className="border-t border-border first:border-t-0">
                          <td className="py-1">{l.description}</td>
                          <td className="py-1 text-right">{l.quantity}</td>
                          <td className="py-1 text-right font-mono">{l.unitPrice.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {q.terms && <p className="whitespace-pre-line text-secondary-600">{q.terms}</p>}
                  {q.status === "DECLINED" && <p className="text-secondary-600">Declined by {q.decidedBy === "SCHOOL" ? "the school" : "you"}{q.decisionNote ? `: ${q.decisionNote}` : ""}</p>}
                  {q.order && (
                    <p className="text-secondary-600">
                      Became order <Link href="/school-orders" className="text-primary-600 hover:underline">{q.order.orderNumber}</Link> ({q.decidedBy === "SCHOOL" ? "the school accepted it" : "you recorded the acceptance"}).
                    </p>
                  )}
                  <div className="flex flex-wrap gap-4">
                    <Link href={`/school-print/quote/${q.id}`} target="_blank" className="text-primary-600 hover:underline">Print</Link>
                    {canEdit && q.status === "DRAFT" && (
                      <>
                        <button onClick={() => editDraft(q)} className="text-primary-600 hover:underline">Change</button>
                        <button disabled={busy} onClick={() => void act(`/school-supplier/quotes/${q.id}/issue`, {}, `Quotation sent to ${q.school.name}.`)} className="font-semibold text-primary-600 hover:underline">Send to the school</button>
                        <button disabled={busy} onClick={() => window.confirm("Delete this draft?") && void act(`/school-supplier/quotes/${q.id}`, {}, "Draft deleted.", "delete")} className="text-error-600 hover:underline">Delete</button>
                      </>
                    )}
                    {canEdit && q.status === "ISSUED" && (
                      <>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const lpo = window.prompt("The school said yes. Their LPO number (leave empty if none):", "");
                            if (lpo === null) return;
                            void act(`/school-supplier/quotes/${q.id}/accept`, { lpoNumber: lpo.trim() || undefined }, "Recorded. An order was made at the quoted prices - open School orders to confirm it.");
                          }}
                          className="text-primary-600 hover:underline"
                        >
                          They accepted (by phone / LPO)
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => {
                            const why = window.prompt("The school said no. Why? (optional)", "");
                            if (why === null) return;
                            void act(`/school-supplier/quotes/${q.id}/decline`, { reason: why.trim() || undefined }, "Marked as declined.");
                          }}
                          className="text-error-600 hover:underline"
                        >
                          They declined
                        </button>
                      </>
                    )}
                    {canEdit && (q.status === "ISSUED" || q.status === "DECLINED" || q.status === "EXPIRED") && (
                      <button disabled={busy} onClick={() => void act(`/school-supplier/quotes/${q.id}/revise`, {}, "A new draft was made from it. Change it, then send it - the old one is then marked as replaced.")} className="text-primary-600 hover:underline">Revise</button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
