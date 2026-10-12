"use client";

import { useCallback, useEffect, useState } from "react";
import { Bike, Phone } from "lucide-react";
import { acceptDeliveryQuote, ApiError, getOrderDelivery } from "../lib/api";
import { displayPhone, kes } from "../lib/format";
import type { BuyerDelivery, VehicleType } from "../lib/types";

export const VEHICLE_LABEL: Record<VehicleType, string> = { BODA: "Boda boda", TUK_TUK: "Tuk tuk", VEHICLE: "Vehicle" };

const POLL_MS = 15_000;
const FINAL: BuyerDelivery["status"][] = ["DELIVERED", "CANCELLED"];

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });

/**
 * The delivery part of a shopper's order: the prices riders have offered (pick one), then the rider's
 * details, the cash to pay at the door, and the 4-digit code to give the rider when the goods arrive.
 */
export default function DeliveryPanel({ token, orderId, onUnauthorized }: { token: string; orderId: string; onUnauthorized: () => void }) {
  const [delivery, setDelivery] = useState<BuyerDelivery | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDelivery(await getOrderDelivery(token, orderId));
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof ApiError ? err.message : "Could not load the delivery.");
    } finally {
      setLoaded(true);
    }
  }, [token, orderId, onUnauthorized]);

  useEffect(() => {
    void load();
  }, [load]);

  // Quotes arrive while the page is open, so keep it fresh until the delivery is over.
  useEffect(() => {
    if (delivery && FINAL.includes(delivery.status)) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [delivery, load]);

  async function choose(quoteId: string) {
    setChoosing(quoteId);
    setError(null);
    try {
      setDelivery(await acceptDeliveryQuote(token, orderId, quoteId));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof ApiError ? err.message : "Could not choose that rider.");
      void load();
    } finally {
      setChoosing(null);
    }
  }

  if (!loaded) return null;

  const box = "space-y-3 rounded-lg border border-border bg-surface p-4 text-sm";

  if (!delivery) {
    return (
      <section className={box}>
        <h2 className="flex items-center gap-2 font-semibold">
          <Bike size={16} aria-hidden /> Delivery
        </h2>
        <p className="text-secondary-600">The shop is arranging a rider. When riders offer a price for bringing your order, you&apos;ll choose one here.</p>
        {error && <p className="text-error-600">{error}</p>}
      </section>
    );
  }

  return (
    <section className={box} aria-live="polite">
      <h2 className="flex items-center gap-2 font-semibold">
        <Bike size={16} aria-hidden /> Delivery
      </h2>
      {error && <p className="text-error-600">{error}</p>}

      {delivery.status === "OPEN" && (
        <>
          <p className="text-secondary-600">
            {delivery.quotes.length === 0
              ? "Riders are being asked to offer a price. This page updates by itself."
              : `Choose a rider before ${time(delivery.quoteDeadline)}. You pay the rider in cash when your goods arrive.`}
          </p>
          <ul className="space-y-2">
            {delivery.quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
                <div>
                  <p className="font-semibold">
                    {kes(q.fee)} <span className="font-normal text-secondary-600">· {q.name ?? "Rider"}</span>
                  </p>
                  <p className="text-xs text-secondary-500">
                    {q.vehicleType ? VEHICLE_LABEL[q.vehicleType] : "Vehicle"}
                    {q.plateNumber ? ` · ${q.plateNumber}` : ""}
                    {q.etaMinutes ? ` · about ${q.etaMinutes} min` : ""}
                  </p>
                  {q.note && <p className="mt-1 text-xs text-secondary-600">&ldquo;{q.note}&rdquo;</p>}
                </div>
                <button
                  onClick={() => void choose(q.id)}
                  disabled={choosing !== null}
                  className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {choosing === q.id ? "Choosing..." : "Choose this rider"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {(delivery.status === "EXPIRED" || delivery.status === "CANCELLED") && (
        <p className="text-secondary-600">
          {delivery.status === "EXPIRED" ? "No rider was chosen in time." : "The delivery request was cancelled."} The shop will arrange another rider - this page will show new prices when they arrive.
        </p>
      )}

      {(delivery.status === "ASSIGNED" || delivery.status === "PICKED_UP") && delivery.rider && (
        <>
          <p className="font-medium">{delivery.status === "ASSIGNED" ? "Your rider is collecting your order from the shop." : "Your order is on its way."}</p>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-secondary-500/5 p-3 text-foreground">
            <div>
              <p className="font-semibold">{delivery.rider.name ?? "Your rider"}</p>
              <p className="text-xs text-secondary-600">
                {delivery.rider.vehicleType ? VEHICLE_LABEL[delivery.rider.vehicleType] : "Vehicle"}
                {delivery.rider.plateNumber ? ` · ${delivery.rider.plateNumber}` : ""}
              </p>
            </div>
            {delivery.rider.phone && (
              <a href={`tel:+${delivery.rider.phone}`} className="inline-flex items-center gap-1 rounded-md border border-border px-3 py-2 font-medium hover:bg-secondary-500/10">
                <Phone size={14} aria-hidden /> {displayPhone(delivery.rider.phone)}
              </a>
            )}
          </div>
          {delivery.agreedFee !== null && (
            <p>
              Pay the rider <strong>{kes(delivery.agreedFee)}</strong> in cash when your goods arrive.
            </p>
          )}
          {delivery.deliveryCode && (
            <div className="rounded-md border-2 border-dashed border-primary-500 p-3 text-center text-foreground">
              <p className="text-xs text-secondary-600">Your delivery code</p>
              <p className="font-mono text-3xl font-bold tracking-[0.4em]">{delivery.deliveryCode}</p>
              <p className="mt-1 text-xs text-secondary-600">Give this code to the rider only AFTER you have received your goods. It confirms the delivery.</p>
            </div>
          )}
        </>
      )}

      {delivery.status === "DELIVERED" && <p className="font-medium text-success-700">Delivered. Thank you for shopping with us!</p>}
    </section>
  );
}
