"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";

interface TeamRow {
  id: string;
  name: string;
  region: string | null;
  status: "ACTIVE" | "PAUSED";
  memberShareRate: number;
  leaderOverrideRate: number;
  onboardingBonusKes: number;
  subscriptionShareRate: number;
  earningMonths: number;
  payoutCapRate: number;
  leader: { id: string; fullName: string; email: string } | null;
  memberCount: number;
  tenantCount: number;
  riderCount: number;
}

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/** Marketing teams: who is on each, what they have brought in, and the terms they are paid on. */
export default function TeamsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [memberPct, setMemberPct] = useState("25");
  const [subPct, setSubPct] = useState("10");
  const [months, setMonths] = useState("12");
  const [leaderPct, setLeaderPct] = useState("5");
  const [bonus, setBonus] = useState("500");
  const [capPct, setCapPct] = useState("35");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setTeams(await apiGet<TeamRow[]>("/platform-admin/sales-teams"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load teams.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) void load();
  }, [session]);

  async function createTeam(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const team = await apiPost<{ id: string }>("/platform-admin/sales-teams", {
        name: name.trim(),
        ...(region.trim() ? { region: region.trim() } : {}),
        memberShareRate: Number(memberPct || 0) / 100,
        leaderOverrideRate: Number(leaderPct || 0) / 100,
        onboardingBonusKes: Number(bonus || 0),
        subscriptionShareRate: Number(subPct || 0) / 100,
        earningMonths: Number(months || 12),
        payoutCapRate: Number(capPct || 0) / 100,
      });
      router.push(`/teams/${team.id}`);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the team.");
      setBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Marketing teams</h1>
          <div className="flex gap-2">
            <Link href="/teams/earnings" className="rounded-md border border-border px-4 py-2 text-sm font-medium no-underline hover:bg-secondary-500/5">
              Earnings &amp; payouts
            </Link>
            <Button onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "New team"}</Button>
          </div>
        </div>

        {showNew && (
          <form onSubmit={createTeam} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Team name
                <input required className="mt-1 w-full rounded-md border border-border bg-background p-2" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Western Team" />
              </label>
              <label className="text-sm">
                Region (optional)
                <input className="mt-1 w-full rounded-md border border-border bg-background p-2" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Kisumu and Siaya" />
              </label>
              <label className="text-sm">
                Member share (% of Zaroda&apos;s online-order commission)
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={memberPct} onChange={(e) => setMemberPct(e.target.value)} placeholder="e.g. 25" />
              </label>
              <label className="text-sm">
                Subscription share (% of each monthly subscription the shop pays)
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={subPct} onChange={(e) => setSubPct(e.target.value)} />
              </label>
              <label className="text-sm">
                Earning months (after the shop signs up)
                <input type="number" min={1} max={120} step="1" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={months} onChange={(e) => setMonths(e.target.value)} />
              </label>
              <label className="text-sm">
                Leader override (% of commission + subscriptions from all the team&apos;s shops)
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={leaderPct} onChange={(e) => setLeaderPct(e.target.value)} />
              </label>
              <label className="text-sm">
                Bonus per shop (KES, once it pays its second monthly subscription)
                <input type="number" min={0} step="1" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={bonus} onChange={(e) => setBonus(e.target.value)} />
              </label>
              <label className="text-sm">
                Payout cap (max % of Zaroda&apos;s revenue from one shop in a month, member + leader together)
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={capPct} onChange={(e) => setCapPct(e.target.value)} />
              </label>
            </div>
            <p className="text-xs text-secondary-500">You can change all of these later. A change only affects what is earned after it, never what was already earned.</p>
            {formError && <p className="text-sm text-error-600">{formError}</p>}
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating..." : "Create team"}
            </Button>
          </form>
        )}

        {loading && <LoadingState label="Loading teams..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!loading && !error && teams.length === 0 && <EmptyState title="No teams yet" description="Create a team, then give it a leader." />}

        <ul className="space-y-3">
          {teams.map((t) => (
            <li key={t.id}>
              <Link href={`/teams/${t.id}`} className="block rounded-lg border border-border bg-surface p-4 no-underline hover:border-amber-500">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{t.name}</span>
                      <Badge variant={t.status === "ACTIVE" ? "success" : "warning"}>{t.status === "ACTIVE" ? "Active" : "Paused"}</Badge>
                      {!t.leader && <Badge variant="warning">No leader yet</Badge>}
                    </div>
                    <p className="mt-0.5 text-sm text-secondary-500">
                      {t.region ? `${t.region} · ` : ""}
                      {t.leader ? `Leader: ${t.leader.fullName}` : "Add a leader to get started"}
                    </p>
                  </div>
                  <div className="text-right text-sm text-secondary-500">
                    <p>
                      {t.memberCount} member{t.memberCount === 1 ? "" : "s"} · {t.tenantCount} shop{t.tenantCount === 1 ? "" : "s"} · {t.riderCount} rider{t.riderCount === 1 ? "" : "s"}
                    </p>
                    <p>
                      Member {pct(t.memberShareRate)} · Leader {pct(t.leaderOverrideRate)} · Bonus KES {t.onboardingBonusKes.toLocaleString("en-KE")}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
