"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";

type Status = "PENDING" | "SENT" | "REJECTED" | "MANUAL";
interface Doc {
  id: string;
  kind: "SALE" | "CREDIT_NOTE" | "PURCHASE" | "STOCK_MOVE";
  saleId: string | null;
  /** For a stock movement: KRA's movement type. */
  movement: string | null;
  status: Status;
  invcNo: number | null;
  steps: { sale: boolean; stock: boolean; stockLevels: boolean };
  curRcptNo: number | null;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string | null;
  sentAt: string | null;
  createdAt: string;
}
interface Listing {
  counts: Record<Status, number>;
  total: number;
  page: number;
  pageSize: number;
  rows: Doc[];
}

const ghost = "rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";
const explain = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);
const LABEL: Record<Status, string> = { PENDING: "Waiting", SENT: "Sent", REJECTED: "Refused by KRA", MANUAL: "Do by hand" };
const TONE: Record<Status, string> = {
  PENDING: "bg-amber-950 text-amber-200",
  SENT: "bg-green-950 text-green-300",
  REJECTED: "bg-red-950 text-red-300",
  MANUAL: "bg-secondary-500/15",
};
const MOVEMENT: Record<string, string> = {
  "02": "Delivery from a supplier",
  "03": "Returned to stock",
  "04": "Transfer in",
  "05": "Made in production or repacking",
  "06": "Stock added (adjustment)",
  "12": "Returned to the supplier",
  "13": "Transfer out",
  "14": "Used in production or repacking",
  "15": "Thrown away",
  "16": "Stock taken off (adjustment)",
};
const STATES: Status[] = ["PENDING", "REJECTED", "MANUAL", "SENT"];

/** What has been sent to KRA: each sale and credit note, where it has got to, and why anything is stuck. */
export default function EtimsDocumentsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [data, setData] = useState<Listing | null>(null);
  const [status, setStatus] = useState<Status | "">("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ page: String(page) });
      if (status) qs.set("status", status);
      setData(await apiGet<Listing>(`/etims/documents?${qs}`));
      setError(null);
    } catch (e) {
      setError(explain(e, "Could not load the documents."));
    }
  }, [status, page]);

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
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Sales sent to KRA</h1>
          <div className="flex gap-2">
            <Link href="/settings/etims/purchases" className={ghost}>Purchases</Link>
            <Link href="/settings/etims" className={ghost}>eTIMS connection</Link>
          </div>
        </div>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        <p className="text-sm text-secondary-500">Every sale made since sending was switched on, every refund of a whole sale, every purchase you confirm, and every stock movement that is not a sale (adjustments, waste, transfers, repacking, production, deliveries) appears here. Sending happens by itself every minute; a document that could not be sent is tried again with longer waits in between. This is KRA&apos;s <strong>test</strong> system.</p>

        {data && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button className={`rounded-md border px-3 py-1.5 text-sm ${status === "" ? "border-primary-500 bg-primary-600/20" : "border-border"}`} onClick={() => { setStatus(""); setPage(1); }}>All</button>
              {STATES.map((s) => (
                <button key={s} className={`rounded-md border px-3 py-1.5 text-sm ${status === s ? "border-primary-500 bg-primary-600/20" : "border-border"}`} onClick={() => { setStatus(s); setPage(1); }}>
                  {LABEL[s]} ({data.counts[s]})
                </button>
              ))}
              {canWrite && (
                <button className={`${primary} ml-auto`} disabled={busy !== null} onClick={() => void act("run", async () => {
                  const r = await apiPost<{ queued: number; sent: number; rejected: number; waiting: number; stopped: string | null }>("/etims/documents/run", {});
                  return r.stopped ? `Stopped: ${r.stopped}` : `Picked up ${r.queued} new, sent ${r.sent}, refused ${r.rejected}, still waiting ${r.waiting}.`;
                })}>{busy === "run" ? "Sending..." : "Send now"}</button>
              )}
            </div>

            {data.rows.length === 0 ? (
              <p className="rounded-lg border border-border p-4 text-sm text-secondary-500">Nothing here yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-xs text-secondary-500">
                    <tr>
                      <th className="p-3">When</th>
                      <th className="p-3">What</th>
                      <th className="p-3">KRA number</th>
                      <th className="p-3">Progress</th>
                      <th className="p-3">State</th>
                      <th className="p-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((d) => (
                      <tr key={d.id} className="border-t border-border align-top">
                        <td className="p-3 whitespace-nowrap">{new Date(d.createdAt).toLocaleString()}</td>
                        <td className="p-3">
                          {d.saleId ? (
                            <Link href={`/sales/${d.saleId}`} className="text-primary-400 hover:underline">{d.kind === "SALE" ? "Sale" : "Credit note"}</Link>
                          ) : d.kind === "PURCHASE" ? (
                            <Link href="/settings/etims/purchases" className="text-primary-400 hover:underline">Purchase</Link>
                          ) : (
                            <span>Stock: {MOVEMENT[d.movement ?? ""] ?? "movement"}</span>
                          )}
                        </td>
                        <td className="p-3 font-mono">{d.invcNo ?? "-"}</td>
                        <td className="p-3 text-xs text-secondary-500">
                          {d.steps.sale ? "sale ✓" : "sale -"} · {d.steps.stock ? "stock ✓" : "stock -"} · {d.steps.stockLevels ? "levels ✓" : "levels -"}
                        </td>
                        <td className="p-3">
                          <span className={`rounded px-2 py-0.5 text-xs ${TONE[d.status]}`}>{LABEL[d.status]}</span>
                          {d.lastError && d.status !== "SENT" && <p className="mt-1 max-w-xs text-xs text-secondary-500">{d.lastError}</p>}
                          {d.status === "PENDING" && d.attempts > 0 && d.nextAttemptAt && <p className="mt-1 text-xs text-secondary-500">Next try {new Date(d.nextAttemptAt).toLocaleTimeString()}</p>}
                        </td>
                        <td className="p-3 text-right">
                          {canWrite && d.status === "REJECTED" && (
                            <button className={ghost} disabled={busy !== null} onClick={() => void act(d.id, async () => { await apiPost(`/etims/documents/${d.id}/retry`, {}); return "Put back in the queue."; })}>Try again</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <button className={ghost} disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
                <span className="text-secondary-500">Page {page} of {pages}</span>
                <button className={ghost} disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
            <p className="text-xs text-secondary-500">&quot;Do by hand&quot; means this system cannot send it by itself - for example a refund of only part of a sale. Issue that credit note on the KRA eTIMS portal.</p>
          </>
        )}
      </main>
    </div>
  );
}
