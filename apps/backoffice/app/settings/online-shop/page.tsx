"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, KENYA_COUNTIES, Label, LoadingState } from "@zaroda/ui";

interface OnlineStore {
  addonActive: boolean;
  commissionRate: number;
  isPublished: boolean;
  slug: string | null;
  displayName: string | null;
  description: string | null;
  contactPhone: string | null;
  fulfilmentBranchId: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryCounties: string[];
  tumaEmail: string | null;
  tumaConnected: boolean;
  paymentGateway: "TUMA" | "DARAJA";
  mpesaConnected: boolean;
  mpesaAccountType: "PAYBILL" | "TILL" | null;
  mpesaShortcode: string | null;
  mpesaTillNumber: string | null;
  mpesaEnvironment: "production" | "sandbox";
  publishBlockers: string[];
}

interface CommissionInvoice {
  id: string;
  invoiceNumber: string;
  periodMonth: string;
  orderCount: number;
  salesTotal: number;
  commissionTotal: number;
  status: "ISSUED" | "PAID" | "WAIVED";
  dueDate: string;
  pauseDate: string;
  pastDue: boolean;
  causesPause: boolean;
  paidAt: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  amountDue: number;
  payPhone: string | null;
  paymentPending: boolean;
  lastPaymentError: string | null;
}

interface Commission {
  commissionRate: number;
  unbilled: { orderCount: number; salesTotal: number; commissionTotal: number };
  invoices: CommissionInvoice[];
  outstandingTotal: number;
  paused: boolean;
  canPayOnline: boolean;
  contactPhone: string | null;
}

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Branch {
  id: string;
  name: string;
  county?: string | null;
}

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://shop.zarodashop.com").replace(/\/+$/, "");

/**
 * Online Shop add-on settings. The add-on itself is switched on by Zaroda
 * (platform admin) - until then this page only explains how to get it.
 * Buyers pay the business directly via the business's own TUMA account;
 * Zaroda bills its commission monthly instead of taking it from payments.
 */
export default function OnlineShopSettingsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [store, setStore] = useState<OnlineStore | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [fulfilmentBranchId, setFulfilmentBranchId] = useState("");
  const [pickupEnabled, setPickupEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  const [deliveryCounties, setDeliveryCounties] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [tumaEmail, setTumaEmail] = useState("");
  const [tumaApiKey, setTumaApiKey] = useState("");
  const [tumaBusy, setTumaBusy] = useState(false);
  const [tumaError, setTumaError] = useState<string | null>(null);

  // Which way of getting paid the form on screen is for (the active one is shown by a badge).
  const [payTab, setPayTab] = useState<"TUMA" | "DARAJA">("TUMA");
  const [mpesaAccountType, setMpesaAccountType] = useState<"PAYBILL" | "TILL">("PAYBILL");
  const [mpesaShortcode, setMpesaShortcode] = useState("");
  const [mpesaTillNumber, setMpesaTillNumber] = useState("");
  const [mpesaConsumerKey, setMpesaConsumerKey] = useState("");
  const [mpesaConsumerSecret, setMpesaConsumerSecret] = useState("");
  const [mpesaPasskey, setMpesaPasskey] = useState("");
  const [mpesaEnvironment, setMpesaEnvironment] = useState<"production" | "sandbox">("production");
  const [mpesaBusy, setMpesaBusy] = useState(false);
  const [mpesaError, setMpesaError] = useState<string | null>(null);

  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [commission, setCommission] = useState<Commission | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payPhone, setPayPhone] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  function applyStore(result: OnlineStore) {
    setStore(result);
    setSlug(result.slug ?? "");
    setDisplayName(result.displayName ?? "");
    setDescription(result.description ?? "");
    setContactPhone(result.contactPhone ?? "");
    setFulfilmentBranchId(result.fulfilmentBranchId ?? "");
    setPickupEnabled(result.pickupEnabled);
    setDeliveryEnabled(result.deliveryEnabled);
    setDeliveryCounties(result.deliveryCounties ?? []);
    setTumaEmail(result.tumaEmail ?? "");
    setPayTab(result.paymentGateway ?? "TUMA");
    setMpesaAccountType(result.mpesaAccountType ?? "PAYBILL");
    setMpesaShortcode(result.mpesaShortcode ?? "");
    setMpesaTillNumber(result.mpesaTillNumber ?? "");
    setMpesaEnvironment(result.mpesaEnvironment ?? "production");
  }

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [storeResult, branchResult] = await Promise.all([
        apiGet<OnlineStore>("/online-store/me"),
        apiGet<Branch[]>("/branches"),
      ]);
      applyStore(storeResult);
      setBranches(branchResult);
      // Commission is informational - the page still works without it.
      if (storeResult.addonActive) {
        apiGet<Commission>("/online-store/me/commission").then(setCommission).catch(() => setCommission(null));
      }
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : "Could not load online shop settings.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDetails() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await apiPatch<OnlineStore>("/online-store/me", {
        slug: slug.trim() || undefined,
        displayName,
        description,
        contactPhone,
        fulfilmentBranchId: fulfilmentBranchId || undefined,
        pickupEnabled,
        deliveryEnabled,
        deliveryCounties,
      });
      applyStore(result);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function connectTuma() {
    setTumaBusy(true);
    setTumaError(null);
    try {
      const result = await apiPost<OnlineStore>("/online-store/me/tuma", { email: tumaEmail.trim(), apiKey: tumaApiKey.trim() });
      applyStore(result);
      setTumaApiKey("");
    } catch (err) {
      setTumaError(err instanceof ApiError ? err.message : "Could not connect TUMA.");
    } finally {
      setTumaBusy(false);
    }
  }

  async function disconnectTuma() {
    if (!confirm("Disconnect TUMA? Your shop will be taken offline until you connect again.")) return;
    setTumaBusy(true);
    setTumaError(null);
    try {
      applyStore(await apiDelete<OnlineStore>("/online-store/me/tuma"));
    } catch (err) {
      setTumaError(err instanceof ApiError ? err.message : "Could not disconnect TUMA.");
    } finally {
      setTumaBusy(false);
    }
  }

  async function connectMpesa() {
    setMpesaBusy(true);
    setMpesaError(null);
    try {
      const result = await apiPost<OnlineStore>("/online-store/me/mpesa", {
        accountType: mpesaAccountType,
        shortcode: mpesaShortcode.trim(),
        ...(mpesaAccountType === "TILL" ? { tillNumber: mpesaTillNumber.trim() } : {}),
        consumerKey: mpesaConsumerKey.trim(),
        consumerSecret: mpesaConsumerSecret.trim(),
        passkey: mpesaPasskey.trim(),
        environment: mpesaEnvironment,
      });
      applyStore(result);
      setMpesaConsumerKey("");
      setMpesaConsumerSecret("");
      setMpesaPasskey("");
    } catch (err) {
      setMpesaError(err instanceof ApiError ? err.message : "Could not connect M-Pesa.");
    } finally {
      setMpesaBusy(false);
    }
  }

  async function disconnectMpesa() {
    if (!confirm("Remove your M-Pesa details? Buyers will pay through TUMA instead, and your shop goes offline if TUMA is not connected.")) return;
    setMpesaBusy(true);
    setMpesaError(null);
    try {
      applyStore(await apiDelete<OnlineStore>("/online-store/me/mpesa"));
    } catch (err) {
      setMpesaError(err instanceof ApiError ? err.message : "Could not remove the M-Pesa details.");
    } finally {
      setMpesaBusy(false);
    }
  }

  async function switchGateway(gateway: "TUMA" | "DARAJA") {
    setMpesaBusy(true);
    setMpesaError(null);
    setTumaError(null);
    try {
      applyStore(await apiPost<OnlineStore>("/online-store/me/payment-gateway", { gateway }));
    } catch (err) {
      (gateway === "DARAJA" ? setMpesaError : setTumaError)(err instanceof ApiError ? err.message : "Could not switch.");
    } finally {
      setMpesaBusy(false);
    }
  }

  async function setPublished(isPublished: boolean) {
    setPublishBusy(true);
    setPublishError(null);
    try {
      applyStore(await apiPatch<OnlineStore>("/online-store/me", { isPublished }));
    } catch (err) {
      setPublishError(err instanceof ApiError ? err.message : "Could not update your shop.");
    } finally {
      setPublishBusy(false);
    }
  }

  function replaceInvoice(updated: CommissionInvoice) {
    setCommission((current) => (current ? { ...current, invoices: current.invoices.map((i) => (i.id === updated.id ? updated : i)) } : current));
  }

  async function reloadCommission() {
    try {
      setCommission(await apiGet<Commission>("/online-store/me/commission"));
    } catch {
      /* informational - keep what we have */
    }
  }

  async function payInvoice(invoice: CommissionInvoice) {
    setPayBusy(true);
    setPayError(null);
    try {
      replaceInvoice(await apiPost<CommissionInvoice>(`/online-store/me/commission/invoices/${invoice.id}/pay`, { phone: payPhone.trim() }));
      setPayingId(null);
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : "Could not start the payment.");
    } finally {
      setPayBusy(false);
    }
  }

  // While an M-Pesa prompt is out, re-read the invoices every few seconds. These
  // are plain, free reads: Zaroda's server learns of the payment from Tuma's own
  // notification and the invoice turns Paid by itself (and a shop that was hidden
  // for it reappears). The paid "check now" button below is only the backup.
  const hasPendingPayment = Boolean(commission?.invoices.some((i) => i.paymentPending));
  useEffect(() => {
    if (!hasPendingPayment) return;
    const timer = setInterval(() => void reloadCommission(), 5000);
    return () => clearInterval(timer);
  }, [hasPendingPayment]);

  const [checkNote, setCheckNote] = useState<string | null>(null);
  async function checkNow(invoice: CommissionInvoice) {
    setCheckNote(null);
    try {
      const result = await apiPost<CommissionInvoice & { checkResult: string }>(`/online-store/me/commission/invoices/${invoice.id}/check`, {});
      replaceInvoice(result);
      if (result.status !== "ISSUED") void reloadCommission();
      else if (result.checkResult === "not-paid-yet") setCheckNote("Not received yet. If you have just entered your PIN, give it a minute and try again.");
      else if (result.checkResult === "unavailable") setCheckNote("We couldn't check just now. If you have paid, Zaroda will confirm it - or try again in a few minutes.");
    } catch (err) {
      setCheckNote(err instanceof ApiError ? err.message : "Could not check the payment.");
    }
  }

  if (!session) return null;

  const isManager = session.role === "MANAGER" || session.role === "OWNER";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-xl font-bold">Online Shop</h1>

        {loading && <LoadingState label="Loading online shop..." />}

        {!loading && !isManager && (
          <EmptyState title="Owners and managers only" description="Ask your business owner or a manager to set up the online shop." />
        )}

        {!loading && isManager && loadError && <p className="text-sm text-error-600">{loadError}</p>}

        {!loading && isManager && store && !store.addonActive && (
          <Card>
            <CardContent className="space-y-2 py-6">
              <h2 className="font-semibold">Sell online with Zaroda</h2>
              <p className="text-sm text-secondary-600">
                Put your products on the Zaroda marketplace and get your own shop link. Online stock comes straight from your POS
                inventory, so you never sell something that just sold at the counter. Buyers pay you directly, through TUMA or your own
                M-Pesa Paybill or Till.
              </p>
              <p className="text-sm text-secondary-600">
                The Online Shop is a paid add-on. Contact Zaroda to turn it on for your business.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && isManager && store?.addonActive && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Shop status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {commission?.paused && store.isPublished ? (
                    <Badge variant="error">Hidden - commission unpaid</Badge>
                  ) : store.isPublished ? (
                    <Badge variant="success">Live</Badge>
                  ) : (
                    <Badge variant="neutral">Offline</Badge>
                  )}
                  {store.slug && (
                    <span className="break-all text-sm text-secondary-600">
                      {STOREFRONT_URL}/s/{store.slug}
                    </span>
                  )}
                  {store.slug && (
                    <a href="/settings/online-shop/poster" className="text-sm font-semibold text-primary-600 hover:underline">
                      Print a poster with a QR code
                    </a>
                  )}
                </div>
                {!store.isPublished && store.publishBlockers.length > 0 && (
                  <div className="text-sm">
                    <p className="font-medium">Before your shop can go live:</p>
                    <ul className="mt-1 list-disc pl-5 text-secondary-600">
                      {store.publishBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {commission?.paused && (
                  <p className="rounded-md bg-error-50 p-3 text-sm text-error-700">
                    Buyers can&apos;t see or order from your shop because a commission invoice is overdue. Pay it to Zaroda and ask them to record it, and your shop reappears straight away. Orders already placed are not affected.
                  </p>
                )}
                <p className="text-xs text-secondary-500">
                  Zaroda commission: {Number((store.commissionRate * 100).toFixed(2))}% of each completed online
                  order&apos;s product total (delivery excluded), invoiced monthly. See below.
                </p>
                {publishError && <p className="text-sm text-error-600">{publishError}</p>}
                {store.isPublished ? (
                  <Button variant="outline" onClick={() => void setPublished(false)} disabled={publishBusy}>
                    {publishBusy ? "..." : "Take shop offline"}
                  </Button>
                ) : (
                  <Button onClick={() => void setPublished(true)} disabled={publishBusy || store.publishBlockers.length > 0}>
                    {publishBusy ? "..." : "Go live"}
                  </Button>
                )}
              </CardContent>
            </Card>

            {commission && (
              <Card>
                <CardHeader>
                  <CardTitle>Commission</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-secondary-500">You owe Zaroda now</p>
                      <p className={`text-xl font-bold ${commission.outstandingTotal > 0 ? "text-warning-700" : ""}`}>{kes(commission.outstandingTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-secondary-500">Building up this month</p>
                      <p className="text-xl font-bold">{kes(commission.unbilled.commissionTotal)}</p>
                      <p className="text-xs text-secondary-500">
                        from {commission.unbilled.orderCount} completed {commission.unbilled.orderCount === 1 ? "order or booking" : "orders and bookings"}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-secondary-500">
                    Completed orders are added up when each month ends. We email you the invoice automatically, due 14 days later, and you can pay it here with M-Pesa. If an invoice stays unpaid a further 7 days, your shop is hidden from buyers until it&apos;s settled.
                  </p>
                  {commission.invoices.length === 0 ? (
                    <p className="text-sm text-secondary-500">No invoices yet.</p>
                  ) : (
                    <ul className="divide-y divide-border text-sm">
                      {commission.invoices.map((inv) => (
                        <li key={inv.id} className="space-y-2 py-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <span className="font-mono text-xs">{inv.invoiceNumber}</span>
                              <span className="ml-2 text-secondary-500">{inv.periodMonth} · {inv.orderCount} orders and bookings</span>
                              {inv.status === "ISSUED" && <span className="block text-xs text-secondary-500">Due {new Date(inv.dueDate).toLocaleDateString("en-KE")}</span>}
                              {inv.status === "PAID" && inv.paymentReference && (
                                <span className="block text-xs text-secondary-500">Paid {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString("en-KE") : ""} · {inv.paymentMethod} {inv.paymentReference}</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold">{inv.status === "ISSUED" ? kes(inv.amountDue) : kes(inv.commissionTotal)}</span>
                              {inv.status === "PAID" && <Badge variant="success">Paid</Badge>}
                              {inv.status === "WAIVED" && <Badge variant="neutral">Waived</Badge>}
                              {inv.status === "ISSUED" && (inv.causesPause ? <Badge variant="error">Overdue</Badge> : inv.pastDue ? <Badge variant="warning">Past due</Badge> : <Badge variant="primary">Due</Badge>)}
                              {inv.status === "ISSUED" && commission.canPayOnline && !inv.paymentPending && payingId !== inv.id && (
                                <Button
                                  size="sm"
                                  onClick={() => {
                                    setPayingId(inv.id);
                                    setPayError(null);
                                    setPayPhone(inv.payPhone ? `0${inv.payPhone.slice(3)}` : (commission.contactPhone ?? ""));
                                  }}
                                >
                                  Pay with M-Pesa
                                </Button>
                              )}
                            </div>
                          </div>

                          {inv.paymentPending && (
                            <p className="rounded-md bg-primary-50 p-2 text-xs text-primary-700">
                              Check your phone ({inv.payPhone ? `0${inv.payPhone.slice(3)}` : ""}) for the M-Pesa prompt for {kes(inv.amountDue)} and enter your PIN. This updates by itself.
                              <button onClick={() => void checkNow(inv)} className="ml-2 underline">
                                Paid already? Check now
                              </button>
                              {checkNote && <span className="mt-1 block text-secondary-700">{checkNote}</span>}
                            </p>
                          )}
                          {inv.status === "ISSUED" && inv.lastPaymentError && !inv.paymentPending && payingId !== inv.id && (
                            <p className="text-xs text-error-600">{inv.lastPaymentError}</p>
                          )}

                          {payingId === inv.id && (
                            <div className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3">
                              <div>
                                <Label>M-Pesa number</Label>
                                <Input type="tel" value={payPhone} onChange={(e) => setPayPhone(e.target.value)} placeholder="0712 345 678" />
                              </div>
                              <Button size="sm" onClick={() => void payInvoice(inv)} disabled={payBusy || !payPhone.trim()}>
                                {payBusy ? "Sending..." : `Pay ${kes(inv.amountDue)}`}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setPayingId(null)}>
                                Cancel
                              </Button>
                              {payError && <p className="w-full text-xs text-error-600">{payError}</p>}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Shop details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>Shop name</Label>
                  <Input placeholder="e.g. Mama Mboga Groceries" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </div>
                <div>
                  <Label>Shop link</Label>
                  <div className="flex items-center gap-1">
                    <span className="whitespace-nowrap text-sm text-secondary-500">/s/</span>
                    <Input placeholder="mama-mboga" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} />
                  </div>
                  <p className="mt-1 text-xs text-secondary-500">Lowercase letters, numbers and hyphens. Changing it breaks links you&apos;ve already shared.</p>
                </div>
                <div>
                  <Label>Description</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    maxLength={1000}
                    placeholder="What you sell, opening hours, anything buyers should know."
                    className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                  />
                </div>
                <div>
                  <Label>Contact phone</Label>
                  <Input placeholder="07XX XXX XXX" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
                </div>
                <div>
                  <Label>Branch that fulfils online orders</Label>
                  <select
                    value={fulfilmentBranchId}
                    onChange={(e) => setFulfilmentBranchId(e.target.value)}
                    className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                  >
                    <option value="">Choose a branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-secondary-500">Online stock comes from this branch, and buyers collect pickup orders here.</p>
                </div>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={pickupEnabled} onChange={(e) => setPickupEnabled(e.target.checked)} className="h-4 w-4" />
                    Buyers can pick up orders
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={deliveryEnabled} onChange={(e) => setDeliveryEnabled(e.target.checked)} className="h-4 w-4" />
                    Offer delivery (a rider brings the order)
                  </label>
                </div>
                {deliveryEnabled && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <p className="text-sm font-medium">Which counties do you deliver to?</p>
                    <p className="text-xs text-secondary-500">
                      Food and goods cannot travel across the country, so shoppers can only order delivery from you for the counties you tick here.
                      {deliveryCounties.length === 0
                        ? ` If you tick none, you deliver only in your branch's own county${branches.find((b) => b.id === fulfilmentBranchId)?.county ? ` (${branches.find((b) => b.id === fulfilmentBranchId)?.county})` : " - set a county on your branch (Branches page) so this works"}.`
                        : " Pickup, hotel rooms and rentals are never limited."}
                    </p>
                    <div className="grid max-h-56 grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto sm:grid-cols-3">
                      {KENYA_COUNTIES.map((c) => (
                        <label key={c} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            checked={deliveryCounties.includes(c)}
                            onChange={(e) => setDeliveryCounties((current) => (e.target.checked ? [...current, c] : current.filter((x) => x !== c)))}
                          />
                          {c}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                {saveError && <p className="text-sm text-error-600">{saveError}</p>}
                {saved && <p className="text-sm text-success-600">Saved.</p>}
                <Button onClick={() => void saveDetails()} disabled={saving}>
                  {saving ? "Saving..." : "Save details"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>How you get paid</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-secondary-600">
                  Buyers pay you directly by M-Pesa and the money goes to you, not to Zaroda. Choose how: through a TUMA account, or through
                  your own M-Pesa Paybill or Till.
                </p>
                <div className="flex flex-wrap gap-2">
                  {(["TUMA", "DARAJA"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setPayTab(tab)}
                      className={`rounded-md border px-3 py-1.5 text-sm font-medium ${payTab === tab ? "border-primary-500 bg-primary-500/10 text-foreground" : "border-border text-secondary-600"}`}
                    >
                      {tab === "TUMA" ? "TUMA" : "My own M-Pesa (Paybill or Till)"}
                      {store.paymentGateway === tab && <span className="ml-2 text-xs text-success-600">In use</span>}
                    </button>
                  ))}
                </div>

                {payTab === "TUMA" && (
                  <>
                    <p className="text-sm text-secondary-600">
                      Sign up at tuma.co.ke, then copy your API key from the Developer API section of the TUMA merchant portal.
                    </p>
                {store.tumaConnected ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant="success">Connected</Badge>
                    <span className="text-sm">{store.tumaEmail}</span>
                    <Button variant="outline" size="sm" onClick={() => void disconnectTuma()} disabled={tumaBusy}>
                      Disconnect
                    </Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label>TUMA account email</Label>
                      <Input type="email" value={tumaEmail} onChange={(e) => setTumaEmail(e.target.value)} />
                    </div>
                    <div>
                      <Label>TUMA API key</Label>
                      <Input type="password" autoComplete="off" value={tumaApiKey} onChange={(e) => setTumaApiKey(e.target.value)} />
                      <p className="mt-1 text-xs text-secondary-500">We check it with TUMA, then store it encrypted. It&apos;s never shown again.</p>
                    </div>
                    <Button onClick={() => void connectTuma()} disabled={tumaBusy || !tumaEmail.trim() || !tumaApiKey.trim()}>
                      {tumaBusy ? "Checking with TUMA..." : "Connect TUMA"}
                    </Button>
                  </>
                )}

                    {store.tumaConnected && store.paymentGateway !== "TUMA" && (
                      <Button size="sm" onClick={() => void switchGateway("TUMA")} disabled={mpesaBusy}>
                        Use TUMA for new orders
                      </Button>
                    )}
                    {tumaError && <p className="text-sm text-error-600">{tumaError}</p>}
                  </>
                )}

                {payTab === "DARAJA" && (
                  <>
                    <p className="text-sm text-secondary-600">
                      Use your own Safaricom Daraja app, so shoppers&apos; M-Pesa prompts pay straight into your Paybill or Till. Create an app at
                      developer.safaricom.co.ke, request Go Live for your shortcode, then copy its keys here.
                    </p>
                    {store.mpesaConnected ? (
                      <div className="space-y-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge variant="success">Connected</Badge>
                          <span className="text-sm">
                            {store.mpesaAccountType === "TILL" ? "Till" : "Paybill"} {store.mpesaAccountType === "TILL" ? store.mpesaTillNumber : store.mpesaShortcode}
                            {store.mpesaEnvironment === "sandbox" ? " (sandbox - test only)" : ""}
                          </span>
                          <Button variant="outline" size="sm" onClick={() => void disconnectMpesa()} disabled={mpesaBusy}>
                            Remove
                          </Button>
                        </div>
                        {store.paymentGateway !== "DARAJA" && (
                          <Button size="sm" onClick={() => void switchGateway("DARAJA")} disabled={mpesaBusy}>
                            Use my M-Pesa for new orders
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div>
                          <Label>Account type</Label>
                          <select
                            value={mpesaAccountType}
                            onChange={(e) => setMpesaAccountType(e.target.value as "PAYBILL" | "TILL")}
                            className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                          >
                            <option value="PAYBILL">Paybill</option>
                            <option value="TILL">Till (Buy Goods)</option>
                          </select>
                        </div>
                        <div>
                          <Label>{mpesaAccountType === "TILL" ? "Store number (Head Office shortcode)" : "Paybill number"}</Label>
                          <Input inputMode="numeric" value={mpesaShortcode} onChange={(e) => setMpesaShortcode(e.target.value)} />
                        </div>
                        {mpesaAccountType === "TILL" && (
                          <div>
                            <Label>Till number</Label>
                            <Input inputMode="numeric" value={mpesaTillNumber} onChange={(e) => setMpesaTillNumber(e.target.value)} />
                          </div>
                        )}
                        <div>
                          <Label>Consumer key</Label>
                          <Input type="password" autoComplete="off" value={mpesaConsumerKey} onChange={(e) => setMpesaConsumerKey(e.target.value)} />
                        </div>
                        <div>
                          <Label>Consumer secret</Label>
                          <Input type="password" autoComplete="off" value={mpesaConsumerSecret} onChange={(e) => setMpesaConsumerSecret(e.target.value)} />
                        </div>
                        <div>
                          <Label>Passkey</Label>
                          <Input type="password" autoComplete="off" value={mpesaPasskey} onChange={(e) => setMpesaPasskey(e.target.value)} />
                        </div>
                        <div>
                          <Label>Environment</Label>
                          <select
                            value={mpesaEnvironment}
                            onChange={(e) => setMpesaEnvironment(e.target.value as "production" | "sandbox")}
                            className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                          >
                            <option value="production">Live (real money)</option>
                            <option value="sandbox">Sandbox (testing only)</option>
                          </select>
                        </div>
                        <p className="text-xs text-secondary-500">We check the key and secret with Safaricom, then store everything encrypted. They are never shown again.</p>
                        <Button
                          onClick={() => void connectMpesa()}
                          disabled={
                            mpesaBusy ||
                            !mpesaShortcode.trim() ||
                            (mpesaAccountType === "TILL" && !mpesaTillNumber.trim()) ||
                            !mpesaConsumerKey.trim() ||
                            !mpesaConsumerSecret.trim() ||
                            !mpesaPasskey.trim()
                          }
                        >
                          {mpesaBusy ? "Checking with Safaricom..." : "Connect my M-Pesa"}
                        </Button>
                      </div>
                    )}
                    {mpesaError && <p className="text-sm text-error-600">{mpesaError}</p>}
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
