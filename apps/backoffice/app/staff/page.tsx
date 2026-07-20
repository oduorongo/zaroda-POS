"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

type Role = "CASHIER" | "SUPERVISOR" | "MANAGER" | "OWNER" | "AUDITOR";

interface OrgUser {
  id: string;
  role: Role;
  branchId: string | null;
  isActive: boolean;
  user: { fullName: string; email?: string };
}

const ROLES: Role[] = ["CASHIER", "SUPERVISOR", "MANAGER", "OWNER", "AUDITOR"];

/**
 * The first UI for org-users.controller.ts's write endpoints (added
 * alongside this screen - previously only a read-only GET existed
 * anywhere in the API, so there was no way to build this before now).
 */
export default function StaffPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

  const [newOpen, setNewOpen] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newFullName, setNewFullName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<Role>("CASHIER");
  const [newBranchId, setNewBranchId] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("CASHIER");
  const [editBranchId, setEditBranchId] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [pinForId, setPinForId] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinSuccessId, setPinSuccessId] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (!session) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, includeInactive]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setOrgUsers(await apiGet<OrgUser[]>(`/org-users${includeInactive ? "?includeInactive=true" : ""}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load staff.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleActive(u: OrgUser) {
    setStatusBusyId(u.id);
    setError(null);
    try {
      await apiPatch(`/org-users/${u.id}/${u.isActive ? "deactivate" : "reactivate"}`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update status.");
    } finally {
      setStatusBusyId(null);
    }
  }

  async function createStaff() {
    if (!newEmail.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      await apiPost("/org-users", {
        email: newEmail.trim(),
        fullName: newFullName.trim() || undefined,
        password: newPassword || undefined,
        role: newRole,
        branchId: newBranchId.trim() || undefined,
      });
      setNewOpen(false);
      setNewEmail("");
      setNewFullName("");
      setNewPassword("");
      setNewRole("CASHIER");
      setNewBranchId("");
      await load();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not add this person.");
    } finally {
      setCreateBusy(false);
    }
  }

  function startEdit(u: OrgUser) {
    setEditingId(u.id);
    setEditRole(u.role);
    setEditBranchId(u.branchId ?? "");
    setEditError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setEditBusy(true);
    setEditError(null);
    try {
      await apiPatch(`/org-users/${editingId}`, {
        role: editRole,
        branchId: editBranchId.trim() ? editBranchId.trim() : null,
      });
      setEditingId(null);
      await load();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Could not update this person.");
    } finally {
      setEditBusy(false);
    }
  }

  async function savePin() {
    if (!pinForId || pinValue.length < 4) return;
    setPinBusy(true);
    setPinError(null);
    try {
      await apiPatch(`/org-users/${pinForId}/pin`, { pin: pinValue });
      setPinSuccessId(pinForId);
      setTimeout(() => setPinSuccessId(null), 3000);
      setPinForId(null);
      setPinValue("");
    } catch (err) {
      setPinError(err instanceof ApiError ? err.message : "Could not set PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Staff</h1>
          <button onClick={() => setNewOpen((v) => !v)} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
            + Add person
          </button>
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
          Show deactivated
        </label>

        {newOpen && (
          <div className="mb-6 rounded-lg border border-slate-800 p-4">
            <h2 className="mb-3 font-semibold">Add person</h2>
            <p className="mb-3 text-xs text-slate-400">
              If this email already has an account (e.g. someone contracted to more than one shop), fullName/password
              are ignored and they just get a new membership here.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                placeholder="Email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
              <input
                placeholder="Full name (new account only)"
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
              <input
                type="password"
                placeholder="Password, min 8 chars (new account only)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as Role)}
                className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <input
                placeholder="Branch ID (optional - blank = all branches)"
                value={newBranchId}
                onChange={(e) => setNewBranchId(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm sm:col-span-2"
              />
            </div>
            {createError && <p className="mt-2 text-sm text-red-400">{createError}</p>}
            <button
              onClick={() => void createStaff()}
              disabled={createBusy || !newEmail.trim()}
              className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
            >
              {createBusy ? "Adding..." : "Add"}
            </button>
          </div>
        )}

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        {!loading && orgUsers.length > 0 && (
          <div className="space-y-2">
            {orgUsers.map((u) => (
              <div key={u.id} className={`rounded-lg border p-3 ${u.isActive ? "border-slate-800" : "border-red-900 opacity-70"}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">
                      {u.user.fullName} {!u.isActive && <span className="text-xs font-normal text-red-400">(deactivated)</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {u.role} · {u.branchId ? `Branch ${u.branchId.slice(0, 8)}...` : "All branches"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(u)} className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700">
                      Edit role
                    </button>
                    <button
                      onClick={() => {
                        setPinForId(u.id);
                        setPinValue("");
                        setPinError(null);
                      }}
                      className="rounded-md bg-slate-800 px-3 py-1.5 text-sm hover:bg-slate-700"
                    >
                      Set PIN
                    </button>
                    <button
                      onClick={() => void toggleActive(u)}
                      disabled={statusBusyId === u.id}
                      className={`rounded-md px-3 py-1.5 text-sm disabled:opacity-40 ${u.isActive ? "bg-red-900 hover:bg-red-800" : "bg-green-800 hover:bg-green-700"}`}
                    >
                      {statusBusyId === u.id ? "..." : u.isActive ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                </div>
                {pinSuccessId === u.id && <p className="mt-2 text-sm text-green-400">PIN updated.</p>}

                {editingId === u.id && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
                    <select
                      value={editRole}
                      onChange={(e) => setEditRole(e.target.value as Role)}
                      className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Branch ID (blank = all)"
                      value={editBranchId}
                      onChange={(e) => setEditBranchId(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                    />
                    <button
                      onClick={() => void saveEdit()}
                      disabled={editBusy}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded-md bg-slate-700 px-3 py-2 text-sm">
                      Cancel
                    </button>
                    {editError && <p className="w-full text-sm text-red-400">{editError}</p>}
                  </div>
                )}

                {pinForId === u.id && (
                  <div className="mt-3 flex items-center gap-2 border-t border-slate-800 pt-3">
                    <input
                      type="password"
                      placeholder="New PIN (4-8 digits)"
                      value={pinValue}
                      onChange={(e) => setPinValue(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                    />
                    <button
                      onClick={() => void savePin()}
                      disabled={pinBusy || pinValue.length < 4}
                      className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                    >
                      Set
                    </button>
                    <button onClick={() => setPinForId(null)} className="rounded-md bg-slate-700 px-3 py-2 text-sm">
                      Cancel
                    </button>
                    {pinError && <p className="w-full text-sm text-red-400">{pinError}</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
