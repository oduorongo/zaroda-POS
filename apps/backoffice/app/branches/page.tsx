"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Branch {
  id: string;
  name: string;
  county: string | null;
}

interface Terminal {
  id: string;
  branchId: string;
  deviceLabel: string;
}

export default function BranchesPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [terminals, setTerminals] = useState<Terminal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newBranchName, setNewBranchName] = useState("");
  const [newBranchCounty, setNewBranchCounty] = useState("");
  const [branchBusy, setBranchBusy] = useState(false);
  const [branchError, setBranchError] = useState<string | null>(null);

  const [terminalForBranchId, setTerminalForBranchId] = useState<string | null>(null);
  const [newTerminalLabel, setNewTerminalLabel] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [branchesResult, terminalsResult] = await Promise.all([
        apiGet<Branch[]>("/branches"),
        apiGet<Terminal[]>("/terminals"),
      ]);
      setBranches(branchesResult);
      setTerminals(terminalsResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load branches.");
    } finally {
      setLoading(false);
    }
  }

  async function createBranch() {
    if (!newBranchName.trim()) return;
    setBranchBusy(true);
    setBranchError(null);
    try {
      await apiPost("/branches", { name: newBranchName.trim(), county: newBranchCounty.trim() || undefined });
      setNewBranchName("");
      setNewBranchCounty("");
      await load();
    } catch (err) {
      setBranchError(err instanceof ApiError ? err.message : "Could not create branch.");
    } finally {
      setBranchBusy(false);
    }
  }

  async function createTerminal(branchId: string) {
    if (!newTerminalLabel.trim()) return;
    setTerminalBusy(true);
    setTerminalError(null);
    try {
      await apiPost("/terminals", { branchId, deviceLabel: newTerminalLabel.trim() });
      setTerminalForBranchId(null);
      setNewTerminalLabel("");
      await load();
    } catch (err) {
      setTerminalError(err instanceof ApiError ? err.message : "Could not create terminal.");
    } finally {
      setTerminalBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-bold">Branches</h1>

        <section className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">New branch</h2>
          <div className="flex flex-wrap gap-2">
            <input
              placeholder="Name"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
            />
            <input
              placeholder="County (optional)"
              value={newBranchCounty}
              onChange={(e) => setNewBranchCounty(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
            />
            <button
              onClick={() => void createBranch()}
              disabled={branchBusy || !newBranchName.trim()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
            >
              {branchBusy ? "Creating..." : "Create"}
            </button>
          </div>
          {branchError && <p className="mt-2 text-sm text-red-400">{branchError}</p>}
        </section>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        <div className="space-y-3">
          {branches.map((branch) => (
            <div key={branch.id} className="rounded-lg border border-slate-800 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold">{branch.name}</p>
                  <p className="text-xs text-slate-400">{branch.county ?? "No county set"}</p>
                </div>
                <button
                  onClick={() => setTerminalForBranchId(terminalForBranchId === branch.id ? null : branch.id)}
                  className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
                >
                  + Terminal
                </button>
              </div>

              {terminals.filter((t) => t.branchId === branch.id).length > 0 && (
                <ul className="mt-2 space-y-1 text-sm text-slate-400">
                  {terminals
                    .filter((t) => t.branchId === branch.id)
                    .map((t) => (
                      <li key={t.id}>
                        {t.deviceLabel} <span className="font-mono text-xs">({t.id})</span>
                      </li>
                    ))}
                </ul>
              )}

              {terminalForBranchId === branch.id && (
                <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
                  <input
                    placeholder="Terminal name"
                    value={newTerminalLabel}
                    onChange={(e) => setNewTerminalLabel(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <button
                    onClick={() => void createTerminal(branch.id)}
                    disabled={terminalBusy || !newTerminalLabel.trim()}
                    className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                  >
                    {terminalBusy ? "Saving..." : "Save"}
                  </button>
                  {terminalError && <p className="text-sm text-red-400">{terminalError}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
