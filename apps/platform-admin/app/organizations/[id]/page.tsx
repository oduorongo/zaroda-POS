"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

interface Branch {
  id: string;
  name: string;
  county: string | null;
}

interface OrgUserRow {
  id: string;
  role: string;
  isActive: boolean;
  user: { fullName: string; email: string };
}

interface OrganizationDetail {
  id: string;
  name: string;
  industryType: string;
  country: string;
  baseCurrency: string;
  createdAt: string;
  branchCount: number;
  orgUserCount: number;
  saleCount: number;
  branches: Branch[];
  orgUsers: OrgUserRow[];
}

export default function OrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        setOrg(await apiGet<OrganizationDetail>(`/platform-admin/organizations/${params.id}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load this organization.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.id]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/organizations")} className="mb-4 text-amber-400 hover:underline">
          &larr; Organizations
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!org && !error && <p className="text-zinc-400">Loading...</p>}
        {org && (
          <>
            <h1 className="text-xl font-bold">{org.name}</h1>
            <p className="mt-1 text-sm text-zinc-500">
              {org.industryType} · {org.country} · {org.baseCurrency} · created {new Date(org.createdAt).toLocaleString()}
            </p>

            <div className="mt-6 grid grid-cols-3 gap-3">
              <Stat label="Branches" value={String(org.branchCount)} />
              <Stat label="Staff" value={String(org.orgUserCount)} />
              <Stat label="Sales" value={String(org.saleCount)} />
            </div>

            <section className="mt-6 rounded-lg border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 font-semibold">Branches</h2>
              {org.branches.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.branches.map((b) => (
                <div key={b.id} className="border-b border-zinc-800 p-3 text-sm last:border-b-0">
                  {b.name} {b.county && <span className="text-zinc-500">({b.county})</span>}
                </div>
              ))}
            </section>

            <section className="mt-4 rounded-lg border border-zinc-800">
              <h2 className="border-b border-zinc-800 bg-zinc-900 p-3 font-semibold">Staff</h2>
              {org.orgUsers.length === 0 && <p className="p-3 text-sm text-zinc-500">None yet.</p>}
              {org.orgUsers.map((u) => (
                <div key={u.id} className="border-b border-zinc-800 p-3 text-sm last:border-b-0">
                  <span className={u.isActive ? "" : "text-zinc-500 line-through"}>
                    {u.user.fullName} ({u.user.email})
                  </span>{" "}
                  <span className="text-zinc-500">- {u.role}</span>
                  {!u.isActive && <span className="ml-2 text-xs text-red-400">deactivated</span>}
                </div>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 p-3">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 font-mono text-lg">{value}</p>
    </div>
  );
}
