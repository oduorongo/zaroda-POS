"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, type TeamMe } from "../../../lib/team-api";

interface TeamSchool {
  id: string;
  name: string;
  signedUpAt: string;
  active: boolean;
  broughtInBy: string;
  payments: number;
  paidKes: number;
  lastPaidAt: string | null;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

function SchoolsBody({ me }: { me: TeamMe }) {
  const [data, setData] = useState<{ signupUrl: string; schools: TeamSchool[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    teamGet<{ signupUrl: string; schools: TeamSchool[] }>("/schools")
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load schools."));
  }, []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.signupUrl);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const isLeader = me.agent.role === "LEADER";

  return (
    <>
      <h1 className="text-xl font-bold">{isLeader ? "Your team's schools" : "Your schools"}</h1>

      {data && (
        <div className="space-y-2 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-semibold">Your Zaroda School sign-up link</p>
          <p className="break-all font-mono text-xs">{data.signupUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy link"}</Button>
          </div>
          <p className="text-xs text-secondary-500">
            Send this link to a school. When it signs up through it, the school is credited to you for good and you earn on every subscription it pays, at
            your team&apos;s usual rates. A school can also type your phone number or email as the marketer when it signs up.
          </p>
        </div>
      )}

      {!data && !error && <LoadingState label="Loading schools..." />}
      {error && <p className="text-sm text-error-600">{error}</p>}
      {data && data.schools.length === 0 && <EmptyState title="No schools yet" description="Schools that sign up with your link appear here." />}

      <ul className="space-y-3">
        {data?.schools.map((s) => (
          <li key={s.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{s.name}</span>
                  {s.payments > 0 ? <Badge variant="success">Paying</Badge> : <Badge variant="warning">Not paid yet</Badge>}
                  {!s.active && <Badge variant="error">Suspended</Badge>}
                </div>
                <p className="text-sm text-secondary-500">
                  Signed up {new Date(s.signedUpAt).toLocaleDateString("en-KE")}
                  {isLeader ? ` · by ${s.broughtInBy}` : ""}
                </p>
              </div>
              <div className="text-right text-sm text-secondary-500">
                <p>
                  {kes(s.paidKes)} paid in {s.payments} payment{s.payments === 1 ? "" : "s"}
                </p>
                {s.lastPaidAt && <p>Last paid {new Date(s.lastPaidAt).toLocaleDateString("en-KE")}</p>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TeamSchoolsPage() {
  return <TeamShell active="schools">{(me) => <SchoolsBody me={me} />}</TeamShell>;
}
