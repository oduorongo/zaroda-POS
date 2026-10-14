"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, teamPatch, teamPost, type TeamMe, type TeamMember } from "../../../lib/team-api";

const inputClass = "mt-1 w-full rounded-md border border-border bg-background p-2";

function MembersBody({ me }: { me: TeamMe }) {
  const [members, setMembers] = useState<TeamMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ who: string; email: string; password: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const isLeader = me.agent.role === "LEADER";

  async function load() {
    try {
      setMembers(await teamGet<TeamMember[]>("/members"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your members.");
    }
  }

  useEffect(() => {
    if (isLeader) void load();
  }, [isLeader]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const result = await teamPost<{ agent: TeamMember; temporaryPassword: string }>("/members", {
        fullName: fullName.trim(),
        email: email.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setSecret({ who: result.agent.fullName, email: result.agent.email, password: result.temporaryPassword });
      setShowForm(false);
      setFullName("");
      setEmail("");
      setPhone("");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the member.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(m: TeamMember, status: "ACTIVE" | "SUSPENDED") {
    setBusyId(m.id);
    setError(null);
    try {
      await teamPatch(`/members/${m.id}/status`, { status });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change their status.");
    } finally {
      setBusyId(null);
    }
  }

  async function resetPassword(m: TeamMember) {
    if (!confirm(`Give ${m.fullName} a new temporary password? Their current password stops working.`)) return;
    setBusyId(m.id);
    setError(null);
    try {
      const result = await teamPost<{ temporaryPassword: string }>(`/members/${m.id}/reset-password`, {});
      setSecret({ who: m.fullName, email: m.email, password: result.temporaryPassword });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the password.");
    } finally {
      setBusyId(null);
    }
  }

  if (!isLeader) return <EmptyState title="Team leaders only" description="Members are managed by the team leader." />;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">Your members</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add a member"}</Button>
      </div>

      {secret && (
        <div className="rounded-lg border border-warning-600/40 bg-warning-50 p-4 text-sm">
          <p className="font-semibold">Temporary password for {secret.who}</p>
          <p className="mt-1">
            Email: <b>{secret.email}</b>
          </p>
          <p>
            Password: <b className="font-mono text-base">{secret.password}</b>
          </p>
          <p className="mt-2 text-secondary-600">Share this with them now - it is shown once. They sign in at /team/login and must choose their own password straight away.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setSecret(null)}>
            I have passed it on
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={add} className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm">
              Full name
              <input required className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="text-sm">
              Email (their sign-in)
              <input required type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="text-sm">
              Phone (optional)
              <input className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </label>
          </div>
          {formError && <p className="text-sm text-error-600">{formError}</p>}
          <Button type="submit" disabled={busy || !fullName.trim() || !email.trim()}>
            {busy ? "Creating..." : "Create account"}
          </Button>
        </form>
      )}

      {!members && !error && <LoadingState label="Loading members..." />}
      {error && <p className="text-sm text-error-600">{error}</p>}
      {members && members.length === 0 && <EmptyState title="No members yet" description="Add your first team member." />}

      <ul className="space-y-3">
        {members?.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface p-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{m.fullName}</span>
                <Badge variant={m.status === "ACTIVE" ? "success" : "error"}>{m.status === "ACTIVE" ? "Active" : "Suspended"}</Badge>
                {m.mustChangePassword && <Badge variant="warning">Has not set a password yet</Badge>}
              </div>
              <p className="text-sm text-secondary-500">
                {m.email}
                {m.phone ? ` · ${m.phone}` : ""} · {m.shopCount} shop{m.shopCount === 1 ? "" : "s"} · {m.riderCount} rider{m.riderCount === 1 ? "" : "s"} ·{" "}
                {m.lastLoginAt ? `last signed in ${new Date(m.lastLoginAt).toLocaleDateString("en-KE")}` : "never signed in"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={busyId === m.id} onClick={() => void resetPassword(m)}>
                New password
              </Button>
              {m.status === "ACTIVE" ? (
                <Button variant="secondary" size="sm" disabled={busyId === m.id} onClick={() => void setStatus(m, "SUSPENDED")}>
                  Suspend
                </Button>
              ) : (
                <Button size="sm" disabled={busyId === m.id} onClick={() => void setStatus(m, "ACTIVE")}>
                  Reactivate
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TeamMembersPage() {
  return <TeamShell active="members">{(me) => <MembersBody me={me} />}</TeamShell>;
}
