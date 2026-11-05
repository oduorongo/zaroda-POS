"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, LoadingState } from "@zaroda/ui";
import { apiGet, apiPost, apiPut, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

interface Rate {
  industryType: string;
  size: string;
  minKes: number;
  maxKes: number;
}
interface Fee {
  id: string;
  business: string;
  agent: string;
  industryType: string;
  size: string;
  amountKes: number;
  receiptNo: string;
  note: string | null;
  receivedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
interface Overview {
  month: string;
  rates: Rate[];
  totalKes: number;
  byAgent: { agentId: string; fullName: string; team: string; count: number; totalKes: number }[];
  fees: Fee[];
}

const TYPES = [
  ["ANY", "Any business (default)"],
  ["RETAIL", "Retail / supermarket"],
  ["RESTAURANT", "Restaurant"],
  ["PHARMACY", "Pharmacy"],
  ["SALON", "Salon / spa"],
  ["HOTEL", "Hotel / lodge"],
  ["SCHOOL_SUPPLIER", "School supplier"],
  ["RENTAL", "Rentals / landlord"],
  ["CONSTRUCTION", "Construction"],
] as const;
const SIZES = ["SMALL", "MEDIUM", "LARGE"];
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const typeLabel = (t: string) => TYPES.find(([v]) => v === t)?.[1] ?? t;
const cell = "w-24 rounded-md border border-border bg-background p-1 text-sm";

function currentMonth() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Setup fees team members charge and keep in cash: the allowed ranges by business type and size, and every fee recorded. */
export default function SetupFeesAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Overview | null>(null);
  const [rates, setRates] = useState<{ industryType: string; size: string; minKes: string; maxKes: string }[]>([]);
  const [newType, setNewType] = useState("RETAIL");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    setSession(s);
  }, [router]);

  const load = useCallback(async () => {
    try {
      const o = await apiGet<Overview>(`/platform-admin/sales-setup-fees?month=${month}`);
      setData(o);
      setRates(o.rates.map((r) => ({ industryType: r.industryType, size: r.size, minKes: String(r.minKes), maxKes: String(r.maxKes) })));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load setup fees.");
    }
  }, [month]);

  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function saveRates() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await apiPut("/platform-admin/sales-setup-fees/rates", { rates: rates.map((r) => ({ industryType: r.industryType, size: r.size, minKes: Number(r.minKes), maxKes: Number(r.maxKes) })) });
      setNote("Setup fee ranges saved. Team members see them at once.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save the ranges.");
    } finally {
      setBusy(false);
    }
  }

  async function voidFee(f: Fee) {
    const reason = window.prompt(`Void ${f.receiptNo} (${kes(f.amountKes)} from ${f.business})? Why?`);
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/platform-admin/sales-setup-fees/${f.id}/void`, { reason: reason.trim() });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not void it.");
    }
  }

  function addType() {
    if (rates.some((r) => r.industryType === newType)) return;
    setRates([...rates, ...SIZES.map((size) => ({ industryType: newType, size, minKes: "", maxKes: "" }))]);
  }

  const setRate = (i: number, key: "minKes" | "maxKes", value: string) => setRates(rates.map((r, j) => (j === i ? { ...r, [key]: value } : r)));

  if (!session) return null;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <Link href="/teams" className="text-sm text-secondary-500 hover:text-foreground">
          &larr; All teams
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Setup fees</h1>
          <label className="text-sm">
            Month{" "}
            <input type="month" className="rounded-md border border-border bg-background p-1.5" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        <p className="text-sm text-secondary-500">
          Team members charge a business they set up a one-off fee and keep it in cash: ZARODA takes nothing and never pays it out, so it is not in earnings or payouts.
          You set the range for each size (and, if you like, per business type; otherwise the &quot;Any business&quot; range applies). Each fee gets a receipt number.
        </p>
        {error && <p className="text-sm text-error-600">{error}</p>}
        {note && <p className="rounded-md border border-success-600/40 bg-success-50 p-3 text-sm">{note}</p>}
        {!data && !error && <LoadingState label="Loading setup fees..." />}

        {data && (
          <>
            <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Allowed ranges (KES)</h2>
              <table className="text-sm">
                <thead>
                  <tr className="text-left text-secondary-500">
                    <th className="p-1">Business type</th>
                    <th className="p-1">Size</th>
                    <th className="p-1">Lowest</th>
                    <th className="p-1">Highest</th>
                  </tr>
                </thead>
                <tbody>
                  {rates.map((r, i) => (
                    <tr key={`${r.industryType}:${r.size}`}>
                      <td className="p-1">{typeLabel(r.industryType)}</td>
                      <td className="p-1">{r.size.toLowerCase()}</td>
                      <td className="p-1">
                        <input type="number" min={0} className={cell} value={r.minKes} onChange={(e) => setRate(i, "minKes", e.target.value)} />
                      </td>
                      <td className="p-1">
                        <input type="number" min={0} className={cell} value={r.maxKes} onChange={(e) => setRate(i, "maxKes", e.target.value)} />
                      </td>
                      <td className="p-1">
                        {r.industryType !== "ANY" && (
                          <button className="text-xs text-error-600 hover:underline" onClick={() => setRates(rates.filter((_, j) => j !== i))}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <select className="rounded-md border border-border bg-background p-1.5" value={newType} onChange={(e) => setNewType(e.target.value)}>
                  {TYPES.filter(([v]) => v !== "ANY").map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
                <button className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary-500/5" onClick={addType}>
                  Add ranges for this type
                </button>
                <button
                  className="rounded-md bg-primary-600 px-4 py-1.5 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                  disabled={busy || rates.some((r) => r.minKes === "" || r.maxKes === "")}
                  onClick={() => void saveRates()}
                >
                  {busy ? "Saving..." : "Save ranges"}
                </button>
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="font-semibold">
                Collected in the month: {kes(data.totalKes)}
              </h2>
              {data.byAgent.length > 0 && (
                <ul className="grid gap-2 sm:grid-cols-3">
                  {data.byAgent.map((a) => (
                    <li key={a.agentId} className="rounded-lg border border-border bg-surface p-3 text-sm">
                      <p className="font-semibold">{a.fullName}</p>
                      <p className="text-secondary-500">
                        {a.team} · {a.count} fee{a.count === 1 ? "" : "s"} · {kes(a.totalKes)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {data.fees.length === 0 ? (
                <p className="text-sm text-secondary-500">No setup fees recorded in this month.</p>
              ) : (
                <ul className="space-y-2">
                  {data.fees.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                      <div>
                        <p className="font-semibold">{f.business}</p>
                        <p className="text-secondary-500">
                          {f.receiptNo} · {f.agent} · {typeLabel(f.industryType)}, {f.size.toLowerCase()} · {new Date(f.receivedAt).toLocaleDateString("en-KE")}
                          {f.note ? ` · ${f.note}` : ""}
                          {f.voidedAt ? ` · voided: ${f.voidReason}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`font-semibold ${f.voidedAt ? "line-through opacity-60" : ""}`}>{kes(f.amountKes)}</span>
                        {f.voidedAt ? (
                          <Badge variant="warning">Voided</Badge>
                        ) : (
                          <button className="text-xs text-error-600 hover:underline" onClick={() => void voidFee(f)}>
                            Void
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
