"use client";

import { useEffect, useState } from "react";
import { Badge, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, type EarningsStatement, type TeamMe } from "../../../lib/team-api";

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const KIND: Record<string, string> = {
  COMMISSION_SHARE: "Commission share",
  LEADER_OVERRIDE: "Leader share of the team",
  ONBOARDING_BONUS: "Onboarding bonus",
};

function currentMonth() {
  const now = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-KE", { month: "long", year: "numeric", timeZone: "UTC" });
}

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function EarningsBody({ me }: { me: TeamMe }) {
  const [month, setMonth] = useState(currentMonth());
  const [data, setData] = useState<EarningsStatement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isLeader = me.agent.role === "LEADER";

  useEffect(() => {
    setData(null);
    setError(null);
    teamGet<EarningsStatement>(`/earnings?month=${month}`)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your earnings."));
  }, [month]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Your earnings</h1>
        <div className="flex items-center gap-2 text-sm">
          <button className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary-500/5" onClick={() => setMonth(shift(month, -1))}>
            &larr;
          </button>
          <span className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
          <button
            className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary-500/5 disabled:opacity-40"
            disabled={month >= currentMonth()}
            onClick={() => setMonth(shift(month, 1))}
          >
            &rarr;
          </button>
        </div>
      </div>

      {!data && !error && <LoadingState label="Loading earnings..." />}
      {error && <p className="text-sm text-error-600">{error}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-2xl font-bold">{kes(data.thisMonth.total)}</p>
              <p className="text-sm text-secondary-500">Earned in {monthLabel(month)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-2xl font-bold">{kes(data.allTime.unpaid)}</p>
              <p className="text-sm text-secondary-500">Waiting to be paid to you (all months)</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-4">
              <p className="text-2xl font-bold">{kes(data.allTime.paid)}</p>
              <p className="text-sm text-secondary-500">Paid to you so far</p>
            </div>
          </div>

          <p className="text-sm text-secondary-500">
            {kes(data.thisMonth.commissionShare)} commission share
            {isLeader ? ` · ${kes(data.thisMonth.leaderOverride)} leader share of the team` : ""} · {kes(data.thisMonth.onboardingBonus)} onboarding bonuses. Only money Zaroda has actually
            received counts: a shop&apos;s commission once its invoice is paid, and the bonus once it pays its first monthly subscription.
          </p>

          <section className="space-y-2">
            <h2 className="font-semibold">What you earned</h2>
            {data.lines.length === 0 ? (
              <EmptyState title="Nothing earned in this month" description="Earnings appear here when a shop you signed up pays its commission or its first subscription." />
            ) : (
              <ul className="space-y-2">
                {data.lines.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                    <div>
                      <p className="font-semibold">{l.shop}</p>
                      <p className="text-secondary-500">
                        {KIND[l.kind]}
                        {l.rate != null ? ` · ${Math.round(l.rate * 10000) / 100}% of ${kes(l.baseKes)}` : ""} · {new Date(l.earnedAt).toLocaleDateString("en-KE")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{kes(l.amountKes)}</span>
                      <Badge variant={l.status === "PAID" ? "success" : "warning"}>{l.status === "PAID" ? "Paid" : "To be paid"}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data.team && (
            <section className="space-y-2">
              <h2 className="font-semibold">Your team in {monthLabel(month)}</h2>
              <ul className="space-y-2">
                {data.team.map((p) => (
                  <li key={p.agentId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                    <span className="font-semibold">
                      {p.fullName} {p.role === "LEADER" && <span className="font-normal text-secondary-500">(leader)</span>}
                    </span>
                    <span className="text-secondary-500">
                      earned {kes(p.earnedThisMonth)} · {kes(p.unpaid)} still to be paid
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-2">
            <h2 className="font-semibold">Payments made to you</h2>
            {data.payouts.length === 0 ? (
              <p className="text-sm text-secondary-500">Nothing paid yet. Zaroda pays what you have earned, and records each payment here.</p>
            ) : (
              <ul className="space-y-2">
                {data.payouts.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                    <span>
                      {new Date(p.paidAt).toLocaleDateString("en-KE")} · {p.method}
                      {p.reference ? ` · ${p.reference}` : ""}
                    </span>
                    <span className="font-semibold">
                      {kes(p.amountKes)} <span className="font-normal text-secondary-500">for everything up to {monthLabel(p.throughMonth)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}

export default function TeamEarningsPage() {
  return <TeamShell active="earnings">{(me) => <EarningsBody me={me} />}</TeamShell>;
}
