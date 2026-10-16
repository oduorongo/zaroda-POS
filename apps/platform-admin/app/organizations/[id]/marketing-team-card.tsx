"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPatch, ApiError } from "../../../lib/api";
import { Button } from "@zaroda/ui";

interface Assignment {
  signedUpAt: string;
  teamId: string | null;
  agentId: string | null;
  assignedAt: string | null;
  teams: { id: string; name: string; agents: { id: string; fullName: string; role: "LEADER" | "MEMBER"; status: "ACTIVE" | "SUSPENDED" }[] }[];
}

/**
 * Which marketing team and member signed this business. Set when it is signed up; only a platform admin can change it
 * here. The new member earns only on money Zaroda receives from now on, so changing it never moves earnings already made.
 */
export function MarketingTeamCard({ organizationId }: { organizationId: string }) {
  const [data, setData] = useState<Assignment | null>(null);
  const [teamId, setTeamId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const result = await apiGet<Assignment>(`/platform-admin/sales-teams/shops/${organizationId}`);
      setData(result);
      setTeamId(result.teamId ?? "");
      setAgentId(result.agentId ?? "");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the marketing team.");
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiPatch(`/platform-admin/sales-teams/shops/${organizationId}`, { teamId, agentId });
      setMessage("Saved. The new member earns on money received from now on.");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null;
  const team = data.teams.find((t) => t.id === teamId);
  const current = data.teams.flatMap((t) => t.agents).find((a) => a.id === data.agentId);
  const changed = teamId !== (data.teamId ?? "") || agentId !== (data.agentId ?? "");

  return (
    <section className="mt-4 rounded-lg border border-border">
      <h2 className="border-b border-border bg-surface p-3 font-semibold">Marketing team</h2>
      <div className="space-y-3 p-3 text-sm">
        <p className="text-secondary-500">
          {current ? `Signed by ${current.fullName}.` : "Not signed by a marketing team."} Signed up {new Date(data.signedUpAt).toLocaleDateString("en-KE")}
          {data.assignedAt && data.agentId ? `; with this member since ${new Date(data.assignedAt).toLocaleDateString("en-KE")}` : ""}.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label>
            Team
            <select
              className="mt-1 block rounded-md border border-border bg-background p-2"
              value={teamId}
              onChange={(e) => {
                setTeamId(e.target.value);
                setAgentId("");
              }}
            >
              <option value="">Choose a team</option>
              {data.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member who signed it
            <select className="mt-1 block rounded-md border border-border bg-background p-2" value={agentId} onChange={(e) => setAgentId(e.target.value)} disabled={!team}>
              <option value="">Choose a person</option>
              {team?.agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.fullName}
                  {a.role === "LEADER" ? " (leader)" : ""}
                  {a.status === "SUSPENDED" ? " - suspended" : ""}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" disabled={busy || !changed || !teamId || !agentId} onClick={() => void save()}>
            {busy ? "Saving..." : "Change"}
          </Button>
        </div>
        {message && <p className="text-green-400">{message}</p>}
        {error && <p className="text-red-400">{error}</p>}
      </div>
    </section>
  );
}
