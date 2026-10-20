"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";

type VehicleType = "BODA" | "TUK_TUK" | "VEHICLE";
type RiderStatus = "PENDING" | "APPROVED" | "SUSPENDED";

interface Rider {
  id: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  area: string | null;
  status: RiderStatus;
  kind: "SHOP" | "POOL";
  profileComplete: boolean;
  businessName: string | null;
  createdAt: string;
}

const VEHICLE_LABEL: Record<VehicleType, string> = { BODA: "Boda boda", TUK_TUK: "Tuk tuk", VEHICLE: "Vehicle" };
const STATUS_BADGE: Record<RiderStatus, { label: string; variant: "success" | "warning" | "error" }> = {
  PENDING: { label: "Waiting", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  SUSPENDED: { label: "Suspended", variant: "error" },
};
const FILTERS: { key: RiderStatus | "ALL"; label: string }[] = [
  { key: "PENDING", label: "Waiting for approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "SUSPENDED", label: "Suspended" },
  { key: "ALL", label: "All" },
];

/**
 * Delivery riders. Riders who sign up on their own (the shared pool) wait here for a Zaroda
 * admin to approve them; businesses' own riders are approved by the business itself, but can be
 * suspended here too. A rider can only be approved once their name, phone and vehicle are filled in.
 */
export default function RidersPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [filter, setFilter] = useState<RiderStatus | "ALL">("PENDING");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pinNotice, setPinNotice] = useState<{ name: string; phone: string; pin: string } | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSession(s);
  }, [router]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiGet<Rider[]>(`/platform-admin/riders${filter === "ALL" ? "" : `?status=${filter}`}`)
      .then((result) => !cancelled && setRiders(result))
      .catch((err) => !cancelled && setError(err instanceof ApiError ? err.message : "Could not load riders."))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [session, filter]);

  async function resetPin(rider: Rider) {
    if (!confirm(`Give ${rider.fullName ?? "this rider"} a new PIN? Their old PIN stops working.`)) return;
    setBusyId(rider.id);
    setError(null);
    try {
      const updated = await apiPost<Rider & { temporaryPin: string }>(`/platform-admin/riders/${rider.id}/reset-pin`, {});
      setPinNotice({ name: updated.fullName ?? "the rider", phone: rider.phone ? `0${rider.phone.replace(/^254/, "")}` : "", pin: updated.temporaryPin });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not reset the PIN.");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(rider: Rider, status: "APPROVED" | "SUSPENDED") {
    if (status === "SUSPENDED" && !confirm(`Suspend ${rider.fullName ?? rider.phone ?? "this rider"}? They will not be able to take deliveries.`)) return;
    setBusyId(rider.id);
    setError(null);
    try {
      const updated = await apiPost<Rider>(`/platform-admin/riders/${rider.id}/status`, { status });
      // Keep the list honest: a rider that no longer matches the filter drops out of it.
      setRiders((current) =>
        current.flatMap((r) => (r.id !== rider.id ? [r] : filter === "ALL" || filter === updated.status ? [{ ...r, ...updated }] : [])),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update the rider.");
    } finally {
      setBusyId(null);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-5xl space-y-4 p-6">
        <h1 className="text-xl font-bold">Delivery riders</h1>

        {pinNotice && (
          <div className="rounded-lg border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
            <p className="font-semibold">
              PIN for {pinNotice.name}: <span className="font-mono text-lg tracking-widest">{pinNotice.pin}</span>
            </p>
            <p className="mt-1 text-secondary-500">
              Tell the rider (call them on the number shown) now - it is shown only once. They sign in with their phone number{pinNotice.phone ? ` (${pinNotice.phone})` : ""} and this PIN, and can change the PIN after signing in.
            </p>
            <button type="button" onClick={() => setPinNotice(null)} className="mt-2 text-xs underline">
              I have noted it
            </button>
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-border">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                filter === f.key ? "border-amber-500 font-semibold" : "border-transparent text-secondary-500 hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {loading && <LoadingState label="Loading riders..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!loading && !error && riders.length === 0 && (
          <EmptyState title="No riders here" description={filter === "PENDING" ? "Riders who sign up will wait here for approval." : "No riders in this list."} />
        )}

        <ul className="space-y-3">
          {riders.map((r) => (
            <li key={r.id} className="rounded-lg border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{r.fullName ?? "(no name yet)"}</span>
                    <Badge variant={STATUS_BADGE[r.status].variant}>{STATUS_BADGE[r.status].label}</Badge>
                    <Badge variant="neutral">{r.kind === "SHOP" ? `Rides for ${r.businessName ?? "a shop"}` : "Shared pool"}</Badge>
                    {!r.profileComplete && <Badge variant="warning">Profile not finished</Badge>}
                  </div>
                  <p className="text-sm text-secondary-500">
                    {r.vehicleType ? VEHICLE_LABEL[r.vehicleType] : "No vehicle yet"}
                    {r.plateNumber ? ` · ${r.plateNumber}` : ""}
                    {r.phone ? ` · 0${r.phone.replace(/^254/, "")}` : ""}
                  </p>
                  <p className="text-sm text-secondary-500">
                    {r.email ?? "No email"}
                    {r.area ? ` · ${r.area}` : ""} · joined {new Date(r.createdAt).toLocaleDateString("en-KE")}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busyId === r.id || !r.phone} onClick={() => void resetPin(r)}>
                    Reset PIN
                  </Button>
                  {r.status !== "APPROVED" && (
                    <Button disabled={busyId === r.id || !r.profileComplete} onClick={() => void setStatus(r, "APPROVED")}>
                      Approve
                    </Button>
                  )}
                  {r.status !== "SUSPENDED" && (
                    <Button variant="secondary" disabled={busyId === r.id} onClick={() => void setStatus(r, "SUSPENDED")}>
                      Suspend
                    </Button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
