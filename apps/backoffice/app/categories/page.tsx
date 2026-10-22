"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Category {
  id: string;
  name: string;
  productCount: number;
}

const field = "rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50";

/** Groups for your products (Bakery, Drinks...). They help you find things and show up in reports and on your online shop. */
export default function CategoriesPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setCategories(await apiGet<Category[]>("/categories?withCounts=true"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your categories.");
    }
  }, []);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    setSession(s);
    void load();
  }, [router, load]);

  const canEdit = session?.role === "OWNER" || session?.role === "MANAGER";

  async function run(task: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await task();
      setNotice(done);
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not work.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => apiPost("/categories", { name: name.trim() }), `"${name.trim()}" added.`)) setName("");
  }

  async function rename(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    if (await run(() => apiPatch(`/categories/${editing.id}`, { name: editing.name.trim() }), "Renamed.")) setEditing(null);
  }

  async function remove(c: Category) {
    const message =
      c.productCount > 0
        ? `Delete "${c.name}"? Its ${c.productCount} product${c.productCount === 1 ? "" : "s"} will not be deleted - ${c.productCount === 1 ? "it" : "they"} will just have no category.`
        : `Delete "${c.name}"?`;
    if (!window.confirm(message)) return;
    await run(() => apiDelete(`/categories/${c.id}`), `"${c.name}" deleted${c.productCount > 0 ? `; its ${c.productCount} product${c.productCount === 1 ? " now has" : "s now have"} no category` : ""}.`);
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Categories</h1>
          <Link href="/products" className="text-sm text-primary-600 hover:underline">Products &rarr;</Link>
        </div>
        <p className="text-sm text-secondary-500">Put your products in groups such as Bakery or Drinks. A category is only for finding and reporting - it does not change prices or stock.</p>

        {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

        {canEdit && (
          <form onSubmit={add} className="flex gap-2 rounded-lg border border-border bg-surface p-3">
            <input required maxLength={200} placeholder="New category, e.g. Bakery" value={name} onChange={(e) => setName(e.target.value)} className={`${field} min-w-0 flex-1`} />
            <button className={button} disabled={busy || !name.trim()}>Add</button>
          </form>
        )}

        {categories === null && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {categories && categories.length === 0 && <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No categories yet. Add your first one above.</p>}
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
          {categories?.map((c) =>
            editing?.id === c.id ? (
              <li key={c.id} className="p-3">
                <form onSubmit={rename} className="flex gap-2">
                  <input required maxLength={200} value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={`${field} min-w-0 flex-1`} autoFocus />
                  <button className={button} disabled={busy || !editing.name.trim()}>Save</button>
                  <button type="button" className="text-sm text-secondary-500 hover:underline" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              </li>
            ) : (
              <li key={c.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span>
                  <strong>{c.name}</strong>
                  <span className="ml-2 text-xs text-secondary-500">{c.productCount} product{c.productCount === 1 ? "" : "s"}</span>
                </span>
                {canEdit && (
                  <span className="flex gap-4 text-xs">
                    <button className="text-primary-600 hover:underline" onClick={() => setEditing({ id: c.id, name: c.name })}>Rename</button>
                    <button className="text-error-600 hover:underline" onClick={() => void remove(c)}>Delete</button>
                  </span>
                )}
              </li>
            ),
          )}
        </ul>
      </main>
    </div>
  );
}
