"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface SaleSummary {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  branchId: string;
}

export default function SalesListPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [sales, setSales] = useState<SaleSummary[]>([]);
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
        const result = await apiGet<SaleSummary[]>("/sales");
        setSales([...result].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load sales.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl p-6">
        <h1 className="mb-4 text-xl font-bold">Sales</h1>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && sales.length === 0 && !error && <p className="text-slate-400">No sales yet.</p>}
        {sales.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-3">Created</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Total (KES)</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {sales.map((sale) => (
                  <tr key={sale.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">{new Date(sale.createdAt).toLocaleString()}</td>
                    <td className="p-3">{sale.status}</td>
                    <td className="p-3 text-right font-mono">{Number(sale.total).toFixed(2)}</td>
                    <td className="p-3 text-right">
                      <Link href={`/sales/${sale.id}`} className="text-blue-400 hover:underline">
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
