"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../lib/api";
import { Badge, Button } from "@zaroda/ui";

type VehicleType = "BODA" | "TUK_TUK" | "VEHICLE";
type JobStatus = "OPEN" | "ASSIGNED" | "PICKED_UP" | "DELIVERED" | "CANCELLED" | "EXPIRED";
type Audience = "SHOP_RIDERS" | "EVERYONE" | "ONE_RIDER";

interface Quote {
  id: string;
  riderId: string;
  name: string | null;
  vehicleType: VehicleType | null;
  plateNumber: string | null;
  fee: number;
  etaMinutes: number | null;
  note: string | null;
  status: string;
}

interface Job {
  id: string;
  status: JobStatus;
  audience: Audience;
  quoteDeadline: string;
  agreedFee: number | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cashCollected: number | null;
  cancelReason: string | null;
  codeLocked: boolean;
  rider: { riderId: string; name: string | null; vehicleType: VehicleType | null; plateNumber: string | null; phone: string | null } | null;
  quotes: Quote[];
}

interface OwnRider {
  id: string;
  fullName: string | null;
  vehicleType: VehicleType | null;
  status: string;
}

const VEHICLE: Record<VehicleType, string> = { BODA: "Boda boda", TUK_TUK: "Tuk tuk", VEHICLE: "Vehicle" };
const POLL_MS = 20_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;

/**
 * The delivery side of one accepted delivery order: ask for a rider (your own riders, everyone, or one
 * rider), watch the quotes come in, see who the customer chose, and follow the delivery. The customer
 * picks the rider and pays them cash at the door; the rider confirms with a code only the customer has.
 */
export function DeliveryBox({ orderId, canManage }: { orderId: string; canManage: boolean }) {
  const [job, setJob] = useState<Job | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [audience, setAudience] = useState<Audience>("EVERYONE");
  const [ownRiders, setOwnRiders] = useState<OwnRider[]>([]);
  const [riderId, setRiderId] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setJob(await apiGet<Job | null>(`/online-orders/${orderId}/delivery`));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load the delivery.");
    } finally {
      setLoaded(true);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const finished = job?.status === "DELIVERED";
  useEffect(() => {
    if (finished) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [finished, load]);

  async function startAsking() {
    setAsking(true);
    if (canManage) {
      try {
        const riders = await apiGet<OwnRider[]>("/riders");
        const active = riders.filter((r) => r.status === "APPROVED");
        setOwnRiders(active);
        setRiderId(active[0]?.id ?? "");
        if (active.length > 0) setAudience("SHOP_RIDERS");
      } catch {
        setOwnRiders([]);
      }
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setJob(await apiPost<Job>(`/online-orders/${orderId}/delivery`, { audience, riderId: audience === "ONE_RIDER" ? riderId : undefined }));
      setAsking(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not ask for a rider.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    const reason = prompt("Cancel this rider request? You can ask again afterwards.\n\nReason (optional):");
    if (reason === null) return;
    setBusy(true);
    setError(null);
    try {
      setJob(await apiPost<Job>(`/online-orders/${orderId}/delivery/cancel`, { reason: reason.trim() || undefined }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not cancel the request.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  const live = job && (job.status === "OPEN" || job.status === "ASSIGNED" || job.status === "PICKED_UP");
  const select = "rounded-md border border-border bg-surface p-2 text-sm";

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-secondary-50/40 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold">Delivery rider</span>
        {job && <Badge variant={job.status === "DELIVERED" ? "success" : job.status === "CANCELLED" || job.status === "EXPIRED" ? "neutral" : "primary"}>{STATUS_LABEL[job.status]}</Badge>}
      </div>
      {error && <p className="text-error-600">{error}</p>}

      {job?.status === "OPEN" && (
        <>
          <p className="text-secondary-600">
            {job.quotes.length === 0 ? "Waiting for riders to quote" : `${job.quotes.length} ${job.quotes.length === 1 ? "price" : "prices"} offered`} until {time(job.quoteDeadline)}. The customer chooses the rider and pays them cash on delivery.
          </p>
          <ul className="space-y-1">
            {job.quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap justify-between gap-2 rounded border border-border bg-surface px-2 py-1">
                <span>
                  {q.name ?? "Rider"} · {q.vehicleType ? VEHICLE[q.vehicleType] : "Vehicle"}
                  {q.etaMinutes ? ` · ~${q.etaMinutes} min` : ""}
                </span>
                <span className="font-mono">{kes(q.fee)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {job && (job.status === "ASSIGNED" || job.status === "PICKED_UP" || job.status === "DELIVERED") && job.rider && (
        <p>
          {job.rider.name ?? "Rider"} · {job.rider.vehicleType ? VEHICLE[job.rider.vehicleType] : "Vehicle"}
          {job.rider.plateNumber ? ` · ${job.rider.plateNumber}` : ""}
          {job.rider.phone && (
            <>
              {" · "}
              <a href={`tel:+${job.rider.phone}`} className="text-primary-600 hover:underline">
                +{job.rider.phone}
              </a>
            </>
          )}
          {job.agreedFee !== null && <span className="text-secondary-600"> · agreed {kes(job.agreedFee)} (cash from the customer)</span>}
        </p>
      )}
      {job?.status === "ASSIGNED" && <p className="text-secondary-600">The rider is on the way to collect the goods from you.</p>}
      {job?.status === "PICKED_UP" && <p className="text-secondary-600">Out for delivery. The rider confirms with the customer&apos;s 4-digit code.</p>}
      {job?.status === "PICKED_UP" && job.codeLocked && (
        <p className="rounded bg-warning-50 p-2 text-warning-700">The rider entered the wrong code too many times. Once you have confirmed with the customer, press &ldquo;Mark delivered&rdquo; above.</p>
      )}
      {job?.status === "DELIVERED" && (
        <p className="text-success-700">
          Delivered{job.deliveredAt ? ` at ${time(job.deliveredAt)}` : ""}.{job.cashCollected !== null ? ` The rider reports collecting ${kes(job.cashCollected)} in cash.` : ""}
        </p>
      )}
      {job && (job.status === "EXPIRED" || job.status === "CANCELLED") && (
        <p className="text-secondary-600">{job.status === "EXPIRED" ? "Nobody was chosen in time." : `Cancelled${job.cancelReason ? `: ${job.cancelReason}` : "."}`} You can ask again.</p>
      )}

      {canManage || !live ? (
        <div className="flex flex-wrap gap-2">
          {!live && !finished && !asking && (
            <Button size="sm" onClick={() => void startAsking()}>
              Find a rider
            </Button>
          )}
          {(job?.status === "OPEN" || job?.status === "ASSIGNED") && (
            <Button size="sm" variant="outline" onClick={() => void cancel()} disabled={busy}>
              Cancel rider request
            </Button>
          )}
        </div>
      ) : null}

      {asking && (
        <form onSubmit={submit} className="space-y-2 rounded border border-border bg-surface p-3">
          <p className="font-medium">Who can quote for this delivery?</p>
          <label className="flex items-start gap-2">
            <input type="radio" name={`aud-${orderId}`} checked={audience === "SHOP_RIDERS"} onChange={() => setAudience("SHOP_RIDERS")} disabled={ownRiders.length === 0} className="mt-1" />
            <span>
              My own riders only {ownRiders.length === 0 && <span className="text-secondary-500">(you have none yet - add them under My riders)</span>}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name={`aud-${orderId}`} checked={audience === "EVERYONE"} onChange={() => setAudience("EVERYONE")} className="mt-1" />
            <span>Anyone - my riders and approved riders from the Zaroda pool</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name={`aud-${orderId}`} checked={audience === "ONE_RIDER"} onChange={() => setAudience("ONE_RIDER")} disabled={ownRiders.length === 0} className="mt-1" />
            <span>
              One of my riders:{" "}
              <select value={riderId} onChange={(e) => setRiderId(e.target.value)} disabled={audience !== "ONE_RIDER"} className={select}>
                {ownRiders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.fullName ?? "Rider"}
                    {r.vehicleType ? ` (${VEHICLE[r.vehicleType]})` : ""}
                  </option>
                ))}
              </select>
            </span>
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={busy || (audience === "ONE_RIDER" && !riderId)}>
              {busy ? "Asking..." : "Ask for quotes"}
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setAsking(false)}>
              Never mind
            </Button>
          </div>
          <p className="text-xs text-secondary-500">Riders have 30 minutes to quote. The customer then picks one and pays the rider cash when the goods arrive.</p>
        </form>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<JobStatus, string> = {
  OPEN: "Waiting for quotes",
  ASSIGNED: "Rider chosen",
  PICKED_UP: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  EXPIRED: "Expired",
};
