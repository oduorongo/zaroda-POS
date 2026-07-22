"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface OrgUser {
  id: string;
  role: string;
  isActive: boolean;
  user: { fullName: string };
}

type PayType = "SALARY" | "HOURLY";

interface PayrollProfile {
  id: string;
  payType: PayType;
  baseSalary: number | null;
  hourlyRate: number | null;
  active: boolean;
  orgUser: { id: string; user: { fullName: string } };
}

type RunStatus = "DRAFT" | "APPROVED" | "PAID";

interface Payslip {
  id: string;
  payType: PayType;
  hoursWorked: number | null;
  grossPay: number;
  payeTax: number;
  nssfDeduction: number;
  shifDeduction: number;
  housingLevy: number;
  totalDeductions: number;
  netPay: number;
  orgUser: { id: string; user: { fullName: string } };
}

interface PayrollRun {
  id: string;
  periodStart: string;
  periodEnd: string;
  status: RunStatus;
  payslips: Payslip[];
}

const STATUS_COLOR: Record<RunStatus, string> = {
  DRAFT: "text-slate-400",
  APPROVED: "text-amber-400",
  PAID: "text-green-400",
};

function money(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PayrollPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [profileOrgUserId, setProfileOrgUserId] = useState("");
  const [profilePayType, setProfilePayType] = useState<PayType>("SALARY");
  const [profileBaseSalary, setProfileBaseSalary] = useState("");
  const [profileHourlyRate, setProfileHourlyRate] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

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
    try {
      const [orgUserList, profileList, runList] = await Promise.all([
        apiGet<OrgUser[]>("/org-users"),
        apiGet<PayrollProfile[]>("/payroll/profiles"),
        apiGet<PayrollRun[]>("/payroll/runs"),
      ]);
      setOrgUsers(orgUserList);
      setProfiles(profileList);
      setRuns(runList);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load payroll data.");
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setProfileError(null);
    if (!profileOrgUserId) {
      setProfileError("Pick a staff member.");
      return;
    }
    const baseSalary = Number(profileBaseSalary);
    const hourlyRate = Number(profileHourlyRate);
    if (profilePayType === "SALARY" && (!Number.isFinite(baseSalary) || baseSalary <= 0)) {
      setProfileError("Enter a positive monthly base salary.");
      return;
    }
    if (profilePayType === "HOURLY" && (!Number.isFinite(hourlyRate) || hourlyRate <= 0)) {
      setProfileError("Enter a positive hourly rate.");
      return;
    }
    setProfileBusy(true);
    try {
      await apiPost(`/payroll/profiles/${profileOrgUserId}`, {
        payType: profilePayType,
        baseSalary: profilePayType === "SALARY" ? baseSalary : undefined,
        hourlyRate: profilePayType === "HOURLY" ? hourlyRate : undefined,
      });
      setProfileOrgUserId("");
      setProfileBaseSalary("");
      setProfileHourlyRate("");
      await load();
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : "Could not save this pay profile.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function createRun() {
    setRunError(null);
    if (!periodStart || !periodEnd) {
      setRunError("Pick both a period start and end.");
      return;
    }
    setRunBusy(true);
    try {
      await apiPost("/payroll/runs", {
        periodStart: new Date(periodStart).toISOString(),
        periodEnd: new Date(periodEnd).toISOString(),
      });
      setPeriodStart("");
      setPeriodEnd("");
      await load();
    } catch (err) {
      setRunError(err instanceof ApiError ? err.message : "Could not create the payroll run.");
    } finally {
      setRunBusy(false);
    }
  }

  async function generate(id: string) {
    try {
      await apiPost(`/payroll/runs/${id}/generate`, {});
      setExpandedRunId(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not generate payslips.");
    }
  }

  async function approve(id: string) {
    try {
      await apiPatch(`/payroll/runs/${id}/approve`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not approve this run.");
    }
  }

  async function markPaid(id: string) {
    try {
      await apiPatch(`/payroll/runs/${id}/mark-paid`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark this run paid.");
    }
  }

  if (!session) return null;

  const profiledIds = new Set(profiles.map((p) => p.orgUser.id));
  const unprofiledStaff = orgUsers.filter((u) => u.isActive && !profiledIds.has(u.id));

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-bold">Payroll</h1>
        <p className="mb-4 text-sm text-slate-400">
          Set a pay rate per staff member (opt-in - only staff with a pay profile are included in a run), then run
          payroll for a period. PAYE, NSSF, SHIF, and the Housing Levy are calculated automatically using current
          Kenyan statutory rates.
        </p>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        <div className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Set a pay profile</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">Staff member</label>
              <select
                value={profileOrgUserId}
                onChange={(e) => setProfileOrgUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                <option value="">Select...</option>
                {orgUsers
                  .filter((u) => u.isActive)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.user.fullName} ({u.role})
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400">Pay type</label>
              <select
                value={profilePayType}
                onChange={(e) => setProfilePayType(e.target.value as PayType)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                <option value="SALARY">Salary (fixed monthly)</option>
                <option value="HOURLY">Hourly (from clocked sessions)</option>
              </select>
            </div>
            {profilePayType === "SALARY" ? (
              <div>
                <label className="block text-xs text-slate-400">Monthly base salary</label>
                <input
                  type="number"
                  value={profileBaseSalary}
                  onChange={(e) => setProfileBaseSalary(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-400">Hourly rate</label>
                <input
                  type="number"
                  value={profileHourlyRate}
                  onChange={(e) => setProfileHourlyRate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
            )}
          </div>

          {profileError && <p className="mt-2 text-sm text-red-400">{profileError}</p>}

          <button
            onClick={() => void saveProfile()}
            disabled={profileBusy || !profileOrgUserId}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {profileBusy ? "Saving..." : "Save pay profile"}
          </button>

          {profiles.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-sm">
              {profiles.map((p) => (
                <p key={p.id} className={p.active ? "" : "text-slate-500 line-through"}>
                  {p.orgUser.user.fullName} - {p.payType === "SALARY" ? `KES ${money(Number(p.baseSalary))}/mo` : `KES ${money(Number(p.hourlyRate))}/hr`}
                </p>
              ))}
            </div>
          )}
          {unprofiledStaff.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              No pay profile yet: {unprofiledStaff.map((u) => u.user.fullName).join(", ")}
            </p>
          )}
        </div>

        <div className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Run payroll for a period</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">Period start</label>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400">Period end</label>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
          </div>
          {runError && <p className="mt-2 text-sm text-red-400">{runError}</p>}
          <button
            onClick={() => void createRun()}
            disabled={runBusy || !periodStart || !periodEnd}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {runBusy ? "Creating..." : "Create payroll run"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Payroll runs</h2>
          {runs.length === 0 ? (
            <p className="text-sm text-slate-500">No payroll runs yet.</p>
          ) : (
            <div className="space-y-2">
              {runs.map((r) => {
                const totalNet = r.payslips.reduce((sum, p) => sum + Number(p.netPay), 0);
                return (
                  <div key={r.id} className="rounded-md bg-slate-900 p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => setExpandedRunId((id) => (id === r.id ? null : r.id))}
                        className="text-left hover:underline"
                      >
                        {new Date(r.periodStart).toLocaleDateString()} - {new Date(r.periodEnd).toLocaleDateString()}
                        {r.payslips.length > 0 ? ` · ${r.payslips.length} payslip(s) · net KES ${money(totalNet)}` : ""}
                      </button>
                      <span className={`text-xs uppercase tracking-wide ${STATUS_COLOR[r.status]}`}>{r.status}</span>
                    </div>

                    {r.status === "DRAFT" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => void generate(r.id)}
                          className="rounded-md bg-slate-700 px-3 py-1 text-xs hover:bg-slate-600"
                        >
                          {r.payslips.length > 0 ? "Regenerate payslips" : "Generate payslips"}
                        </button>
                        {r.payslips.length > 0 && (
                          <button
                            onClick={() => void approve(r.id)}
                            className="rounded-md bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    )}
                    {r.status === "APPROVED" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => void markPaid(r.id)}
                          className="rounded-md bg-emerald-700 px-3 py-1 text-xs hover:bg-emerald-600"
                        >
                          Mark paid
                        </button>
                      </div>
                    )}

                    {expandedRunId === r.id && r.payslips.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                        {r.payslips.map((p) => (
                          <div key={p.id} className="rounded bg-slate-950 p-2 text-xs">
                            <p className="font-medium text-slate-200">
                              {p.orgUser.user.fullName}
                              {p.hoursWorked !== null ? ` · ${Number(p.hoursWorked).toFixed(1)} hrs` : ""}
                            </p>
                            <p className="text-slate-400">
                              Gross KES {money(Number(p.grossPay))} · PAYE {money(Number(p.payeTax))} · NSSF{" "}
                              {money(Number(p.nssfDeduction))} · SHIF {money(Number(p.shifDeduction))} · Housing Levy{" "}
                              {money(Number(p.housingLevy))} · Net{" "}
                              <span className="font-semibold text-slate-200">KES {money(Number(p.netPay))}</span>
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
