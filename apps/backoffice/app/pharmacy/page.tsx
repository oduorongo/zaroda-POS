"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";

interface PharmacyFlag {
  isControlledSubstance: boolean;
  schedule: string | null;
}

interface Product {
  id: string;
  name: string;
  pharmacyFlag: PharmacyFlag | null;
}

/**
 * Controlled-substance flag management for the pharmacy vertical - the
 * terminal PWA's prescription capture and batch/expiry picker (app/pos)
 * are the working screens; this is where a manager decides which
 * products need a prescription in the first place, via the new
 * GET /pharmacy/products (added alongside this page - nothing before
 * listed more than one product's flag per request).
 *
 * Deliberately does not attempt a prescription-history view in this
 * slice - no endpoint exists to list PharmacySalePrescription rows
 * (only per-sale creation), a real gap left for a follow-up rather than
 * worked around with an ad-hoc query here.
 */
export default function PharmacyPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (s.industryType !== "PHARMACY") {
      router.replace("/sales");
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
      setProducts(await apiGet<Product[]>("/pharmacy/products"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load products.");
    } finally {
      setLoading(false);
    }
  }

  async function toggleControlled(product: Product) {
    setBusyId(product.id);
    try {
      await apiPatch(`/pharmacy/products/${product.id}/controlled-substance`, {
        isControlledSubstance: !(product.pharmacyFlag?.isControlledSubstance ?? false),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update this product.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return null;

  const filtered = products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase()));
  const controlledCount = products.filter((p) => p.pharmacyFlag?.isControlledSubstance).length;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-1 text-xl font-bold">Pharmacy</h1>
        <p className="mb-4 text-sm text-slate-400">
          {controlledCount} of {products.length} products flagged as controlled substances (require a prescription at
          checkout).
        </p>

        <input
          placeholder="Search products..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 w-full max-w-md rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
        />

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {loading && <p className="text-slate-400">Loading...</p>}

        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-slate-400">
              <tr>
                <th className="p-3">Product</th>
                <th className="p-3">Controlled substance</th>
                <th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const isControlled = p.pharmacyFlag?.isControlledSubstance ?? false;
                return (
                  <tr key={p.id} className="border-t border-slate-800">
                    <td className="p-3">{p.name}</td>
                    <td className="p-3">
                      {isControlled ? (
                        <span className="text-amber-400">
                          Yes{p.pharmacyFlag?.schedule ? ` (Schedule ${p.pharmacyFlag.schedule})` : ""}
                        </span>
                      ) : (
                        <span className="text-slate-500">No</span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => void toggleControlled(p)}
                        disabled={busyId === p.id}
                        className="rounded-md bg-slate-700 px-3 py-1.5 text-xs hover:bg-slate-600 disabled:opacity-40"
                      >
                        {busyId === p.id ? "..." : isControlled ? "Unflag" : "Flag as controlled"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="p-3 text-center text-slate-500">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
