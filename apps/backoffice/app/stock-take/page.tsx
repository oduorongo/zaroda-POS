"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { BarcodeScanner } from "../../components/barcode-scanner";
import { useScanner } from "../../hooks/use-scanner";
import { findByCode } from "../../lib/barcode";
import { variantLabel } from "../../lib/variant-label";

interface Branch {
  id: string;
  name: string;
}
interface Line {
  id: string;
  variantId: string;
  systemQuantity: string;
  countedQuantity: string | null;
  variance: string | null;
  variant: { id: string; sku: string; name?: string | null; barcode?: string | null; quantityMode: "COUNT" | "WEIGHT"; product: { name: string } };
}
interface StockTake {
  id: string;
  branchId: string;
  status: "OPEN" | "COMPLETED";
  createdAt: string;
  completedAt: string | null;
  lines: Line[];
}
interface StockTakeSummary {
  id: string;
  branchId: string;
  status: "OPEN" | "COMPLETED";
  createdAt: string;
  completedAt: string | null;
}

const num = (v: string | number | null) => (v === null ? null : Number(v));
const when = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * Counting the shelves. Start a count for a branch, then scan each item (camera or scanner gun) - every scan adds one to
 * that item's count - or type the number you counted. Finishing turns the differences between what you counted and what the
 * system expected into stock adjustments. Items you did not count are left alone.
 */
export default function StockTakePage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [history, setHistory] = useState<StockTakeSummary[]>([]);
  const [take, setTake] = useState<StockTake | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [filter, setFilter] = useState<"all" | "todo" | "different">("all");
  const [highlight, setHighlight] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  // Counts are sent one after another, so a fast run of scans can never arrive out of order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const loadHistory = useCallback(async (forBranch: string) => {
    if (!forBranch) return;
    try {
      setHistory(await apiGet<StockTakeSummary[]>(`/stock-takes?branchId=${forBranch}`));
    } catch {
      /* informational */
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
    setSession(s);
    void apiGet<Branch[]>("/branches")
      .then((b) => {
        setBranches(b);
        setBranchId((current) => current || b[0]?.id || "");
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your branches."));
  }, [router]);

  useEffect(() => {
    setTake(null);
    void loadHistory(branchId);
  }, [branchId, loadHistory]);

  async function open(id: string) {
    setBusy(true);
    setError(null);
    try {
      setTake(await apiGet<StockTake>(`/stock-takes/${id}`));
      setNote(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not open that count.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<StockTake>("/stock-takes", { branchId });
      setTake(created);
      setNote(created.lines.length === 0 ? "This branch has no stock on record yet, so there is nothing to count. Receive some stock first." : null);
      await loadHistory(branchId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start the count.");
    } finally {
      setBusy(false);
    }
  }

  // Set one line's counted quantity: shown at once, then saved in order.
  function setCount(line: Line, counted: number) {
    if (!take || take.status !== "OPEN") return;
    const variance = counted - Number(line.systemQuantity);
    setTake((t) => t && { ...t, lines: t.lines.map((l) => (l.id === line.id ? { ...l, countedQuantity: String(counted), variance: String(variance) } : l)) });
    const takeId = take.id;
    queue.current = queue.current
      .then(() => apiPatch(`/stock-takes/${takeId}/lines/${line.id}`, { countedQuantity: counted }))
      .catch((err) => setError(err instanceof ApiError ? err.message : "A count could not be saved - check your connection."));
  }

  const lines = take?.lines ?? [];
  function onScanned(code: string) {
    if (!take || take.status !== "OPEN") return;
    const match = findByCode(
      lines.map((l) => ({ ...l.variant, lineId: l.id })),
      code,
    );
    if (!match) {
      setNote(`Nothing in this count has the barcode ${code}. It may not have a barcode yet, or has no stock recorded at this branch.`);
      return;
    }
    const line = lines.find((l) => l.id === match.lineId)!;
    setScanOpen(false);
    setHighlight(line.id);
    if (line.variant.quantityMode === "WEIGHT") {
      setNote(`${variantLabel(line.variant.product.name, line.variant)} is counted by weight - type what you counted.`);
      inputs.current[line.id]?.focus();
      inputs.current[line.id]?.select();
      return;
    }
    const next = (num(line.countedQuantity) ?? 0) + 1;
    setCount(line, next);
    setNote(`${variantLabel(line.variant.product.name, line.variant)}: ${next} counted`);
  }
  useScanner(onScanned, Boolean(take && take.status === "OPEN") && !scanOpen);

  async function finish() {
    if (!take) return;
    const counted = lines.filter((l) => l.countedQuantity !== null);
    const different = counted.filter((l) => Number(l.variance) !== 0);
    const message = `Finish this count?\n\n${counted.length} of ${lines.length} items counted.\n${different.length} ${different.length === 1 ? "difference" : "differences"} will be applied to your stock.\nItems you did not count are left as they are.`;
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    try {
      await queue.current; // let the last counts reach the server first
      setTake(await apiPatch<StockTake>(`/stock-takes/${take.id}/complete`, {}));
      setNote("Count finished. Your stock now matches what you counted.");
      await loadHistory(branchId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not finish the count.");
    } finally {
      setBusy(false);
    }
  }

  const stats = useMemo(() => {
    const counted = lines.filter((l) => l.countedQuantity !== null);
    return { counted: counted.length, different: counted.filter((l) => Number(l.variance) !== 0).length };
  }, [lines]);

  const shown = useMemo(
    () =>
      lines
        .filter((l) => (filter === "todo" ? l.countedQuantity === null : filter === "different" ? l.countedQuantity !== null && Number(l.variance) !== 0 : true))
        .sort((a, b) => variantLabel(a.variant.product.name, a.variant).localeCompare(variantLabel(b.variant.product.name, b.variant))),
    [lines, filter],
  );

  if (!session) return null;
  const open_ = take?.status === "OPEN";
  const openForBranch = history.find((h) => h.status === "OPEN");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-bold">Stock count</h1>
        <p className="text-sm text-secondary-500">Walk the shelves, scan each item and the system counts it for you. When you finish, any difference between what you counted and what the system expected is corrected in your stock.</p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        {!take && (
          <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <label className="block text-sm">
              Branch
              <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="mt-1 block w-full max-w-xs rounded-md border border-border bg-background p-2 text-sm">
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            {openForBranch ? (
              <div className="rounded-md bg-amber-500/10 p-3 text-sm">
                A count started {when(openForBranch.createdAt)} is still open.
                <button onClick={() => void open(openForBranch.id)} disabled={busy} className="ml-3 rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  Continue counting
                </button>
              </div>
            ) : (
              <button onClick={() => void start()} disabled={busy || !branchId} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? "Starting..." : "Start a new count"}
              </button>
            )}
            {history.filter((h) => h.status === "COMPLETED").length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold text-secondary-500">Earlier counts</p>
                <ul className="divide-y divide-border text-sm">
                  {history
                    .filter((h) => h.status === "COMPLETED")
                    .slice(0, 8)
                    .map((h) => (
                      <li key={h.id} className="flex items-center justify-between py-1.5">
                        <span>{when(h.completedAt ?? h.createdAt)}</span>
                        <button onClick={() => void open(h.id)} className="text-xs text-primary-600 hover:underline">
                          View
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {take && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm">
                {open_ ? "Counting" : `Finished ${when(take.completedAt ?? take.createdAt)}`} - <strong>{stats.counted}</strong> of {lines.length} items counted, <strong>{stats.different}</strong> {stats.different === 1 ? "difference" : "differences"}
              </p>
              <div className="flex gap-2">
                <button onClick={() => setTake(null)} className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary-500/10">
                  Back
                </button>
                {open_ && (
                  <button onClick={() => void finish()} disabled={busy || stats.counted === 0} className="rounded-md bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    Finish the count
                  </button>
                )}
              </div>
            </div>

            {open_ && (
              <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    autoFocus
                    placeholder="Scan here, or type a barcode or code and press Enter"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && typed.trim()) {
                        e.preventDefault();
                        onScanned(typed.trim());
                        setTyped("");
                      }
                    }}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background p-2 text-sm"
                  />
                  <button onClick={() => setScanOpen(true)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-secondary-500/10">
                    Camera
                  </button>
                </div>
                <p className="text-xs text-secondary-500">With a scanner gun you can just scan - no need to click first. Each scan counts one more.</p>
                {note && <p className="text-sm text-primary-600">{note}</p>}
              </div>
            )}
            {scanOpen && <BarcodeScanner onDetected={onScanned} onClose={() => setScanOpen(false)} />}

            <div className="flex gap-2 text-sm">
              {([["all", "Everything"], ["todo", "Not counted yet"], ["different", "Differences"]] as const).map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} className={`rounded-full border px-3 py-1 ${filter === key ? "border-primary-600 bg-primary-600 text-white" : "border-border hover:bg-secondary-500/10"}`}>
                  {label}
                </button>
              ))}
            </div>

            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {shown.length === 0 && <li className="p-4 text-sm text-secondary-500">Nothing to show here.</li>}
              {shown.map((l) => {
                const variance = num(l.variance);
                return (
                  <li key={l.id} className={`flex flex-wrap items-center justify-between gap-2 p-3 text-sm ${highlight === l.id ? "bg-primary-600/10" : ""}`}>
                    <div className="min-w-0">
                      <p className="font-medium">{variantLabel(l.variant.product.name, l.variant)}</p>
                      <p className="text-xs text-secondary-500">The system expected {Number(l.systemQuantity)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {open_ ? (
                        <input
                          ref={(el) => {
                            inputs.current[l.id] = el;
                          }}
                          type="number"
                          min={0}
                          step={l.variant.quantityMode === "WEIGHT" ? "0.001" : "1"}
                          inputMode="decimal"
                          placeholder="counted"
                          defaultValue={l.countedQuantity === null ? "" : String(Number(l.countedQuantity))}
                          key={`${l.id}-${l.countedQuantity}`}
                          onBlur={(e) => {
                            const value = e.target.value.trim();
                            if (value !== "" && Number(value) !== num(l.countedQuantity) && Number.isFinite(Number(value)) && Number(value) >= 0) setCount(l, Number(value));
                          }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          className="w-24 rounded-md border border-border bg-background p-1.5 text-right text-sm"
                        />
                      ) : (
                        <span className="font-mono">{l.countedQuantity === null ? "not counted" : Number(l.countedQuantity)}</span>
                      )}
                      {variance !== null && variance !== 0 && (
                        <span className={`w-16 text-right font-mono text-xs font-semibold ${variance < 0 ? "text-red-600" : "text-green-600"}`}>
                          {variance > 0 ? "+" : ""}
                          {variance}
                        </span>
                      )}
                      {variance === 0 && <span className="w-16 text-right text-xs text-secondary-500">matches</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </main>
    </div>
  );
}
