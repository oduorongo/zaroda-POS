"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Badge, Button, LoadingState } from "@zaroda/ui";

type Gateway = "MANUAL" | "MPESA_B2C" | "TUMA";

interface Person {
  agentId: string;
  fullName: string;
  role: "LEADER" | "MEMBER";
  status: "ACTIVE" | "SUSPENDED";
  payoutGateway: "MPESA_B2C" | "TUMA" | null;
  payoutAccount: string | null;
  earnedThisMonth: number;
  pending: number;
  payable: number;
  paid: number;
}
interface Settings {
  payoutGateway: Gateway;
  payoutMinKes: number;
  payoutDay: number;
  holdDays: number;
  withholdingTaxRate: number;
  available: Record<Gateway, boolean>;
}
interface Overview {
  month: string;
  settings: Settings;
  teams: { teamId: string; name: string; earnedThisMonth: number; pending: number; payable: number; people: Person[] }[];
}
interface Payout {
  id: string;
  agentId: string;
  fullName: string;
  amountKes: number;
  taxWithheldKes: number;
  netKes: number;
  throughMonth: string;
  gateway: string;
  reference: string | null;
  status: "QUEUED" | "PAID" | "FAILED";
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const GATEWAY_LABEL: Record<string, string> = { MANUAL: "By hand", MPESA_B2C: "M-Pesa (B2C)", TUMA: "TUMA", MPESA: "M-Pesa", BANK: "Bank", CASH: "Cash" };
const STATUS_BADGE = { QUEUED: "warning", PAID: "success", FAILED: "error" } as const;

function currentMonth() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** What every team has earned (pending / payable / paid), how and when people are paid, and the payouts themselves. */
export default function TeamEarningsAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Overview | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [paying, setPaying] = useState<Person | null>(null);
  const [reference, setReference] = useState("");

  const [gateway, setGateway] = useState<Gateway>("MANUAL");
  const [minKes, setMinKes] = useState("500");
  const [payoutDay, setPayoutDay] = useState("5");
  const [holdDays, setHoldDays] = useState("30");
  const [taxPct, setTaxPct] = useState("0");

  const [adjSource, setAdjSource] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjRef, setAdjRef] = useState("");
  const [adjReason, setAdjReason] = useState("");

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  async function load() {
    setError(null);
    try {
      const [overview, history] = await Promise.all([
        apiGet<Overview>(`/platform-admin/sales-earnings?month=${month}`),
        apiGet<Payout[]>("/platform-admin/sales-earnings/payouts"),
      ]);
      setData(overview);
      setPayouts(history);
      const s = overview.settings;
      setGateway(s.payoutGateway);
      setMinKes(String(s.payoutMinKes));
      setPayoutDay(String(s.payoutDay));
      setHoldDays(String(s.holdDays));
      setTaxPct(String(Math.round(s.withholdingTaxRate * 10000) / 100));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load earnings.");
    }
  }

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, month]);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      setNote(await action());
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const saveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiPatch("/platform-admin/sales-earnings/settings", {
        payoutGateway: gateway,
        payoutMinKes: Number(minKes || 0),
        payoutDay: Number(payoutDay || 5),
        holdDays: Number(holdDays || 0),
        withholdingTaxRate: Number(taxPct || 0) / 100,
      });
      return "Payout settings saved. A change only applies to earnings and payouts after it.";
    });
  };

  const recordByHand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!paying) return;
    const who = paying;
    void run(async () => {
      const result = await apiPost<{ amountKes: number; netKes: number }>("/platform-admin/sales-earnings/payouts", { agentId: who.agentId, reference: reference.trim() });
      setPaying(null);
      setReference("");
      return `Recorded ${kes(result.netKes)} paid to ${who.fullName} (${kes(result.amountKes)} before tax).`;
    });
  };

  const sendNow = (p: Person) =>
    void run(async () => {
      const result = await apiPost<{ status: string; netKes: number; failureReason: string | null }>("/platform-admin/sales-earnings/payouts/send", { agentId: p.agentId });
      if (result.status === "FAILED") throw new ApiError(`The payout to ${p.fullName} failed: ${result.failureReason ?? "unknown reason"}. Their earnings are payable again.`, 400);
      return `Sending ${kes(result.netKes)} to ${p.fullName}. It shows as paid once the gateway confirms.`;
    });

  const resolve = (p: Payout, outcome: "PAID" | "FAILED") => {
    const ref = outcome === "PAID" ? prompt("Payment reference (e.g. the M-Pesa code)?") : "";
    if (outcome === "PAID" && !ref?.trim()) return;
    void run(async () => {
      await apiPost(`/platform-admin/sales-earnings/payouts/${p.id}/resolve`, { outcome, ...(ref?.trim() ? { reference: ref.trim() } : {}) });
      return outcome === "PAID" ? "Marked paid." : "Marked failed; the earnings are payable again.";
    });
  };

  const recordAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await apiPost<{ adjustments: number; totalKes: number }>("/platform-admin/sales-earnings/adjustments", {
        sourceId: adjSource.trim(),
        refundedKes: Number(adjAmount),
        reference: adjRef.trim(),
        ...(adjReason.trim() ? { reason: adjReason.trim() } : {}),
      });
      setAdjSource("");
      setAdjAmount("");
      setAdjRef("");
      setAdjReason("");
      return `Recorded ${result.adjustments} adjustment${result.adjustments === 1 ? "" : "s"} totalling ${kes(result.totalKes)}.`;
    });
  };

  if (!session) return null;
  const settings = data?.settings;
  const field = "mt-1 w-full rounded-md border border-border bg-background p-2";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <Link href="/teams" className="text-sm text-secondary-500 hover:text-foreground">
          &larr; All teams
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Team earnings and payouts</h1>
          <label className="text-sm">
            Month{" "}
            <input type="month" className="rounded-md border border-border bg-background p-1.5" value={month} max={currentMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        <p className="text-sm text-secondary-500">
          People earn only when Zaroda has the money: a share of a shop&apos;s commission once its invoice is paid, a share of each subscription it pays, and a bonus on its second subscription. Earnings are{" "}
          <b>pending</b> until {settings?.holdDays ?? 30} days after the month ends, then <b>payable</b>. Payable balances of at least {kes(settings?.payoutMinKes ?? 500)} are paid on the{" "}
          {settings?.payoutDay ?? 5}th of each month; smaller balances carry over.
        </p>

        {note && <p className="rounded-md border border-success-600/40 bg-success-50 p-3 text-sm">{note}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!data && !error && <LoadingState label="Working out earnings..." />}

        {settings && (
          <form onSubmit={saveSettings} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">How and when people are paid</h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm">
                Payout gateway
                <select className={field} value={gateway} onChange={(e) => setGateway(e.target.value as Gateway)}>
                  <option value="MANUAL">By hand (I record each payment with a reference)</option>
                  <option value="MPESA_B2C" disabled={!settings.available.MPESA_B2C}>
                    M-Pesa B2C{settings.available.MPESA_B2C ? "" : " (not set up on the server)"}
                  </option>
                  <option value="TUMA" disabled={!settings.available.TUMA}>
                    TUMA{settings.available.TUMA ? "" : " (not set up on the server)"}
                  </option>
                </select>
              </label>
              <label className="text-sm">
                Minimum payout (KES)
                <input type="number" min={0} step="1" className={field} value={minKes} onChange={(e) => setMinKes(e.target.value)} />
              </label>
              <label className="text-sm">
                Payout day of the month
                <input type="number" min={1} max={28} step="1" className={field} value={payoutDay} onChange={(e) => setPayoutDay(e.target.value)} />
              </label>
              <label className="text-sm">
                Hold (days after the month ends)
                <input type="number" min={0} max={365} step="1" className={field} value={holdDays} onChange={(e) => setHoldDays(e.target.value)} />
              </label>
              <label className="text-sm">
                Withholding tax (% deducted at payout)
                <input type="number" min={0} max={100} step="0.01" className={field} value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-secondary-500">With a gateway chosen, the monthly run pays everyone who has a gateway and phone number on file; anyone else stays payable for you to pay by hand.</p>
            <Button type="submit" disabled={busy}>
              Save settings
            </Button>
          </form>
        )}

        {paying && (
          <form onSubmit={recordByHand} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Record a payment to {paying.fullName}</h2>
            <p className="text-sm">
              Marks everything payable as paid: <b>{kes(paying.payable)}</b> (before any withholding tax). Only record it after you have actually paid them.
            </p>
            <label className="block text-sm">
              Reference (M-Pesa code, bank reference)
              <input required minLength={2} className={field} value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || reference.trim().length < 2}>
                {busy ? "Recording..." : "I have paid - record it"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setPaying(null)}>
                Cancel
              </Button>
            </div>
          </form>
        )}

        {data?.teams.map((team) => (
          <section key={team.teamId} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold">{team.name}</h2>
              <span className="text-sm text-secondary-500">
                earned {kes(team.earnedThisMonth)} this month · {kes(team.pending)} pending · {kes(team.payable)} payable
              </span>
            </div>
            <ul className="space-y-2">
              {team.people.map((p) => {
                const canSend = p.payable >= settings!.payoutMinKes && p.payoutGateway && p.payoutAccount && settings!.available[p.payoutGateway];
                return (
                  <li key={p.agentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{p.fullName}</span>
                      <Badge variant="neutral">{p.role === "LEADER" ? "Leader" : "Member"}</Badge>
                      {p.status === "SUSPENDED" && <Badge variant="error">Left / suspended</Badge>}
                      <span className="text-secondary-500">{p.payoutGateway ? `${GATEWAY_LABEL[p.payoutGateway]} · ${p.payoutAccount}` : "paid by hand"}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="text-secondary-500">earned {kes(p.earnedThisMonth)}</span>
                      <span className="text-secondary-500">pending {kes(p.pending)}</span>
                      <span>
                        payable <b>{kes(p.payable)}</b>
                      </span>
                      <span className="text-secondary-500">paid {kes(p.paid)}</span>
                      {canSend && (
                        <Button size="sm" disabled={busy} onClick={() => sendNow(p)}>
                          Pay now
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={p.payable < (settings?.payoutMinKes ?? 500)} onClick={() => { setPaying(p); setNote(null); }}>
                        Record by hand
                      </Button>
                    </div>
                  </li>
                );
              })}
              {team.people.length === 0 && <li className="text-sm text-secondary-500">No people on this team yet.</li>}
            </ul>
          </section>
        ))}

        <section className="space-y-2">
          <h2 className="font-semibold">Payouts</h2>
          {payouts.length === 0 ? (
            <p className="text-sm text-secondary-500">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {payouts.map((p) => (
                <li key={p.id} className="space-y-1 rounded-lg border border-border bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex flex-wrap items-center gap-2">
                      {new Date(p.paidAt ?? p.createdAt).toLocaleDateString("en-KE")} · <b>{p.fullName}</b> · {GATEWAY_LABEL[p.gateway] ?? p.gateway}
                      {p.reference ? ` · ${p.reference}` : ""}
                      <Badge variant={STATUS_BADGE[p.status]}>{p.status === "QUEUED" ? "Queued" : p.status === "PAID" ? "Paid" : "Failed"}</Badge>
                    </span>
                    <span className="font-semibold">
                      {kes(p.netKes)}{" "}
                      <span className="font-normal text-secondary-500">
                        {p.taxWithheldKes > 0 ? `(${kes(p.amountKes)} less ${kes(p.taxWithheldKes)} tax) ` : ""}up to {p.throughMonth}
                      </span>
                    </span>
                  </div>
                  {p.status === "FAILED" && p.failureReason && <p className="text-error-600">{p.failureReason}. The earnings are payable again.</p>}
                  {p.status === "QUEUED" && (
                    <div className="flex flex-wrap items-center gap-2 text-secondary-500">
                      Waiting for the gateway to confirm. If it never does, check your statement and say what happened:
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => resolve(p, "PAID")}>
                        It was paid
                      </Button>
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => resolve(p, "FAILED")}>
                        It failed
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <form onSubmit={recordAdjustment} className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="font-semibold">Record a refund against earnings</h2>
          <p className="text-sm text-secondary-500">
            If money Zaroda collected from a shop is refunded after the team earned on it, enter the commission invoice or subscription payment id and the amount refunded. The matching share is taken
            back from the member and the leader as a negative adjustment, netted off their next payout.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Commission invoice or subscription payment id
              <input required className={field} value={adjSource} onChange={(e) => setAdjSource(e.target.value)} />
            </label>
            <label className="text-sm">
              Amount refunded (KES)
              <input required type="number" min={0.01} step="0.01" className={field} value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} />
            </label>
            <label className="text-sm">
              Refund reference (stops it being applied twice)
              <input required minLength={2} className={field} value={adjRef} onChange={(e) => setAdjRef(e.target.value)} />
            </label>
            <label className="text-sm">
              Reason (optional)
              <input className={field} value={adjReason} onChange={(e) => setAdjReason(e.target.value)} />
            </label>
          </div>
          <Button type="submit" disabled={busy || !adjSource.trim() || !adjAmount || adjRef.trim().length < 2}>
            Record adjustment
          </Button>
        </form>
      </main>
    </div>
  );
}
