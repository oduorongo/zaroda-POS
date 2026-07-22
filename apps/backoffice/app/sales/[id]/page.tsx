"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";

interface SaleLineItem {
  id: string;
  variantId: string;
  quantity: number;
  unitPrice: string;
  taxAmount: string;
}

interface SalePayment {
  id: string;
  method: string;
  amount: string;
}

interface SaleDiscount {
  id: string;
  type: string;
  value: string;
  approvedById: string;
}

interface Refund {
  id: string;
  amount: string;
  reason: string;
  approvedById: string;
  createdAt: string;
}

interface Sale {
  id: string;
  status: string;
  total: string;
  createdAt: string;
  lineItems: SaleLineItem[];
  payments: SalePayment[];
  discounts: SaleDiscount[];
  refunds: Refund[];
}

interface OrgUser {
  id: string;
  role: string;
  user: { fullName: string };
}

const APPROVER_ROLES = ["SUPERVISOR", "MANAGER", "OWNER"];

export default function SaleDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [orgUsers, setOrgUsers] = useState<OrgUser[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundApproverId, setRefundApproverId] = useState("");
  const [refundBusy, setRefundBusy] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const approvers = useMemo(() => orgUsers.filter((u) => APPROVER_ROLES.includes(u.role)), [orgUsers]);

  async function load() {
    try {
      const [saleResult, orgUsersResult] = await Promise.all([
        apiGet<Sale>(`/sales/${params.id}`),
        apiGet<OrgUser[]>("/org-users"),
      ]);
      setSale(saleResult);
      setOrgUsers(orgUsersResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load sale.");
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

  const refundedTotal = useMemo(
    () => (sale ? sale.refunds.reduce((sum, r) => sum + Number(r.amount), 0) : 0),
    [sale],
  );
  const remainingRefundable = sale ? Math.max(0, Number(sale.total) - refundedTotal) : 0;

  async function submitRefund() {
    if (!sale) return;
    const amount = Number(refundAmount);
    if (!Number.isFinite(amount) || amount <= 0 || !refundReason.trim() || !refundApproverId) return;

    setRefundBusy(true);
    setRefundError(null);
    try {
      await apiPost(`/sales/${sale.id}/refunds`, {
        clientId: crypto.randomUUID(),
        amount,
        reason: refundReason.trim(),
        approvedById: refundApproverId,
      });
      setRefundAmount("");
      setRefundReason("");
      setRefundApproverId("");
      await load();
    } catch (err) {
      setRefundError(err instanceof ApiError ? err.message : "Refund failed.");
    } finally {
      setRefundBusy(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <button onClick={() => router.push("/sales")} className="mb-4 text-blue-400 hover:underline">
          &larr; Sales
        </button>
        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
        {!sale && !error && <p className="text-slate-400">Loading...</p>}
        {sale && (
          <>
            <h1 className="text-xl font-bold">Sale {sale.id}</h1>
            <p className="mt-1 text-sm text-slate-400">
              {new Date(sale.createdAt).toLocaleString()} · {sale.status}
            </p>

            <section className="mt-6 rounded-lg border border-slate-800">
              <h2 className="border-b border-slate-800 bg-slate-800 p-3 font-semibold">Line items</h2>
              <table className="w-full text-left text-sm">
                <tbody>
                  {sale.lineItems.map((li) => (
                    <tr key={li.id} className="border-b border-slate-800 last:border-b-0">
                      <td className="p-3">{li.variantId}</td>
                      <td className="p-3 text-right">{li.quantity}</td>
                      <td className="p-3 text-right font-mono">{Number(li.unitPrice).toFixed(2)}</td>
                      <td className="p-3 text-right font-mono text-slate-400">+{Number(li.taxAmount).toFixed(2)} tax</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="mt-4 rounded-lg border border-slate-800 p-3">
              <h2 className="font-semibold">Payments</h2>
              {sale.payments.map((p) => (
                <p key={p.id} className="mt-1 text-sm">
                  {p.method}: KES {Number(p.amount).toFixed(2)}
                </p>
              ))}
            </section>

            {sale.discounts.length > 0 && (
              <section className="mt-4 rounded-lg border border-slate-800 p-3">
                <h2 className="font-semibold">Discounts</h2>
                {sale.discounts.map((d) => (
                  <p key={d.id} className="mt-1 text-sm">
                    {d.type === "PERCENT" ? `${d.value}%` : `KES ${Number(d.value).toFixed(2)}`} - approved by{" "}
                    {orgUsers.find((u) => u.id === d.approvedById)?.user.fullName ?? d.approvedById}
                  </p>
                ))}
              </section>
            )}

            <section className="mt-4 rounded-lg border border-slate-800 p-3">
              <h2 className="font-semibold">Refunds</h2>
              {sale.refunds.length === 0 && <p className="mt-1 text-sm text-slate-400">None yet.</p>}
              {sale.refunds.map((r) => (
                <p key={r.id} className="mt-1 text-sm">
                  KES {Number(r.amount).toFixed(2)} - {r.reason} ({new Date(r.createdAt).toLocaleString()})
                </p>
              ))}

              {remainingRefundable > 0 ? (
                <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
                  <p className="text-xs text-slate-400">Remaining refundable: KES {remainingRefundable.toFixed(2)}</p>
                  <input
                    type="number"
                    max={remainingRefundable}
                    placeholder="Amount"
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <input
                    placeholder="Reason"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  />
                  <select
                    value={refundApproverId}
                    onChange={(e) => setRefundApproverId(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-900 p-2 text-sm"
                  >
                    <option value="">Approved by...</option>
                    {approvers.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.user.fullName} ({a.role})
                      </option>
                    ))}
                  </select>
                  {refundError && <p className="text-sm text-red-400">{refundError}</p>}
                  <button
                    onClick={() => void submitRefund()}
                    disabled={
                      refundBusy ||
                      !Number.isFinite(Number(refundAmount)) ||
                      Number(refundAmount) <= 0 ||
                      !refundReason.trim() ||
                      !refundApproverId
                    }
                    className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-40"
                  >
                    {refundBusy ? "Refunding..." : "Issue refund"}
                  </button>
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">Fully refunded.</p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
