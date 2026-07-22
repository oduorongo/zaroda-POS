"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Branch {
  id: string;
  name: string;
}

interface OrgUser {
  id: string;
  role: string;
  isActive: boolean;
  user: { fullName: string };
}

interface RosterShift {
  id: string;
  startTime: string;
  endTime: string;
  published: boolean;
  notes: string | null;
  orgUser: { id: string; user: { fullName: string } };
  branch: { name: string };
}

function startOfWeek(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday-start week
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function RosterPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [formOrgUserId, setFormOrgUserId] = useState("");
  const [formStart, setFormStart] = useState("");
  const [formEnd, setFormEnd] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [formBusy, setFormBusy] = useState(false);
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
        const [branchList, orgUserList] = await Promise.all([
          apiGet<Branch[]>("/branches"),
          apiGet<OrgUser[]>("/org-users"),
        ]);
        setBranches(branchList);
        setBranchId((prev) => prev || branchList[0]?.id || "");
        setOrgUsers(orgUserList);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Could not load branches or staff.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart);
    end.setDate(end.getDate() + 7);
    return end;
  }, [weekStart]);

  useEffect(() => {
    if (!branchId.trim()) return;
    void loadShifts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, weekStart]);

  async function loadShifts() {
    setLoading(true);
    try {
      setShifts(
        await apiGet<RosterShift[]>(
          `/roster?branchId=${branchId}&from=${weekStart.toISOString()}&to=${weekEnd.toISOString()}`,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the roster.");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    setFormError(null);
    if (!branchId.trim() || !formOrgUserId || !formStart || !formEnd) {
      setFormError("Pick a staff member and both a start and end time.");
      return;
    }
    setFormBusy(true);
    try {
      await apiPost("/roster", {
        branchId,
        orgUserId: formOrgUserId,
        startTime: new Date(formStart).toISOString(),
        endTime: new Date(formEnd).toISOString(),
        notes: formNotes.trim() || undefined,
      });
      setFormOrgUserId("");
      setFormStart("");
      setFormEnd("");
      setFormNotes("");
      await loadShifts();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not create this shift.");
    } finally {
      setFormBusy(false);
    }
  }

  async function togglePublish(s: RosterShift) {
    try {
      await apiPatch(`/roster/${s.id}/${s.published ? "unpublish" : "publish"}`, {});
      await loadShifts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this shift.");
    }
  }

  async function remove(id: string) {
    try {
      await apiDelete(`/roster/${id}`);
      await loadShifts();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete this shift.");
    }
  }

  function publishWeek() {
    void (async () => {
      const drafts = shifts.filter((s) => !s.published);
      for (const s of drafts) {
        try {
          await apiPatch(`/roster/${s.id}/publish`, {});
        } catch {
          // best-effort - continue publishing the rest, loadShifts() below shows what actually landed
        }
      }
      await loadShifts();
    })();
  }

  if (!session) return null;

  const days: Date[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return d;
  });

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="mb-1 text-xl font-bold">Duty Roster</h1>
        <p className="mb-4 text-sm text-slate-400">
          Plan staff shifts ahead of time. Draft shifts are only visible here until published - publish a shift once
          the week&apos;s schedule is final.
        </p>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <div className="mb-4 flex flex-wrap items-center gap-3">
          <select
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
          >
            {branches.length === 0 && <option value="">No branches found</option>}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          >
            &larr; Prev week
          </button>
          <span className="text-sm text-slate-400">
            {weekStart.toLocaleDateString()} - {new Date(weekEnd.getTime() - 1).toLocaleDateString()}
          </span>
          <button
            onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}
            className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700"
          >
            Next week &rarr;
          </button>
          {shifts.some((s) => !s.published) && (
            <button onClick={publishWeek} className="ml-auto rounded-md bg-emerald-700 px-3 py-2 text-sm hover:bg-emerald-600">
              Publish all draft shifts this week
            </button>
          )}
        </div>

        <div className="mb-6 rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">Add a shift</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-xs text-slate-400">Staff member</label>
              <select
                value={formOrgUserId}
                onChange={(e) => setFormOrgUserId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                <option value="">Select...</option>
                {orgUsers.filter((u) => u.isActive).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.user.fullName} ({u.role})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-400">Start</label>
                <input
                  type="datetime-local"
                  value={formStart}
                  onChange={(e) => setFormStart(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">End</label>
                <input
                  type="datetime-local"
                  value={formEnd}
                  onChange={(e) => setFormEnd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs text-slate-400">Notes (optional)</label>
              <input
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
            </div>
          </div>

          {formError && <p className="mt-2 text-sm text-red-400">{formError}</p>}

          <button
            onClick={() => void submit()}
            disabled={formBusy || !branchId.trim() || !formOrgUserId || !formStart || !formEnd}
            className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            {formBusy ? "Saving..." : "Add shift"}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-3 font-semibold">This week</h2>
          {loading ? (
            <p className="text-sm text-slate-400">Loading...</p>
          ) : shifts.length === 0 ? (
            <p className="text-sm text-slate-500">No shifts rostered this week.</p>
          ) : (
            <div className="space-y-4">
              {days.map((day) => {
                const dayShifts = shifts.filter((s) => {
                  const t = new Date(s.startTime);
                  return t.toDateString() === day.toDateString();
                });
                if (dayShifts.length === 0) return null;
                return (
                  <div key={day.toISOString()}>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {day.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
                    </p>
                    <div className="space-y-1">
                      {dayShifts.map((s) => (
                        <div key={s.id} className="flex items-center justify-between rounded-md bg-slate-900 p-2 text-sm">
                          <div>
                            <p>
                              {s.orgUser.user.fullName} ·{" "}
                              {new Date(s.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}-
                              {new Date(s.endTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </p>
                            {s.notes && <p className="text-xs text-slate-500">{s.notes}</p>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-xs uppercase tracking-wide ${s.published ? "text-green-400" : "text-slate-500"}`}>
                              {s.published ? "Published" : "Draft"}
                            </span>
                            <button
                              onClick={() => void togglePublish(s)}
                              className="rounded-md bg-slate-700 px-2 py-1 text-xs hover:bg-slate-600"
                            >
                              {s.published ? "Unpublish" : "Publish"}
                            </button>
                            <button
                              onClick={() => void remove(s.id)}
                              className="rounded-md bg-red-900 px-2 py-1 text-xs hover:bg-red-800"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
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
