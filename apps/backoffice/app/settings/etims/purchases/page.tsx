"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";

type Status = "WAITING" | "ACCEPTED" | "DISMISSED";
interface Suggested {
  variantId: string;
  name: string;
  sku: string;
  registered: boolean;
}
interface InvoiceLine {
  itemSeq: number;
  itemCd: string;
  name: string;
  qty: number;
  price: number;
  total: number;
  suggested: Suggested | null;
}
interface Invoice {
  id: string;
  status: Status;
  supplierPin: string;
  supplierName: string | null;
  knownSupplier: string | null;
  invoiceNo: number;
  kind: "INVOICE" | "CREDIT_NOTE";
  date: string | null;
  total: number;
  lines: InvoiceLine[];
}
interface Listing {
  counts: Record<Status, number>;
  total: number;
  rows: Invoice[];
}
interface Receipt {
  id: string;
  receiptNumber: string;
  createdAt: string;
  supplierName: string | null;
  supplierPin: string | null;
  deliveryNote: string | null;
  lines: number;
  value: number;
  missingPrices: number;
  reported: "PENDING" | "SENT" | "REJECTED" | "MANUAL" | null;
}
interface Item {
  variantId: string;
  name: string;
  sku: string;
}

const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const field = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const explain = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const LABEL: Record<Status, string> = { WAITING: "Waiting for you", ACCEPTED: "Accepted", DISMISSED: "Put aside" };

/** Finds one of our products that KRA already has, by name, code or barcode, for matching a supplier's line to it. */
function ProductPicker({ onPick }: { onPick: (item: Item) => void }) {
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Item[]>([]);
  useEffect(() => {
    if (term.trim().length < 2) return void setFound([]);
    const handle = setTimeout(() => {
      apiGet<{ rows: Item[] }>(`/etims/items?search=${encodeURIComponent(term.trim())}&state=REGISTERED`)
        .then((r) => setFound(r.rows.slice(0, 6)))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [term]);
  return (
    <div className="space-y-1">
      <input className={field} placeholder="Search our products (registered with KRA)" value={term} onChange={(e) => setTerm(e.target.value)} />
      {found.length > 0 && (
        <ul className="rounded-md border border-border bg-surface text-sm">
          {found.map((f) => (
            <li key={f.variantId}>
              <button className="w-full p-2 text-left hover:bg-secondary-500/10" onClick={() => { onPick(f); setTerm(""); setFound([]); }}>
                {f.name} <span className="text-xs text-secondary-500">{f.sku}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Purchases and KRA: the supplier invoices KRA holds for this business, matched to our products and accepted, and deliveries reported by hand. */
export default function EtimsPurchasesPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Listing | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [status, setStatus] = useState<Status>("WAITING");
  const [matches, setMatches] = useState<Record<string, Record<number, Item>>>({});
  const [deliveryFor, setDeliveryFor] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([apiGet<Listing>(`/etims/purchases?status=${status}`), apiGet<Receipt[]>("/etims/purchases/receipts")]);
      setData(l);
      setReceipts(r);
      setError(null);
    } catch (e) {
      setError(explain(e, "Could not load purchases."));
    }
  }, [status]);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (e) {
      setError(explain(e, "That did not work."));
    } finally {
      setBusy(null);
      await load();
    }
  }

  if (!session) return null;
  const canWrite = session.role === "MANAGER" || session.role === "OWNER";
  /** What a line is matched to: the owner's choice, else the suggestion. */
  const chosen = (inv: Invoice, l: InvoiceLine): { variantId: string; name: string; registered: boolean } | null => {
    const m = matches[inv.id]?.[l.itemSeq];
    if (m) return { variantId: m.variantId, name: m.name, registered: true };
    return l.suggested ? { variantId: l.suggested.variantId, name: l.suggested.name, registered: l.suggested.registered } : null;
  };
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Purchases and KRA</h1>
          <div className="flex gap-2">
            <Link href="/settings/etims/documents" className={ghost}>Sales sent to KRA</Link>
            <Link href="/settings/etims" className={ghost}>eTIMS connection</Link>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">
          A supplier who is on eTIMS tells KRA about every sale to you. Here you download those invoices, say which of your products each line is, and accept them - that confirms the purchase to KRA (the test system for now). Receiving the goods is still done under Goods received; the stock that comes in is reported by itself.
        </p>

        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Supplier invoices on KRA</h2>
            {canWrite && (
              <button className={primary} disabled={busy !== null} onClick={() => void act("sync", async () => {
                const r = await apiPost<{ downloaded: number; stopped: string | null }>("/etims/purchases/sync", {});
                return r.stopped ? `Stopped: ${r.stopped}` : r.downloaded > 0 ? `Downloaded ${r.downloaded} new invoice${r.downloaded === 1 ? "" : "s"}.` : "Nothing new at KRA.";
              })}>{busy === "sync" ? "Downloading..." : "Download from KRA"}</button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {(["WAITING", "ACCEPTED", "DISMISSED"] as Status[]).map((s) => (
              <button key={s} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary-500 bg-primary-600/20" : "border-border"}`} onClick={() => setStatus(s)}>
                {LABEL[s]}{data ? ` (${data.counts[s]})` : ""}
              </button>
            ))}
          </div>
          {data && data.rows.length === 0 && <p className="text-sm text-secondary-500">Nothing here.</p>}
          {data?.rows.map((inv) => {
            const allMatched = inv.lines.every((l) => chosen(inv, l)?.registered);
            const mine = receipts.filter((r) => r.supplierPin === inv.supplierPin);
            return (
              <div key={inv.id} className="space-y-2 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <p>
                    <strong>{inv.knownSupplier ?? inv.supplierName ?? inv.supplierPin}</strong> · invoice {inv.invoiceNo}
                    {inv.date ? ` · ${inv.date.slice(0, 4)}-${inv.date.slice(4, 6)}-${inv.date.slice(6, 8)}` : ""} · <strong>KES {money(inv.total)}</strong>
                    {inv.kind === "CREDIT_NOTE" && <span className="ml-2 rounded bg-secondary-500/15 px-2 py-0.5 text-xs">Supplier credit note</span>}
                  </p>
                  <span className="text-xs text-secondary-500">{inv.supplierPin}{inv.knownSupplier ? "" : " · not in your suppliers list (add the PIN on Suppliers)"}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-secondary-500">
                      <tr><th className="py-1 pr-2">Their item</th><th className="py-1 pr-2">Qty</th><th className="py-1 pr-2">Total</th><th className="py-1">Our product</th></tr>
                    </thead>
                    <tbody>
                      {inv.lines.map((l) => {
                        const c = chosen(inv, l);
                        return (
                          <tr key={l.itemSeq} className="border-t border-border align-top">
                            <td className="py-2 pr-2">{l.name}<span className="block text-xs text-secondary-500">{l.itemCd}</span></td>
                            <td className="py-2 pr-2">{l.qty}</td>
                            <td className="py-2 pr-2 font-mono">{money(l.total)}</td>
                            <td className="py-2">
                              {c ? (
                                <p className="text-sm">{c.name}{!c.registered && <span className="ml-1 text-xs text-amber-400">(not registered with KRA yet)</span>}</p>
                              ) : (
                                <p className="text-xs text-amber-400">Not matched yet</p>
                              )}
                              {inv.status === "WAITING" && inv.kind === "INVOICE" && canWrite && (
                                <ProductPicker onPick={(item) => setMatches({ ...matches, [inv.id]: { ...(matches[inv.id] ?? {}), [l.itemSeq]: item } })} />
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {inv.status === "WAITING" && canWrite && (
                  <div className="flex flex-wrap items-center gap-2">
                    {inv.kind === "INVOICE" && (
                      <>
                        {mine.length > 0 && (
                          <select className="rounded-md border border-border bg-surface p-2 text-sm" value={deliveryFor[inv.id] ?? ""} onChange={(e) => setDeliveryFor({ ...deliveryFor, [inv.id]: e.target.value })}>
                            <option value="">Delivery it is for (optional)</option>
                            {mine.map((r) => <option key={r.id} value={r.id}>{r.receiptNumber} · KES {money(r.value)}</option>)}
                          </select>
                        )}
                        <button className={primary} disabled={busy !== null || !allMatched} onClick={() => void act(inv.id, async () => {
                          await apiPost(`/etims/purchases/${inv.id}/accept`, {
                            lines: inv.lines.map((l) => ({ itemSeq: l.itemSeq, variantId: chosen(inv, l)!.variantId })),
                            ...(deliveryFor[inv.id] ? { goodsReceiptId: deliveryFor[inv.id] } : {}),
                          });
                          return "Accepted. It will be sent to KRA in a minute (or press Send now on the Sales sent to KRA page).";
                        })}>Accept and confirm to KRA</button>
                      </>
                    )}
                    <button className={ghost} disabled={busy !== null} onClick={() => void act(`d-${inv.id}`, async () => { await apiPost(`/etims/purchases/${inv.id}/dismiss`, {}); return "Put aside. KRA was told nothing."; })}>Put aside</button>
                    {inv.kind === "INVOICE" && !allMatched && <span className="text-xs text-secondary-500">Match every line to a product that is registered with KRA to accept.</span>}
                    {inv.kind === "CREDIT_NOTE" && <span className="text-xs text-secondary-500">A supplier&apos;s credit note is confirmed on the KRA portal.</span>}
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <h2 className="font-semibold">Deliveries to report by hand</h2>
          <p className="text-sm text-secondary-500">For a supplier who is not on eTIMS. The delivery&apos;s prices are taken as before tax, with the product&apos;s tax added on top. The supplier needs a KRA PIN on the Suppliers screen. Only deliveries received after sending to KRA was switched on are listed.</p>
          {receipts.length === 0 && <p className="text-sm text-secondary-500">No deliveries yet.</p>}
          {receipts.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm">
              <p>
                <strong>{r.receiptNumber}</strong> · {r.supplierName ?? "no supplier"} · {r.lines} product{r.lines === 1 ? "" : "s"} · KES {money(r.value)}
                {r.missingPrices > 0 && <span className="ml-2 text-xs text-amber-400">{r.missingPrices} line(s) have no price</span>}
                {!r.supplierPin && <span className="ml-2 text-xs text-amber-400">supplier has no KRA PIN</span>}
              </p>
              {r.reported ? (
                <span className="rounded bg-green-950 px-2 py-0.5 text-xs text-green-300">{r.reported === "SENT" ? "Reported to KRA" : r.reported === "PENDING" ? "Waiting to be sent" : r.reported === "REJECTED" ? "Refused by KRA" : "Do by hand"}</span>
              ) : (
                canWrite && <button className={ghost} disabled={busy !== null || !r.supplierPin || r.missingPrices > 0} onClick={() => void act(r.id, async () => { await apiPost(`/etims/purchases/receipts/${r.id}/report`, {}); return "Queued. It will be sent to KRA in a minute."; })}>Report to KRA</button>
              )}
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
