"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, EmptyState, ErrorState, LoadingState } from "@zaroda/ui";

interface Organization {
  id: string;
  name: string;
  industryType: string;
  country: string;
  baseCurrency: string;
  createdAt: string;
  branchCount: number;
  orgUserCount: number;
  saleCount: number;
  terminalCount: number;
  subscription: {
    planTier: string;
    planName: string;
    currentPeriodEnd: string;
    status: "TRIAL" | "ACTIVE" | "GRACE" | "SUSPENDED";
  } | null;
}

const STATUS_VARIANT: Record<string, "primary" | "success" | "warning" | "error" | "neutral"> = {
  TRIAL: "primary",
  ACTIVE: "success",
  GRACE: "warning",
  SUSPENDED: "error",
};

export default function OrganizationsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        setOrganizations(await apiGet<Organization[]>("/platform-admin/organizations"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load organizations.");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Tenants</h1>
            <p className="text-sm text-zinc-500">Every shop rented out on this deployment. Viewing this list is itself audit-logged.</p>
          </div>
          <Link href="/tenants/new" className="rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-400">
            + New tenant
          </Link>
        </div>

        {loading && <LoadingState label="Loading tenants..." />}
        {!loading && error && <ErrorState description={error} />}
        {!loading && !error && organizations.length === 0 && (
          <EmptyState title="No tenants yet" description="Onboard the first shop to get started." />
        )}

        {!loading && !error && organizations.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Industry</th>
                  <th className="p-3">Plan</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Next billing date</th>
                  <th className="p-3 text-right">Branches</th>
                  <th className="p-3 text-right">Devices</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                    <td className="p-3 font-medium">{org.name}</td>
                    <td className="p-3 text-zinc-400">{org.industryType}</td>
                    <td className="p-3 text-zinc-400">{org.subscription?.planName ?? "—"}</td>
                    <td className="p-3">
                      {org.subscription ? (
                        <Badge variant={STATUS_VARIANT[org.subscription.status]}>{org.subscription.status}</Badge>
                      ) : (
                        <Badge variant="neutral">No subscription</Badge>
                      )}
                    </td>
                    <td className="p-3 text-zinc-400">
                      {org.subscription ? new Date(org.subscription.currentPeriodEnd).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-right font-mono">{org.branchCount}</td>
                    <td className="p-3 text-right font-mono">{org.terminalCount}</td>
                    <td className="p-3 text-right">
                      <Link href={`/organizations/${org.id}`} className="text-amber-400 hover:underline">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
