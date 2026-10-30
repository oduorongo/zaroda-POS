"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../../lib/api";
import { CON_BRAND, errorText, type ConMe, type ConStatus } from "../../lib/construction";
import { ConShell } from "../../components/construction/con-shell";
import { ErrorBox, ExpiryBadge, Panel, type ExpiryState } from "../../components/construction/ui";

interface Dashboard {
  me: ConMe;
  plan: { planName: string; status: ConStatus; currentPeriodEnd: string; daysLeft: number; usage: Record<string, number>; limits: Record<string, number | null> };
  compliance: {
    health: "GOOD" | "ATTENTION" | "CRITICAL";
    counts: { ok: number; expiring: number; expired: number; noExpiry: number };
    missing: string[];
    attention: { id: string; name: string; expiresAt: string | null; state: ExpiryState; daysLeft: number | null }[];
  };
  alerts: { unread: number; latest: { id: string; title: string; body: string; createdAt: string; readAt: string | null }[] };
}

const HEALTH = {
  GOOD: { label: "Good", colour: "#16a34a", text: "Everything is valid." },
  ATTENTION: { label: "Needs attention", colour: CON_BRAND.orange, text: "Something expires soon or is missing." },
  CRITICAL: { label: "Critical", colour: "#dc2626", text: "A document has expired - renew it before tendering." },
};

export default function ConstructionHome() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    apiGet<Dashboard>("/construction/dashboard")
      .then((d) => (setData(d), setError(null)))
      .catch((e) => setError(errorText(e, "Could not load the dashboard.")));
  useEffect(() => {
    void load();
  }, []);

  const h = data ? HEALTH[data.compliance.health] : null;
  return (
    <ConShell title="Construction dashboard">
      <ErrorBox message={error} />
      {!data && !error && <p className="text-sm text-secondary-500">Loading...</p>}
      {data && h && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel title="Compliance health" action={<Link href="/construction/compliance" className="text-sm font-medium" style={{ color: CON_BRAND.orange }}>Open vault</Link>}>
            <div className="flex items-center gap-3">
              <span className="h-4 w-4 rounded-full" style={{ background: h.colour }} />
              <span className="text-lg font-bold" style={{ color: h.colour }}>{h.label}</span>
            </div>
            <p className="mt-1 text-sm text-secondary-600">{h.text}</p>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
              <Count n={data.compliance.counts.ok + data.compliance.counts.noExpiry} label="Valid" colour="#16a34a" />
              <Count n={data.compliance.counts.expiring} label="Expiring" colour={CON_BRAND.orange} />
              <Count n={data.compliance.counts.expired} label="Expired" colour="#dc2626" />
            </div>
            {data.compliance.missing.length > 0 && <p className="mt-3 text-sm text-secondary-700">Missing: {data.compliance.missing.join(", ")}</p>}
            {data.compliance.attention.length > 0 && (
              <ul className="mt-3 divide-y divide-border text-sm">
                {data.compliance.attention.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="min-w-0 truncate">{a.name}</span>
                    <ExpiryBadge state={a.state} daysLeft={a.daysLeft} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Your plan" action={<Link href="/construction/plan" className="text-sm font-medium" style={{ color: CON_BRAND.orange }}>Manage</Link>}>
            <p className="text-lg font-bold" style={{ color: CON_BRAND.navy }}>{data.plan.planName}</p>
            <p className="text-sm text-secondary-600">
              {data.plan.status === "TRIAL" ? `Free trial - ${Math.max(data.plan.daysLeft, 0)} days left` : `${data.plan.status} - paid to ${new Date(data.plan.currentPeriodEnd).toLocaleDateString("en-KE")}`}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              <li>Staff users: {data.plan.usage.users} of {data.plan.limits.users ?? "unlimited"}</li>
              <li>Active projects: {data.plan.usage.activeProjects} of {data.plan.limits.activeProjects ?? "unlimited"}</li>
              <li>Workers: {data.plan.usage.workers} of {data.plan.limits.workers ?? "unlimited"}</li>
            </ul>
          </Panel>

          <Panel
            title={`Alerts${data.alerts.unread ? ` (${data.alerts.unread} new)` : ""}`}
            action={
              data.alerts.unread > 0 && (
                <button type="button" className="text-sm font-medium" style={{ color: CON_BRAND.orange }} onClick={() => apiPost("/construction/alerts/read", {}).then(load)}>
                  Mark all read
                </button>
              )
            }
          >
            {data.alerts.latest.length === 0 ? (
              <p className="text-sm text-secondary-500">No alerts yet. Expiry alerts arrive 60, 30 and 7 days before a document expires.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {data.alerts.latest.map((a) => (
                  <li key={a.id} className="py-2">
                    <p className={a.readAt ? "text-secondary-600" : "font-semibold"}>{a.title}</p>
                    <p className="text-xs text-secondary-500">{a.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Coming next">
            <p className="text-sm text-secondary-600">Projects, BQ, site diary, labour, materials and valuations arrive in the next phases.</p>
          </Panel>
        </div>
      )}
    </ConShell>
  );
}

function Count({ n, label, colour }: { n: number; label: string; colour: string }) {
  return (
    <div className="rounded-lg bg-background p-2">
      <p className="text-xl font-bold" style={{ color: colour }}>{n}</p>
      <p className="text-xs text-secondary-500">{label}</p>
    </div>
  );
}
