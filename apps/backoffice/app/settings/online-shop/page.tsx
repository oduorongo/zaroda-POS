"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { PageHeader } from "../../../components/page-header";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, EmptyState, Input, Label, LoadingState } from "@zaroda/ui";

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
  tumaEmail: string | null;
  tumaConnected: boolean;
  publishBlockers: string[];
}

interface Branch {
  id: string;
  name: string;
}

const STOREFRONT_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://zarodashop.com").replace(/\/+$/, "");

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [tumaEmail, setTumaEmail] = useState("");
  const [tumaApiKey, setTumaApiKey] = useState("");
  const [tumaBusy, setTumaBusy] = useState(false);
  const [tumaError, setTumaError] = useState<string | null>(null);

  const [publishBusy, setPublishBusy] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

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
    setTumaEmail(result.tumaEmail ?? "");
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
                inventory, so you never sell something that just sold at the counter. Buyers pay you directly through your TUMA
                account.
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
                  {store.isPublished ? <Badge variant="success">Live</Badge> : <Badge variant="neutral">Offline</Badge>}
                  {store.slug && (
                    <span className="break-all text-sm text-secondary-600">
                      {STOREFRONT_URL}/s/{store.slug}
                    </span>
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
                <p className="text-xs text-secondary-500">
                  Zaroda commission: {Number((store.commissionRate * 100).toFixed(2))}% of each completed online
                  order&apos;s product total (delivery excluded), billed monthly with your subscription.
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
                    We deliver orders ourselves
                  </label>
                </div>
                {saveError && <p className="text-sm text-error-600">{saveError}</p>}
                {saved && <p className="text-sm text-success-600">Saved.</p>}
                <Button onClick={() => void saveDetails()} disabled={saving}>
                  {saving ? "Saving..." : "Save details"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Payments (TUMA)</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-secondary-600">
                  Buyers pay you directly by M-Pesa through your own TUMA account, and the money settles to your bank or till. Sign up at
                  tuma.co.ke, then copy your API key from the Developer API section of the TUMA merchant portal.
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
                {tumaError && <p className="text-sm text-error-600">{tumaError}</p>}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
