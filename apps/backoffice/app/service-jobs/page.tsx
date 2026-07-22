"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Branch {
  id: string;
  name: string;
}

type JobStatus = "OPEN" | "IN_PROGRESS" | "WAITING_PARTS" | "COMPLETED" | "CANCELLED";

interface ServiceJob {
  id: string;
  assetLabel: string | null;
  description: string;
  status: JobStatus;
  notes: string | null;
  createdAt: string;
  customer: { name: string } | null;
  sale: { saleId: string } | null;
}

const STATUS_COLOR: Record<JobStatus, string> = {
  OPEN: "text-slate-400",
  IN_PROGRESS: "text-amber-400",
  WAITING_PARTS: "text-orange-400",
  COMPLETED: "text-green-400",
  CANCELLED: "text-red-400",
};

const NEXT_STATUS: Record<JobStatus, JobStatus[]> = {
  OPEN: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["WAITING_PARTS", "COMPLETED", "CANCELLED"],
  WAITING_PARTS: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

/**
 * Job creation and status tracking - invoicing (parts + labor billed
 * against inventory, via /service-jobs/:id/invoice) happens on the
 * terminal PWA, same "manager overview, not the working screen" split as
 * the salon module's back-office bookings page.
 */
export default function ServiceJobsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [jobs, setJobs] = useState<ServiceJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [assetLabel, setAssetLabel] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void (async () => {
      try {
        const branchList = await apiGet<Branch[]>("/branches");
        setBranches(branchList);
        setBranchId(branchList[0]?.id ?? "");
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load branches.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!branchId.trim()) return;
    void loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  async function loadJobs() {
    setLoading(true);
    try {
      setJobs(await apiGet<ServiceJob[]>(`/service-jobs?branchId=${branchId}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load service jobs.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setFormError(null);
    if (!branchId.trim() || !description.trim()) {
      setFormError("Describe the job before creating it.");
      return;
    }
    setBusy(true);
    try {
      await apiPost("/service-jobs", {
        branchId,
        assetLabel: assetLabel.trim() || undefined,
        description: description.trim(),
      });
      setAssetLabel("");
      setDescription("");
      await loadJobs();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create the service job.");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: JobStatus) {
    try {
      await apiPatch(`/service-jobs/${id}/status`, { status });
      await loadJobs();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the job status.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-bold">Job Orders</h1>
        <p className="mb-4 text-sm text-slate-400">
          Track work against a customer&apos;s vehicle, route, or other asset. Invoicing a completed job (billing
          parts and labor) happens at the terminal.
        </p>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <div className="mb-4">
          <label className="block text-xs text-slate-400">Branch</label>
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="mt-1 w-full max-w-md rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
          >
            {branches.length === 0 && <option value="">No branches found</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Open a job</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">Asset (plate, route...) - optional</label>
              <input
                value={assetLabel}
                onChange={(e) => setAssetLabel(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400">Description</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
          </div>

          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}

          <button
            onClick={() => void submit()}
            disabled={busy || !branchId.trim() || !description.trim()}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {busy ? "Saving..." : "Open job"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Jobs at this branch</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-slate-500">No jobs yet.</p>
          ) : (
            <div className="space-y-2">
              {jobs.map((j) => (
                <div key={j.id} className="rounded-md bg-slate-900 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p>
                      {j.description}
                      {j.assetLabel ? ` · ${j.assetLabel}` : ""}
                      {j.customer ? ` · ${j.customer.name}` : ""}
                    </p>
                    <span className={`text-xs uppercase tracking-wide ${STATUS_COLOR[j.status]}`}>
                      {j.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {new Date(j.createdAt).toLocaleString()}
                    {j.notes ? ` · ${j.notes}` : ""}
                    {j.sale ? " · invoiced" : ""}
                  </p>

                  {NEXT_STATUS[j.status].length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {NEXT_STATUS[j.status].map((next) => (
                        <button
                          key={next}
                          onClick={() => void setStatus(j.id, next)}
                          className="rounded-md bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
                        >
                          Mark {next.replace("_", " ").toLowerCase()}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
