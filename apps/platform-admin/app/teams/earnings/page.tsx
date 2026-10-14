"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Badge, Button, LoadingState } from "@zaroda/ui";

interface Person {
  agentId: string;
  fullName: string;
  role: "LEADER" | "MEMBER";
  status: "ACTIVE" | "SUSPENDED";
  earnedThisMonth: number;
  owed: number;
  paid: number;
}
interface Overview {
  month: string;
  teams: { teamId: string; name: string; earnedThisMonth: number; owed: number; people: Person[] }[];
}
interface Payout {
  id: string;
  agentId: string;
  fullName: string;
  amountKes: number;
  throughMonth: string;
  method: string;
  reference: string | null;
  paidAt: string;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function currentMonth() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** What every team has earned and is owed, and where the owner records that a payment was made. */
export default function TeamEarningsAdminPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<Overview | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<Person | null>(null);
  const [method, setMethod] = useState<"MPESA" | "BANK" | "CASH">("MPESA");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load earnings.");
    }
  }

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, month]);

  async function recordPayout(e: React.FormEvent) {
    e.preventDefault();
    if (!paying) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiPost<{ amountKes: number }>("/platform-admin/sales-earnings/payouts", {
        agentId: paying.agentId,
        throughMonth: month,
        method,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      setNote(`Recorded ${kes(result.amountKes)} paid to ${paying.fullName}.`);
      setPaying(null);
      setReference("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  if (!session) return null;

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
          People earn only when Zaroda has the money: their share of a shop&apos;s commission once its invoice is paid, and the bonus once the shop pays its first subscription. &quot;Owed&quot; is everything
          unpaid up to and including the month shown. Pay people yourself, then record it here so it is marked paid and shows on their statement.
        </p>

        {note && <p className="rounded-md border border-success-600/40 bg-success-50 p-3 text-sm">{note}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!data && !error && <LoadingState label="Working out earnings..." />}

        {paying && (
          <form onSubmit={recordPayout} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Record a payment to {paying.fullName}</h2>
            <p className="text-sm">
              Marks everything unpaid up to {month} as paid: <b>{kes(paying.owed)}</b>. Only record it after you have actually paid them.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                How you paid
                <select className="mt-1 w-full rounded-md border border-border bg-background p-2" value={method} onChange={(e) => setMethod(e.target.value as "MPESA" | "BANK" | "CASH")}>
                  <option value="MPESA">M-Pesa</option>
                  <option value="BANK">Bank</option>
                  <option value="CASH">Cash</option>
                </select>
              </label>
              <label className="text-sm">
                Reference (M-Pesa code, bank reference)
                <input className="mt-1 w-full rounded-md border border-border bg-background p-2" value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
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
                earned {kes(team.earnedThisMonth)} this month · {kes(team.owed)} owed
              </span>
            </div>
            <ul className="space-y-2">
              {team.people.map((p) => (
                <li key={p.agentId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{p.fullName}</span>
                    <Badge variant="neutral">{p.role === "LEADER" ? "Leader" : "Member"}</Badge>
                    {p.status === "SUSPENDED" && <Badge variant="error">Suspended</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <span className="text-secondary-500">earned {kes(p.earnedThisMonth)}</span>
                    <span>
                      owed <b>{kes(p.owed)}</b>
                    </span>
                    <span className="text-secondary-500">paid {kes(p.paid)}</span>
                    <Button size="sm" disabled={p.owed <= 0} onClick={() => { setPaying(p); setNote(null); }}>
                      Record payment
                    </Button>
                  </div>
                </li>
              ))}
              {team.people.length === 0 && <li className="text-sm text-secondary-500">No people on this team yet.</li>}
            </ul>
          </section>
        ))}

        <section className="space-y-2">
          <h2 className="font-semibold">Payments recorded</h2>
          {payouts.length === 0 ? (
            <p className="text-sm text-secondary-500">None yet.</p>
          ) : (
            <ul className="space-y-2">
              {payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                  <span>
                    {new Date(p.paidAt).toLocaleDateString("en-KE")} · <b>{p.fullName}</b> · {p.method}
                    {p.reference ? ` · ${p.reference}` : ""}
                  </span>
                  <span className="font-semibold">
                    {kes(p.amountKes)} <span className="font-normal text-secondary-500">up to {p.throughMonth}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
