"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
}

export default function SuppliersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
      setSuppliers(await apiGet<Supplier[]>("/suppliers"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load suppliers.");
    } finally {
      setLoading(false);
    }
  }

  function openNew() {
    setEditingId(null);
    setName("");
    setPhone("");
    setEmail("");
    setNotes("");
    setSaveError(null);
    setFormOpen(true);
  }

  function openEdit(s: Supplier) {
    setEditingId(s.id);
    setName(s.name);
    setPhone(s.phone ?? "");
    setEmail(s.email ?? "");
    setNotes(s.notes ?? "");
    setSaveError(null);
    setFormOpen(true);
  }

  async function save() {
    if (!name.trim()) return;
    setSaveBusy(true);
    setSaveError(null);
    const body = {
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      notes: notes.trim() || undefined,
    };
    try {
      if (editingId) {
        await apiPatch(`/suppliers/${editingId}`, body);
      } else {
        await apiPost("/suppliers", body);
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save supplier.");
    } finally {
      setSaveBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Suppliers</h1>
          <button onClick={openNew} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold hover:bg-blue-500">
            + New supplier
          </button>
        </div>

        {formOpen && (
          <div className="mb-6 rounded-lg border border-slate-800 p-4">
            <h2 className="mb-3 font-semibold">{editingId ? "Edit supplier" : "New supplier"}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="block text-xs text-slate-400">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Email</label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs text-slate-400">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                />
              </div>
            </div>
            {saveError && <p className="mt-2 text-sm text-red-400">{saveError}</p>}
            <div className="mt-3 flex gap-3">
              <button onClick={() => setFormOpen(false)} className="rounded-md bg-slate-700 px-4 py-2 text-sm">
                Cancel
              </button>
              <button
                onClick={() => void save()}
                disabled={saveBusy || !name.trim()}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
              >
                {saveBusy ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}
        {!loading && suppliers.length === 0 && !error && <p className="text-slate-400">No suppliers yet.</p>}

        {suppliers.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800 text-slate-400">
                <tr>
                  <th className="p-3">Name</th>
                  <th className="p-3">Phone</th>
                  <th className="p-3">Email</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-slate-800 hover:bg-slate-800/50">
                    <td className="p-3">{s.name}</td>
                    <td className="p-3">{s.phone ?? "-"}</td>
                    <td className="p-3">{s.email ?? "-"}</td>
                    <td className="p-3 text-right">
                      <button onClick={() => openEdit(s)} className="text-blue-400 hover:underline">
                        Edit
                      </button>
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
