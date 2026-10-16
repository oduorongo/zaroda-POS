"use client";

import { useEffect, useState } from "react";
import { Badge } from "@zaroda/ui";
import { ApiError } from "../../lib/api";
import { TeamShell } from "../../components/team-shell";
import { teamChangePassword, teamGet, type TeamMe, type TeamOverview } from "../../lib/team-api";

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-sm text-secondary-500">{label}</p>
      {hint && <p className="mt-1 text-xs text-secondary-500">{hint}</p>}
    </div>
  );
}

function HomeBody({ me, reload }: { me: TeamMe; reload: () => Promise<void> }) {
  const [overview, setOverview] = useState<TeamOverview | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const locked = me.agent.mustChangePassword;

  useEffect(() => {
    if (locked) return;
    teamGet<TeamOverview>("/overview")
      .then(setOverview)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your numbers."));
  }, [locked]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await teamChangePassword(current, next);
      setCurrent("");
      setNext("");
      setNote("Password changed.");
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div>
        <h1 className="text-xl font-bold">Hello, {me.agent.fullName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary-500">
          <Badge variant="neutral">{me.agent.role === "LEADER" ? "Team leader" : "Team member"}</Badge>
          {me.team.name}
          {me.team.region ? ` · ${me.team.region}` : ""}
        </p>
      </div>

      {locked && (
        <p className="rounded-md border border-warning-600/40 bg-warning-50 p-3 text-sm">
          You are using a temporary password. Please choose your own below before you do anything else.
        </p>
      )}
      {error && <p className="text-sm text-error-600">{error}</p>}

      {overview && (
        <>
          <section className="space-y-2">
            <h2 className="font-semibold">{me.agent.role === "LEADER" ? "Your team" : "Your work"}</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Shops brought in" value={overview.shops.total} />
              <Stat label="On free trial" value={overview.shops.onTrial} />
              <Stat label="Paying" value={overview.shops.paying} hint="Subscription paid up" />
              <Stat label="Selling online" value={overview.shops.sellingOnline} />
              <Stat label="Subscription lapsed" value={overview.shops.lapsed} />
              <Stat label="Riders brought in" value={overview.riders.total} />
              <Stat label="Riders waiting for approval" value={overview.riders.waitingForApproval} />
              <Stat label="Riders approved" value={overview.riders.approved} />
            </div>
          </section>

          {overview.members && (
            <section className="space-y-2">
              <h2 className="font-semibold">Members</h2>
              {overview.members.length === 0 ? (
                <p className="text-sm text-secondary-500">No members yet. Add them on the Members page.</p>
              ) : (
                <ul className="space-y-2">
                  {overview.members.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
                      <span className="flex items-center gap-2">
                        <span className="font-semibold">{m.fullName}</span>
                        {m.status === "SUSPENDED" && <Badge variant="error">Suspended</Badge>}
                      </span>
                      <span className="text-secondary-500">
                        {m.shops} shop{m.shops === 1 ? "" : "s"} · {m.riders} rider{m.riders === 1 ? "" : "s"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Your team&apos;s earning terms</h2>
        <ul className="space-y-1 text-sm text-secondary-600">
          <li>Members earn {pct(me.team.memberShareRate)} of what Zaroda collects as online-order commission from the shops they sign, and {pct(me.team.subscriptionShareRate)} of each monthly subscription those shops pay.</li>
          <li>You earn on a shop for {me.team.earningMonths} months after it signs up.</li>
          <li>The team leader also earns {pct(me.team.leaderOverrideRate)} of the commission and subscriptions from all the team&apos;s shops, paid by Zaroda on top (never deducted from members).</li>
          <li>A bonus of KES {me.team.onboardingBonusKes.toLocaleString("en-KE")} for each shop, once it pays its second monthly subscription.</li>
          <li>Member and leader together never earn more than {pct(me.team.payoutCapRate)} of Zaroda&apos;s revenue from one shop in one month.</li>
        </ul>
        <p className="text-xs text-secondary-500">Only money Zaroda has actually received counts. See the Earnings page for what you have earned and been paid.</p>
      </section>

      <form onSubmit={changePassword} className="space-y-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="font-semibold">Change your password</h2>
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Current password"
          className="w-full rounded-md border border-border bg-background p-2.5 text-sm"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password (at least 8 characters)"
          className="w-full rounded-md border border-border bg-background p-2.5 text-sm"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <button type="submit" disabled={busy} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {busy ? "Saving..." : "Change password"}
        </button>
        {note && <p className="text-sm text-success-600">{note}</p>}
      </form>
    </>
  );
}

/** A leader's or member's home: their numbers, their team's terms, and their password. */
export default function TeamHomePage() {
  return <TeamShell active="home">{(me, reload) => <HomeBody me={me} reload={reload} />}</TeamShell>;
}
