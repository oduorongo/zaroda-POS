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
  const [memberPct, setMemberPct] = useState("");
  const [leaderPct, setLeaderPct] = useState("");
  const [bonus, setBonus] = useState("");
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
          <Button onClick={() => setShowNew((v) => !v)}>{showNew ? "Cancel" : "New team"}</Button>
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
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={memberPct} onChange={(e) => setMemberPct(e.target.value)} placeholder="e.g. 30" />
              </label>
              <label className="text-sm">
                Leader override (% of the whole team&apos;s earnings)
                <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={leaderPct} onChange={(e) => setLeaderPct(e.target.value)} placeholder="e.g. 5" />
              </label>
              <label className="text-sm">
                Bonus per shop (KES, once it pays its first monthly subscription)
                <input type="number" min={0} step="1" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={bonus} onChange={(e) => setBonus(e.target.value)} placeholder="e.g. 500" />
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
