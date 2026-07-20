"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

type LayawayStatus = "OPEN" | "COMPLETED" | "CANCELLED";

interface LineItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPrice: string;
  taxAmount: string;
  variant: { sku: string; product: { name: string } };
}

interface Payment {
  id: string;
  amount: string;
  method: string;
  createdAt: string;
}

interface Layaway {
  id: string;
  total: string;
  depositPaid: string;
  status: LayawayStatus;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  customer: { id: string; name: string; phone: string | null };
  lineItems: LineItem[];
  payments: Payment[];
}

export default function LayawayDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [layaway, setLayaway] = useState<Layaway | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paymentAmount, setPaymentAmount] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);

  async function load() {
    try {
      setLayaway(await apiGet<Layaway>(`/layaways/${params.id}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this layaway.");
    }
  }

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.id]);

  const balance = useMemo(() => (layaway ? Math.max(0, Number(layaway.total) - Number(layaway.depositPaid)) : 0), [layaway]);

  async function recordPayment() {
    if (!layaway) return;
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPost(`/layaways/${layaway.id}/payments`, { method: "CASH", amount });
      setPaymentAmount("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not record payment.");
    } finally {
      setActionBusy(false);
    }
  }

  async function complete() {
    if (!layaway) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/layaways/${layaway.id}/complete`, {});
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not complete this layaway.");
    } finally {
      setActionBusy(false);
    }
  }

  async function cancel() {
    if (!layaway || !cancelReason.trim()) return;
    setActionBusy(true);
    setActionError(null);
    try {
      await apiPatch(`/layaways/${layaway.id}/cancel`, { reason: cancelReason.trim() });
      setCancelOpen(false);
      setCancelReason("");
      await load();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not cancel this layaway.");
    } finally {
      setActionBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-2xl p-6">
        <button onClick={() => router.push("/layaways")} className="mb-4 text-blue-400 hover:underline">
          &larr; Layaways
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!layaway && !error && <p className="text-slate-400">Loading...</p>}
        {layaway && (
          <>
            <h1 className="text-xl font-bold">{layaway.customer.name}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {new Date(layaway.createdAt).toLocaleString()} · {layaway.status}
              {layaway.customer.phone && ` · ${layaway.customer.phone}`}
            </p>

            <section className="mt-6 rounded-lg border border-slate-800">
              <h2 className="border-b border-slate-800 bg-slate-800 p-3 font-semibold">Items</h2>
              <table className="w-full text-left text-sm">
                <tbody>
                  {layaway.lineItems.map((li) => (
                    <tr key={li.id} className="border-b border-slate-800 last:border-b-0">
                      <td className="p-3">
                        {li.variant.product.name} ({li.variant.sku})
                      </td>
                      <td className="p-3 text-right">{li.quantity}</td>
                      <td className="p-3 text-right font-mono">KES {Number(li.unitPrice).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Total" value={`KES ${Number(layaway.total).toFixed(2)}`} />
              <Stat label="Paid" value={`KES ${Number(layaway.depositPaid).toFixed(2)}`} />
              <Stat label="Balance" value={`KES ${balance.toFixed(2)}`} />
            </div>

            <section className="mt-4 rounded-lg border border-slate-800 p-3">
              <h2 className="font-semibold">Payments</h2>
              {layaway.payments.length === 0 && <p className="mt-1 text-sm text-slate-400">None yet.</p>}
              {layaway.payments.map((p) => (
                <p key={p.id} className="mt-1 text-sm">
                  KES {Number(p.amount).toFixed(2)} ({p.method}) - {new Date(p.createdAt).toLocaleString()}
                </p>
              ))}
            </section>

            {actionError && <p className="mt-4 text-sm text-red-400">{actionError}</p>}

            {layaway.status === "OPEN" && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    max={balance}
                    placeholder={`Amount (max ${balance.toFixed(2)})`}
                    value={paymentAmount}
                    onChange={(e) => setPaymentAmount(e.target.value)}
                    className="rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
                  />
                  <button
                    onClick={() => void recordPayment()}
                    disabled={actionBusy || !Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0}
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                  >
                    Record payment
                  </button>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => void complete()}
                    disabled={actionBusy || balance > 0}
                    className="rounded-md bg-green-700 px-4 py-2 text-sm font-semibold hover:bg-green-600 disabled:opacity-40"
                  >
                    Complete (pickup)
                  </button>
                  <button onClick={() => setCancelOpen((v) => !v)} className="rounded-md bg-red-900 px-4 py-2 text-sm hover:bg-red-800">
                    Cancel layaway
                  </button>
                </div>

                {cancelOpen && (
                  <div className="flex items-center gap-2">
                    <input
                      placeholder="Reason"
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      className="flex-1 rounded-md border border-slate-700 bg-slate-800 p-2 text-sm"
                    />
                    <button
                      onClick={() => void cancel()}
                      disabled={actionBusy || !cancelReason.trim()}
                      className="rounded-md bg-red-700 px-4 py-2 text-sm font-semibold hover:bg-red-600 disabled:opacity-40"
                    >
                      Confirm cancel
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-800 p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-mono">{value}</p>
    </div>
  );
}
