"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Badge, Button, LoadingState } from "@zaroda/ui";

interface Agent {
  id: string;
  role: "LEADER" | "MEMBER";
  fullName: string;
  email: string;
  phone: string | null;
  status: "ACTIVE" | "SUSPENDED";
  mustChangePassword: boolean;
  lastLoginAt: string | null;
}

interface Team {
  id: string;
  name: string;
  region: string | null;
  status: "ACTIVE" | "PAUSED";
  memberShareRate: number;
  leaderOverrideRate: number;
  onboardingBonusKes: number;
  tenantCount: number;
  riderCount: number;
  agents: Agent[];
}

const toPct = (n: number) => String(Math.round(n * 10000) / 100);

/** One marketing team: its terms, its leader and members. Temporary passwords are shown once, here, to pass on. */
export default function TeamDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [region, setRegion] = useState("");
  const [memberPct, setMemberPct] = useState("");
  const [leaderPct, setLeaderPct] = useState("");
  const [bonus, setBonus] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [adding, setAdding] = useState<"LEADER" | "MEMBER" | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [replace, setReplace] = useState(false);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [secret, setSecret] = useState<{ who: string; email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  function apply(t: Team) {
    setTeam(t);
    setName(t.name);
    setRegion(t.region ?? "");
    setMemberPct(toPct(t.memberShareRate));
    setLeaderPct(toPct(t.leaderOverrideRate));
    setBonus(String(t.onboardingBonusKes));
  }

  async function load() {
    setLoading(true);
    try {
      apply(await apiGet<Team>(`/platform-admin/sales-teams/${id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the team.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function saveTerms(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await apiPatch(`/platform-admin/sales-teams/${id}`, {
        name: name.trim(),
        region: region.trim(),
        memberShareRate: Number(memberPct || 0) / 100,
        leaderOverrideRate: Number(leaderPct || 0) / 100,
        onboardingBonusKes: Number(bonus || 0),
      });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function setTeamStatus(status: "ACTIVE" | "PAUSED") {
    setError(null);
    try {
      await apiPatch(`/platform-admin/sales-teams/${id}`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the team's status.");
    }
  }

  async function addAgent(e: React.FormEvent) {
    e.preventDefault();
    if (!adding) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const result = await apiPost<{ agent: Agent; temporaryPassword: string }>(
        `/platform-admin/sales-teams/${id}/${adding === "LEADER" ? "leader" : "members"}`,
        {
          fullName: fullName.trim(),
          email: email.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(adding === "LEADER" && replace ? { replaceExistingLeader: true } : {}),
        },
      );
      setSecret({ who: result.agent.fullName, email: result.agent.email, password: result.temporaryPassword });
      setAdding(null);
      setFullName("");
      setEmail("");
      setPhone("");
      setReplace(false);
      await load();
    } catch (err) {
      setAddError(err instanceof ApiError ? err.message : "Could not add the person.");
    } finally {
      setAddBusy(false);
    }
  }

  async function setAgentStatus(agent: Agent, status: "ACTIVE" | "SUSPENDED") {
    setBusyId(agent.id);
    setError(null);
    try {
      await apiPatch(`/platform-admin/sales-agents/${agent.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change their status.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(agent: Agent) {
    if (!confirm(`Give ${agent.fullName} a new temporary password? Their current password stops working.`)) return;
    setBusyId(agent.id);
    setError(null);
    try {
      const result = await apiPost<{ temporaryPassword: string }>(`/platform-admin/sales-agents/${agent.id}/reset-password`, {});
      setSecret({ who: agent.fullName, email: agent.email, password: result.temporaryPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return null;

  const leader = team?.agents.find((a) => a.role === "LEADER" && a.status === "ACTIVE") ?? null;
  const members = team?.agents.filter((a) => a.role === "MEMBER") ?? [];
  const pastLeaders = team?.agents.filter((a) => a.role === "LEADER" && a.status !== "ACTIVE") ?? [];

  const person = (a: Agent) => (
    <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{a.fullName}</span>
          <Badge variant={a.status === "ACTIVE" ? "success" : "error"}>{a.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
          {a.mustChangePassword && <Badge variant="warning">Has not set a password yet</Badge>}
        </div>
        <p className="text-sm text-secondary-500">
          {a.email}
          {a.phone ? ` · ${a.phone}` : ""} · {a.lastLoginAt ? `last signed in ${new Date(a.lastLoginAt).toLocaleDateString("en-KE")}` : "never signed in"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => void resetPassword(a)}>
          New password
        </Button>
        {a.status === "ACTIVE" ? (
          <Button variant="secondary" size="sm" disabled={busyId === a.id} onClick={() => void setAgentStatus(a, "SUSPENDED")}>
            Suspend
          </Button>
        ) : (
          <Button size="sm" disabled={busyId === a.id} onClick={() => void setAgentStatus(a, "ACTIVE")}>
            Reactivate
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <a href="/teams" className="text-sm text-secondary-500 hover:text-foreground">
          &larr; All teams
        </a>
        {loading && <LoadingState label="Loading team..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}

        {secret && (
          <div className="rounded-lg border border-warning-600/40 bg-warning-50 p-4 text-sm">
            <p className="font-semibold">Temporary password for {secret.who}</p>
            <p className="mt-1">
              Email: <b>{secret.email}</b>
            </p>
            <p>
              Password: <b className="font-mono text-base">{secret.password}</b>
            </p>
            <p className="mt-2 text-secondary-600">
              Share this with them now - it is shown once and cannot be looked up later. They sign in at <b>/team/login</b> and must choose their own password
              straight away.
            </p>
            <Button size="sm" variant="secondary" className="mt-2" onClick={() => setSecret(null)}>
              I have passed it on
            </Button>
          </div>
        )}

        {team && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-bold">{team.name}</h1>
                <p className="text-sm text-secondary-500">
                  {team.tenantCount} shop{team.tenantCount === 1 ? "" : "s"} · {team.riderCount} rider{team.riderCount === 1 ? "" : "s"} brought in
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={team.status === "ACTIVE" ? "success" : "warning"}>{team.status === "ACTIVE" ? "Active" : "Paused"}</Badge>
                {team.status === "ACTIVE" ? (
                  <Button variant="secondary" size="sm" onClick={() => void setTeamStatus("PAUSED")}>
                    Pause team
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => void setTeamStatus("ACTIVE")}>
                    Resume team
                  </Button>
                )}
              </div>
            </div>
            {team.status === "PAUSED" && <p className="text-sm text-secondary-500">While paused, nobody on this team can sign in.</p>}

            <form onSubmit={saveTerms} className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Name and earning terms</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">
                  Team name
                  <input required className="mt-1 w-full rounded-md border border-border bg-background p-2" value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="text-sm">
                  Region
                  <input className="mt-1 w-full rounded-md border border-border bg-background p-2" value={region} onChange={(e) => setRegion(e.target.value)} />
                </label>
                <label className="text-sm">
                  Member share (% of Zaroda&apos;s online-order commission)
                  <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={memberPct} onChange={(e) => setMemberPct(e.target.value)} />
                </label>
                <label className="text-sm">
                  Leader override (% of the whole team&apos;s earnings)
                  <input type="number" min={0} max={100} step="0.01" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={leaderPct} onChange={(e) => setLeaderPct(e.target.value)} />
                </label>
                <label className="text-sm">
                  Bonus per shop (KES, when it pays its first monthly subscription)
                  <input type="number" min={0} step="1" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={bonus} onChange={(e) => setBonus(e.target.value)} />
                </label>
              </div>
              <p className="text-xs text-secondary-500">A change only affects what is earned after it, never what was already earned.</p>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
                {saved && <span className="text-sm text-success-600">Saved.</span>}
              </div>
            </form>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Team leader</h2>
                <Button size="sm" variant="secondary" onClick={() => { setAdding(adding === "LEADER" ? null : "LEADER"); setAddError(null); }}>
                  {leader ? "Replace leader" : "Add leader"}
                </Button>
              </div>
              {leader ? <ul>{person(leader)}</ul> : <p className="text-sm text-secondary-500">This team has no leader yet.</p>}
              {pastLeaders.length > 0 && (
                <details className="text-sm text-secondary-500">
                  <summary className="cursor-pointer">Earlier leaders ({pastLeaders.length})</summary>
                  <ul className="mt-2 space-y-2">{pastLeaders.map(person)}</ul>
                </details>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-semibold">Members ({members.length})</h2>
                <Button size="sm" variant="secondary" onClick={() => { setAdding(adding === "MEMBER" ? null : "MEMBER"); setAddError(null); }}>
                  Add member
                </Button>
              </div>
              {members.length === 0 && <p className="text-sm text-secondary-500">No members yet. The leader will be able to add members once they sign in.</p>}
              <ul className="space-y-2">{members.map(person)}</ul>
            </section>

            {adding && (
              <form onSubmit={addAgent} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                <h2 className="font-semibold">{adding === "LEADER" ? (leader ? "Replace the team leader" : "Add the team leader") : "Add a member"}</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">
                    Full name
                    <input required className="mt-1 w-full rounded-md border border-border bg-background p-2" value={fullName} onChange={(e) => setFullName(e.target.value)} />
                  </label>
                  <label className="text-sm">
                    Email (their sign-in)
                    <input required type="email" className="mt-1 w-full rounded-md border border-border bg-background p-2" value={email} onChange={(e) => setEmail(e.target.value)} />
                  </label>
                  <label className="text-sm">
                    Phone (optional)
                    <input className="mt-1 w-full rounded-md border border-border bg-background p-2" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
                  </label>
                </div>
                {adding === "LEADER" && leader && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                    Suspend {leader.fullName} and make this person the leader
                  </label>
                )}
                {addError && <p className="text-sm text-error-600">{addError}</p>}
                <Button type="submit" disabled={addBusy || !fullName.trim() || !email.trim() || (adding === "LEADER" && !!leader && !replace)}>
                  {addBusy ? "Creating..." : "Create account"}
                </Button>
                <p className="text-xs text-secondary-500">A temporary password is created and shown once for you to pass on.</p>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
