"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, Card, CardContent, EmptyState, Input, LoadingState, Modal, ModalFooter } from "@zaroda/ui";

type InvoiceStatus = "ISSUED" | "PAID" | "WAIVED";

interface Invoice {
  id: string;
  organizationId: string;
  organizationName: string;
  invoiceNumber: string;
  periodMonth: string;
  orderCount: number;
  salesTotal: number;
  commissionTotal: number;
  status: InvoiceStatus;
  dueDate: string;
  pauseDate: string;
  pastDue: boolean;
  causesPause: boolean;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  waivedReason: string | null;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-KE");

/**
 * Online Shop commission invoices. Buyers pay businesses directly, so
 * Zaroda bills its 3% monthly - and it all happens by itself: the API's
 * scheduler creates each month's invoices, emails them and the
 * reminders, and businesses pay online through Tuma, which settles the
 * invoice automatically. This page is the overview, plus the manual
 * exceptions: money that arrived another way (bank, cash), waiving an
 * invoice, and "run it now". A business unpaid past the due date plus the
 * grace period is hidden from buyers until it settles.
 */
export default function CommissionPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [filter, setFilter] = useState<"UNPAID" | "ALL">("UNPAID");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const [paying, setPaying] = useState<Invoice | null>(null);
  const [method, setMethod] = useState("MPESA");
  const [reference, setReference] = useState("");
  const [waiving, setWaiving] = useState<Invoice | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setInvoices(await apiGet<Invoice[]>("/platform-admin/commission/invoices"));
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load commission invoices.");
    } finally {
      setLoading(false);
    }
  }

  async function generateNow() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiPost<{ invoicesCreated: number; paymentsConfirmed: number; emailsSent: number; emailsSkipped: number }>("/platform-admin/commission/run", {});
      const parts = [
        `${result.invoicesCreated} new invoice${result.invoicesCreated === 1 ? "" : "s"}`,
        `${result.paymentsConfirmed} payment${result.paymentsConfirmed === 1 ? "" : "s"} confirmed`,
        `${result.emailsSent} email${result.emailsSent === 1 ? "" : "s"} sent`,
      ];
      setNotice(`Billing run complete: ${parts.join(", ")}.${result.emailsSkipped > 0 ? ` ${result.emailsSkipped} could not be emailed (no email address, or email is not set up).` : ""}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not run billing.");
    } finally {
      setGenerating(false);
    }
  }

  async function submitPayment() {
    if (!paying) return;
    setBusy(true);
    setModalError(null);
    try {
      await apiPost(`/platform-admin/organizations/${paying.organizationId}/commission-invoices/${paying.id}/payment`, {
        method,
        reference: reference.trim() || undefined,
      });
      setPaying(null);
      setReference("");
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not record the payment.");
    } finally {
      setBusy(false);
    }
  }

  async function submitWaive() {
    if (!waiving) return;
    setBusy(true);
    setModalError(null);
    try {
      await apiPost(`/platform-admin/organizations/${waiving.organizationId}/commission-invoices/${waiving.id}/waive`, { reason: reason.trim() });
      setWaiving(null);
      setReason("");
      await load();
    } catch (err) {
      setModalError(err instanceof ApiError ? err.message : "Could not waive the invoice.");
    } finally {
      setBusy(false);
    }
  }

  const visible = useMemo(() => (filter === "UNPAID" ? invoices.filter((i) => i.status === "ISSUED") : invoices), [invoices, filter]);
  const outstanding = useMemo(() => invoices.filter((i) => i.status === "ISSUED").reduce((sum, i) => sum + i.commissionTotal, 0), [invoices]);
  const pausedShops = useMemo(() => new Set(invoices.filter((i) => i.causesPause).map((i) => i.organizationId)).size, [invoices]);

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-6xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold">Online Shop commission</h1>
          <Button variant="outline" onClick={() => void generateNow()} disabled={generating}>
            {generating ? "Running..." : "Run billing now"}
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-secondary-500">Outstanding</p>
              <p className="text-2xl font-bold">{kes(outstanding)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-secondary-500">Unpaid invoices</p>
              <p className="text-2xl font-bold">{invoices.filter((i) => i.status === "ISSUED").length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-secondary-500">Shops hidden for non-payment</p>
              <p className={`text-2xl font-bold ${pausedShops > 0 ? "text-error-600" : ""}`}>{pausedShops}</p>
            </CardContent>
          </Card>
        </div>

        {notice && <p className="rounded-md bg-success-50 p-3 text-sm text-success-700">{notice}</p>}
        {error && <p className="text-sm text-error-600">{error}</p>}

        <div className="flex gap-2 text-sm">
          {(["UNPAID", "ALL"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 ${filter === f ? "border-amber-400 bg-amber-400/10 font-medium" : "border-border"}`}
            >
              {f === "UNPAID" ? "Unpaid" : "All invoices"}
            </button>
          ))}
        </div>

        {loading ? (
          <LoadingState label="Loading invoices..." />
        ) : visible.length === 0 ? (
          <EmptyState title="No invoices here" description={filter === "UNPAID" ? "Nothing is waiting to be paid." : "Invoices are created automatically once a month with completed online orders has ended."} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-xs uppercase text-secondary-500">
                <tr>
                  <th className="p-3">Business</th>
                  <th className="p-3">Invoice</th>
                  <th className="p-3 text-right">Orders and bookings</th>
                  <th className="p-3 text-right">Sales</th>
                  <th className="p-3 text-right">Commission</th>
                  <th className="p-3">Due</th>
                  <th className="p-3">Status</th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {visible.map((inv) => (
                  <tr key={inv.id} className="border-t border-border">
                    <td className="p-3 font-medium">{inv.organizationName}</td>
                    <td className="p-3">
                      <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                      <span className="block text-xs text-secondary-500">{inv.periodMonth}</span>
                    </td>
                    <td className="p-3 text-right">{inv.orderCount}</td>
                    <td className="p-3 text-right font-mono">{kes(inv.salesTotal)}</td>
                    <td className="p-3 text-right font-mono font-semibold">{kes(inv.commissionTotal)}</td>
                    <td className="p-3 text-xs">
                      {day(inv.dueDate)}
                      {inv.status === "ISSUED" && <span className="block text-secondary-500">hides shop {day(inv.pauseDate)}</span>}
                    </td>
                    <td className="p-3">
                      {inv.status === "PAID" && (
                        <>
                          <Badge variant="success">Paid</Badge>
                          <span className="block text-xs text-secondary-500">
                            {inv.paymentMethod} {inv.paymentReference ?? ""} {inv.paidAt ? day(inv.paidAt) : ""}
                          </span>
                        </>
                      )}
                      {inv.status === "WAIVED" && (
                        <>
                          <Badge variant="neutral">Waived</Badge>
                          {inv.waivedReason && <span className="block text-xs text-secondary-500">{inv.waivedReason}</span>}
                        </>
                      )}
                      {inv.status === "ISSUED" && (inv.causesPause ? <Badge variant="error">Shop hidden</Badge> : inv.pastDue ? <Badge variant="warning">Past due</Badge> : <Badge variant="primary">Issued</Badge>)}
                    </td>
                    <td className="whitespace-nowrap p-3 text-right">
                      {inv.status === "ISSUED" && (
                        <>
                          <Button size="sm" onClick={() => { setPaying(inv); setModalError(null); }}>
                            Record payment
                          </Button>{" "}
                          <Button size="sm" variant="ghost" onClick={() => { setWaiving(inv); setModalError(null); }}>
                            Waive
                          </Button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Modal open={!!paying} onClose={() => setPaying(null)} title={paying ? `Record payment - ${paying.organizationName}` : ""}>
          {paying && (
            <div className="space-y-3">
              <p className="text-sm">
                Invoice <span className="font-mono">{paying.invoiceNumber}</span> for <strong>{kes(paying.commissionTotal)}</strong>. Record this only once the money has reached you.
              </p>
              <div>
                <label className="mb-1.5 block text-sm text-secondary-500">Method</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)} className="w-full rounded-md border border-border bg-surface p-2.5 text-sm">
                  <option value="MPESA">M-Pesa</option>
                  <option value="BANK">Bank transfer</option>
                  <option value="CASH">Cash</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-secondary-500">Reference (optional)</label>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="M-Pesa code, cheque #, etc." />
              </div>
              {modalError && <p className="text-sm text-error-600">{modalError}</p>}
            </div>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={() => setPaying(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitPayment()} disabled={busy}>
              {busy ? "Recording..." : "Mark as paid"}
            </Button>
          </ModalFooter>
        </Modal>

        <Modal open={!!waiving} onClose={() => setWaiving(null)} title={waiving ? `Waive invoice - ${waiving.organizationName}` : ""}>
          {waiving && (
            <div className="space-y-3">
              <p className="text-sm">
                Waiving writes off <strong>{kes(waiving.commissionTotal)}</strong> ({waiving.invoiceNumber}). The business owes nothing for it and its shop will no longer be hidden because of it.
              </p>
              <div>
                <label className="mb-1.5 block text-sm text-secondary-500">Reason</label>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Launch promotion" />
              </div>
              {modalError && <p className="text-sm text-error-600">{modalError}</p>}
            </div>
          )}
          <ModalFooter>
            <Button variant="secondary" onClick={() => setWaiving(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void submitWaive()} disabled={busy || reason.trim().length < 3}>
              {busy ? "Waiving..." : "Waive invoice"}
            </Button>
          </ModalFooter>
        </Modal>
      </main>
    </div>
  );
}
