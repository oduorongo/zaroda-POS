"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { db, getActiveSession, getDeviceConfig, type CachedOrgUser, type CashierSession, type DeviceConfig } from "../../lib/db";
import { apiGet, apiPost, ApiError, OfflineError } from "../../lib/api";
import { Button } from "@zaroda/ui";

interface SaleLineItem {
  id: string;
  variantId: string;
  quantity: string;
  unitPrice: string;
}

interface SalePayment {
  method: string;
  amount: string;
}

interface Refund {
  id: string;
  amount: string;
  reason: string;
  createdAt: string;
}

interface Sale {
  id: string;
  clientId: string;
  status: string;
  total: string;
  createdAt: string;
  lineItems: SaleLineItem[];
  payments: SalePayment[];
  refunds: Refund[];
}

const APPROVER_ROLES = ["SUPERVISOR", "MANAGER", "OWNER"];

/**
 * Returns/refund flow - looks a sale up by the client reference printed on
 * its receipt (see pos/page.tsx's ReceiptData.clientId), then files a
 * monetary refund against it via POST /sales/:id/refunds. This is a
 * monetary refund only (SalesService.refund's own doc comment: "not a
 * goods return... a refund that also needs to return goods should void the
 * sale instead") - it does not put stock back, matching the backend's
 * actual behavior rather than implying it does.
 */
export default function ReturnsPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [orgUsers, setOrgUsers] = useState<CachedOrgUser[]>([]);

  const [reference, setReference] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [variantNames, setVariantNames] = useState<Map<string, string>>(new Map());

  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [approverId, setApproverId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Refund | null>(null);

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) {
        router.replace("/setup");
        return;
      }
      const activeSession = await getActiveSession();
      if (!activeSession) {
        router.replace("/login");
        return;
      }
      setDevice(config);
      setSession(activeSession);
      setOrgUsers(await db.orgUsers.toArray());
      const variants = await db.variants.toArray();
      setVariantNames(new Map(variants.map((v) => [v.id, v.productName])));
    })();
  }, [router]);

  const approvers = orgUsers.filter((u) => APPROVER_ROLES.includes(u.role));

  async function lookupSale() {
    if (!session || !reference.trim()) return;
    setSearching(true);
    setSearchError(null);
    setSale(null);
    setSubmitted(null);
    try {
      const results = await apiGet<Sale[]>(
        `/sales?clientId=${encodeURIComponent(reference.trim())}`,
        session.accessToken,
      );
      if (results.length === 0) {
        setSearchError("No sale found for that reference.");
        return;
      }
      const found = results[0];
      setSale(found);
      const alreadyRefunded = found.refunds.reduce((sum, r) => sum + Number(r.amount), 0);
      const remaining = Math.max(0, Number(found.total) - alreadyRefunded);
      setAmount(remaining.toFixed(2));
    } catch (err) {
      setSearchError(
        err instanceof OfflineError ? "Offline - looking up a sale needs a connection." : "Lookup failed.",
      );
    } finally {
      setSearching(false);
    }
  }

  async function submitRefund() {
    if (!session || !sale || !approverId) return;
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || !reason.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const refund = await apiPost<Refund>(
        `/sales/${sale.id}/refunds`,
        { clientId: crypto.randomUUID(), amount: value, reason: reason.trim(), approvedById: approverId },
        session.accessToken,
      );
      setSubmitted(refund);
    } catch (err) {
      setSubmitError(
        err instanceof OfflineError
          ? "Offline - refunds need a connection."
          : err instanceof ApiError
            ? err.message
            : "Refund failed.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const alreadyRefunded = sale ? sale.refunds.reduce((sum, r) => sum + Number(r.amount), 0) : 0;
  const remaining = sale ? Math.max(0, Number(sale.total) - alreadyRefunded) : 0;

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-secondary-900 text-secondary-100">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-700 border-t-primary-400" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-secondary-900 p-4 text-secondary-100">
      <div className="mx-auto max-w-md">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">Returns · Marejesho</h1>
          <button onClick={() => router.push("/pos")} className="min-h-touch px-2 text-sm text-primary-400">
            Back to till
          </button>
        </div>

        {!submitted && (
          <>
            <div className="rounded-lg bg-secondary-800 p-4">
              <label className="mb-1.5 block text-sm text-secondary-400">
                Receipt reference (printed on the customer&apos;s receipt)
              </label>
              <div className="flex gap-2">
                <input
                  autoFocus
                  className="flex-1 rounded-md border border-secondary-600 bg-secondary-900 p-3 font-mono text-sm"
                  placeholder="e.g. 3f9c1a2b-..."
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void lookupSale()}
                />
                <Button onClick={lookupSale} disabled={searching || !reference.trim()} variant="primary" size="touch">
                  {searching ? "..." : "Find"}
                </Button>
              </div>
              {searchError && <p className="mt-2 text-sm text-error-500">{searchError}</p>}
            </div>

            {sale && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg bg-secondary-800 p-4">
                  <p className="text-xs uppercase tracking-wide text-secondary-500">
                    Sale · {new Date(sale.createdAt).toLocaleString()}
                  </p>
                  <div className="mt-2 space-y-1 text-sm">
                    {sale.lineItems.map((li) => (
                      <div key={li.id} className="flex justify-between text-secondary-300">
                        <span>{variantNames.get(li.variantId) ?? li.variantId} × {li.quantity}</span>
                        <span>KES {(Number(li.unitPrice) * Number(li.quantity)).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 space-y-1 border-t border-secondary-700 pt-2 text-sm">
                    <div className="flex justify-between"><span className="text-secondary-400">Sale total</span><span>KES {Number(sale.total).toFixed(2)}</span></div>
                    {alreadyRefunded > 0 && (
                      <div className="flex justify-between text-warning-500"><span>Already refunded</span><span>-KES {alreadyRefunded.toFixed(2)}</span></div>
                    )}
                    <div className="flex justify-between font-semibold"><span>Refundable balance</span><span>KES {remaining.toFixed(2)}</span></div>
                  </div>
                </div>

                {remaining <= 0 ? (
                  <p className="rounded-lg bg-secondary-800 p-4 text-center text-sm text-secondary-400">
                    This sale has already been fully refunded.
                  </p>
                ) : (
                  <div className="rounded-lg bg-secondary-800 p-4">
                    <label className="mb-1.5 block text-sm text-secondary-400">Refund amount (KES)</label>
                    <input
                      type="number"
                      min={0.01}
                      max={remaining}
                      className="w-full rounded-md border border-secondary-600 bg-secondary-900 p-3 text-lg"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />

                    <label className="mb-1.5 mt-3 block text-sm text-secondary-400">Reason</label>
                    <input
                      className="w-full rounded-md border border-secondary-600 bg-secondary-900 p-3"
                      placeholder="e.g. Customer returned item, wrong size"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />

                    <p className="mb-1.5 mt-3 text-sm text-secondary-400">Approved by (supervisor+)</p>
                    <div className="max-h-32 space-y-1 overflow-y-auto">
                      {approvers.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => setApproverId(a.id)}
                          className={`min-h-touch w-full rounded-md p-2 text-left ${approverId === a.id ? "bg-primary-600" : "bg-secondary-900 hover:bg-secondary-700"}`}
                        >
                          {a.fullName} <span className="text-xs text-secondary-400">({a.role})</span>
                        </button>
                      ))}
                      {approvers.length === 0 && (
                        <p className="text-sm text-secondary-500">No supervisor+ cached on this terminal.</p>
                      )}
                    </div>

                    {submitError && <p className="mt-2 text-sm text-error-500">{submitError}</p>}

                    <Button
                      onClick={submitRefund}
                      disabled={
                        submitting ||
                        !Number.isFinite(Number(amount)) ||
                        Number(amount) <= 0 ||
                        Number(amount) > remaining ||
                        !reason.trim() ||
                        !approverId
                      }
                      variant="danger"
                      size="touch"
                      className="mt-4 w-full"
                    >
                      {submitting ? "Processing..." : "Issue refund"}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {submitted && (
          <div className="rounded-lg bg-secondary-800 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-600 text-2xl">✓</div>
            <p className="mt-3 font-semibold">Refund recorded</p>
            <p className="mt-1 text-secondary-400">KES {Number(submitted.amount).toFixed(2)} - {submitted.reason}</p>
            <Button onClick={() => { setSale(null); setReference(""); setReason(""); setApproverId(""); setSubmitted(null); }} variant="primary" size="touch" className="mt-6 w-full">
              New return
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
