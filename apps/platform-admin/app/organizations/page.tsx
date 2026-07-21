"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

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
}

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
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-1 text-xl font-bold">Organizations</h1>
        <p className="mb-4 text-sm text-zinc-500">Every tenant on this deployment. Viewing this list is itself audit-logged.</p>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-zinc-400">Loading...</p>}
        {!loading && organizations.length === 0 && !error && <p className="text-zinc-400">No organizations exist yet.</p>}

        {organizations.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-400">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Industry</th>
                  <th className="p-3">Created</th>
                  <th className="p-3 text-right">Branches</th>
                  <th className="p-3 text-right">Staff</th>
                  <th className="p-3 text-right">Sales</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {organizations.map((org) => (
                  <tr key={org.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                    <td className="p-3 font-medium">{org.name}</td>
                    <td className="p-3 text-zinc-400">{org.industryType}</td>
                    <td className="p-3 text-zinc-400">{new Date(org.createdAt).toLocaleDateString()}</td>
                    <td className="p-3 text-right font-mono">{org.branchCount}</td>
                    <td className="p-3 text-right font-mono">{org.orgUserCount}</td>
                    <td className="p-3 text-right font-mono">{org.saleCount}</td>
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
