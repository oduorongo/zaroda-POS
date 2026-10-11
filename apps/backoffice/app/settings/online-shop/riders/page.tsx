"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiGet, apiPost, ApiError } from "../../../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";

type VehicleType = "BODA" | "TUK_TUK" | "VEHICLE";
type RiderStatus = "PENDING" | "APPROVED" | "SUSPENDED";

interface Rider {
  id: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  area: string | null;
  status: RiderStatus;
}

const VEHICLE_LABEL: Record<VehicleType, string> = { BODA: "Boda boda", TUK_TUK: "Tuk tuk", VEHICLE: "Vehicle" };
const STATUS_BADGE: Record<RiderStatus, { label: string; variant: "success" | "warning" | "error" }> = {
  APPROVED: { label: "Active", variant: "success" },
  PENDING: { label: "Not set up yet", variant: "warning" },
  SUSPENDED: { label: "Suspended", variant: "error" },
};

const EMPTY_FORM = { email: "", fullName: "", phone: "", vehicleType: "BODA" as VehicleType, plateNumber: "", area: "" };

/**
 * The business's own delivery riders. Adding one approves them straight away - the business vouches for
 * its own people - and they then sign in on the shop site's "Deliver with Zaroda" page with their email.
 */
export default function ShopRidersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRiders(await apiGet<Rider[]>("/riders"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your riders.");
    } finally {
      setLoading(false);
    }
  }, []);

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
  }, [router, load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setFormError(null);
    try {
      const created = await apiPost<Rider>("/riders", {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        vehicleType: form.vehicleType,
        plateNumber: form.plateNumber.trim() || undefined,
        area: form.area.trim() || undefined,
      });
      setRiders((current) => [created, ...current]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not add the rider.");
    } finally {
      setAdding(false);
    }
  }

  async function setStatus(rider: Rider, status: "APPROVED" | "SUSPENDED") {
    if (status === "SUSPENDED" && !confirm(`Suspend ${rider.fullName ?? rider.email}? They won't be able to take your deliveries until you reactivate them.`)) return;
    setBusyId(rider.id);
    setError(null);
    try {
      const updated = await apiPost<Rider>(`/riders/${rider.id}/status`, { status });
      setRiders((current) => current.map((r) => (r.id === rider.id ? updated : r)));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the rider.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return null;

  const canManage = session.role === "MANAGER" || session.role === "OWNER";
  const input = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">My delivery riders</h1>
          <div className="flex gap-4 text-sm">
            <Link href="/online-orders" className="text-primary-600 hover:underline">
              Online orders
            </Link>
            <Link href="/settings/online-shop" className="text-primary-600 hover:underline">
              Shop settings
            </Link>
          </div>
        </div>
        <p className="text-sm text-secondary-500">
          Riders you add here work for your shop. They sign in on the shop site (the &quot;Deliver with Zaroda&quot; link at the bottom) with the email you enter. Riders from the wider Zaroda pool will be available for your deliveries too, once deliveries start.
        </p>

        {!canManage && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-700">Only a manager or the owner can manage riders.</p>}

        {canManage && (
          <form onSubmit={add} className="space-y-3 rounded-lg border border-border bg-surface p-4">
            <h2 className="font-semibold">Add a rider</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Full name
                <input required minLength={2} maxLength={80} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className={input} />
              </label>
              <label className="text-sm">
                Phone number
                <input required type="tel" placeholder="0712 345 678" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={input} />
              </label>
              <label className="text-sm">
                Email (they sign in with this)
                <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={input} />
              </label>
              <label className="text-sm">
                Vehicle
                <select value={form.vehicleType} onChange={(e) => setForm({ ...form, vehicleType: e.target.value as VehicleType })} className={input}>
                  {(Object.keys(VEHICLE_LABEL) as VehicleType[]).map((v) => (
                    <option key={v} value={v}>
                      {VEHICLE_LABEL[v]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Number plate (optional)
                <input maxLength={15} value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} className={input} />
              </label>
              <label className="text-sm">
                Area they cover (optional)
                <input maxLength={120} value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} className={input} />
              </label>
            </div>
            {formError && <p className="text-sm text-error-600">{formError}</p>}
            <Button type="submit" disabled={adding}>
              {adding ? "Adding..." : "Add rider"}
            </Button>
          </form>
        )}

        {loading && <LoadingState label="Loading riders..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!loading && !error && riders.length === 0 && <EmptyState title="No riders yet" description="Add your first rider above." />}

        <ul className="space-y-3">
          {riders.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{r.fullName ?? r.email}</span>
                    <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
                  </div>
                  <p className="text-sm text-secondary-500">
                    {r.vehicleType ? VEHICLE_LABEL[r.vehicleType] : "No vehicle yet"}
                    {r.plateNumber ? ` · ${r.plateNumber}` : ""}
                    {r.phone ? ` · 0${r.phone.replace(/^254/, "")}` : ""}
                  </p>
                  <p className="text-sm text-secondary-500">
                    {r.email}
                    {r.area ? ` · ${r.area}` : ""}
                  </p>
                </div>
                {canManage && (
                  <div>
                    {r.status === "SUSPENDED" ? (
                      <Button variant="secondary" disabled={busyId === r.id} onClick={() => void setStatus(r, "APPROVED")}>
                        Reactivate
                      </Button>
                    ) : (
                      <Button variant="secondary" disabled={busyId === r.id} onClick={() => void setStatus(r, "SUSPENDED")}>
                        Suspend
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
