"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Card, CardContent, LoadingState } from "@zaroda/ui";

interface Analytics {
  tenantCount: number;
  subscriptionsByStatus: Record<string, number>;
  mrrKes: number;
  deviceCount: number;
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <Card className="border-zinc-800 bg-zinc-900">
      <CardContent>
        <p className="text-sm text-zinc-500">{label}</p>
        <p className={`mt-1 text-3xl font-bold ${accent ? "text-amber-400" : "text-zinc-100"}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [data, setData] = useState<Analytics | null>(null);
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
        setData(await apiGet<Analytics>("/platform-admin/analytics"));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load analytics.");
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
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Platform Analytics</h1>

        {loading && <LoadingState label="Loading analytics..." />}
        {!loading && error && <p className="text-sm text-error-500">{error}</p>}

        {!loading && data && (
          <>
            <div className="grid gap-4 sm:grid-cols-4">
              <StatCard label="Total tenants" value={String(data.tenantCount)} />
              <StatCard label="MRR" value={`KES ${data.mrrKes.toLocaleString()}`} accent />
              <StatCard label="Active devices" value={String(data.deviceCount)} />
              <StatCard label="Suspended" value={String(data.subscriptionsByStatus.SUSPENDED ?? 0)} />
            </div>

            <Card className="border-zinc-800 bg-zinc-900">
              <CardContent>
                <p className="mb-3 text-sm font-semibold text-zinc-300">Subscriptions by status</p>
                <div className="space-y-2">
                  {(["TRIAL", "ACTIVE", "GRACE", "SUSPENDED"] as const).map((status) => {
                    const count = data.subscriptionsByStatus[status] ?? 0;
                    const pct = data.tenantCount > 0 ? Math.round((count / data.tenantCount) * 100) : 0;
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <span className="w-24 text-sm text-zinc-400">{status}</span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800">
                          <div className="h-full bg-amber-500" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-sm text-zinc-400">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
