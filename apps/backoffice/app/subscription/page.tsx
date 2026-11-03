"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Instalment {
  id: string;
  schoolYear: number;
  term: number;
  label: string;
  amount: number;
  dueDate: string;
  lockOn: string;
  state: "DUE" | "OVERDUE" | "PAID" | "SETTLED" | "WAIVED";
  lastPaymentError: string | null;
  payAttemptedAt: string | null;
}
interface Mine {
  cycle: "MONTHLY" | "SEASONAL";
  free: boolean;
  plan: { name: string; annualPriceKes: number };
  status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED" | "READ_ONLY";
  instalments: Instalment[];
  payInFull: { schoolYear: number; full: number; discount: number; amount: number; discountRate: number } | null;
  payHow: string;
  canPayOnline: boolean;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const niceDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const STATE: Record<Instalment["state"], [string, string]> = {
  PAID: ["Paid", "bg-green-950 text-green-300"],
  SETTLED: ["Paid with the year", "bg-green-950 text-green-300"],
  WAIVED: ["Waived", "bg-secondary-500/20"],
  DUE: ["Due", "bg-amber-950 text-amber-300"],
  OVERDUE: ["Overdue", "bg-red-950 text-red-300"],
};
const field = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const primary = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";

/** "My subscription": a school supplier's term instalments (paid / due / overdue), paying one - or the whole year in January - by M-Pesa. */
export default function SubscriptionPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [data, setData] = useState<Mine | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paying, setPaying] = useState<{ id: string; fullYear: boolean; amount: number } | null>(null);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet<Mine>("/subscription/seasonal"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your subscription.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSessionState(s);
  }, [router]);
  useEffect(() => {
    if (session) void load();
  }, [session, load]);

  async function pay() {
    if (!paying) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/subscription/seasonal/instalments/${paying.id}/pay`, { phone, fullYear: paying.fullYear });
      setNotice(`Check ${phone} for the M-Pesa prompt for ${kes(paying.amount)}. This page updates once it is paid.`);
      setPaying(null);
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const fresh = await apiGet<Mine>("/subscription/seasonal").catch(() => null);
        if (fresh) setData(fresh);
        if (fresh?.instalments.find((x) => x.id === paying.id)?.state !== "DUE" && fresh?.instalments.find((x) => x.id === paying.id)?.state !== "OVERDUE") {
          setNotice("Paid - thank you.");
          break;
        }
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not start the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function check(id: string) {
    try {
      const r = await apiPost<{ result: string }>(`/subscription/seasonal/instalments/${id}/check`, {});
      setNotice(r.result === "paid" ? "Paid - thank you." : r.result === "unavailable" ? "Could not check just now - try again shortly." : "Not paid yet.");
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not check the payment.");
    }
  }

  if (!session) return null;
  const firstOpen = data?.instalments.find((i) => i.state === "DUE" || i.state === "OVERDUE");
  const fullYearStart = data?.payInFull ? data.instalments.find((i) => i.schoolYear === data.payInFull!.schoolYear && i.term > 0 && (i.state === "DUE" || i.state === "OVERDUE")) : undefined;
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-6">
        <h1 className="text-xl font-bold">My subscription</h1>
        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
        {data && data.cycle !== "SEASONAL" && (
          <p className="rounded-lg border border-border bg-surface p-4 text-sm">
            {data.free
              ? `You are on the free ${data.plan.name} plan: nothing to pay. ZARODA earns only the 3% convenience fee your online shoppers pay. Contact ZARODA if you want ZARODA tills as well.`
              : `You are on the ${data.plan.name} plan, billed monthly. Contact ZARODA to change it.`}
          </p>
        )}
        {data && data.cycle === "SEASONAL" && (
          <>
            {data.status === "READ_ONLY" && (
              <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">
                An instalment is overdue, so your account is read-only: you can see your stock, sales and reports but cannot make sales or change stock. Pay it below and everything opens again at once. Nothing has been deleted.
              </p>
            )}
            <div className="rounded-lg border border-border bg-surface p-4 text-sm">
              <p className="font-semibold">{data.plan.name}</p>
              <p className="text-secondary-500">
                {kes(data.plan.annualPriceKes)} a year, paid per school term (the biggest share with Term 1, when capitation arrives). {data.payHow}
              </p>
            </div>
            {data.payInFull && fullYearStart && (
              <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
                <p className="font-semibold">Pay the whole {data.payInFull.schoolYear} school year now and save {kes(data.payInFull.discount)}</p>
                <p className="text-secondary-500">
                  {kes(data.payInFull.amount)} instead of {kes(data.payInFull.full)} ({Math.round(data.payInFull.discountRate * 100)}% off) - open until the end of January.
                </p>
                {data.canPayOnline && (
                  <button className={`${primary} mt-2`} onClick={() => setPaying({ id: fullYearStart.id, fullYear: true, amount: data.payInFull!.amount })}>
                    Pay {kes(data.payInFull.amount)} by M-Pesa
                  </button>
                )}
              </div>
            )}
            <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
              {data.instalments.length === 0 && <li className="p-3 text-sm text-secondary-500">Nothing to pay yet.</li>}
              {data.instalments.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                  <div>
                    <p className="font-semibold">
                      {i.schoolYear} {i.label} <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${STATE[i.state][1]}`}>{STATE[i.state][0]}</span>
                    </p>
                    <p className="text-xs text-secondary-500">
                      Due {niceDay(i.dueDate)}
                      {(i.state === "DUE" || i.state === "OVERDUE") && ` · read-only from ${niceDay(i.lockOn)} if unpaid`}
                    </p>
                    {i.lastPaymentError && <p className="text-xs text-red-400">{i.lastPaymentError}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold">{kes(i.amount)}</p>
                    {(i.state === "DUE" || i.state === "OVERDUE") && data.canPayOnline && (
                      <div className="mt-1 flex justify-end gap-2">
                        {i.payAttemptedAt && !i.lastPaymentError && (
                          <button className="text-xs text-primary-400 hover:underline" onClick={() => void check(i.id)}>
                            I have paid - check
                          </button>
                        )}
                        <button className={primary} disabled={i.id !== firstOpen?.id} title={i.id !== firstOpen?.id ? "Pay the earlier instalment first" : undefined} onClick={() => setPaying({ id: i.id, fullYear: false, amount: i.amount })}>
                          Pay
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {!data.canPayOnline && <p className="text-xs text-secondary-500">Paying in the app is not switched on yet. {data.payHow}</p>}
          </>
        )}
        {paying && (
          <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
            <p className="text-sm font-semibold">Pay {kes(paying.amount)} by M-Pesa</p>
            <label className="block text-sm">
              M-Pesa number
              <input className={field} inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <button className={primary} disabled={busy || phone.trim().length < 9} onClick={() => void pay()}>
                {busy ? "Sending..." : "Send the prompt"}
              </button>
              <button className="rounded-md border border-border px-4 py-2 text-sm" onClick={() => setPaying(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
