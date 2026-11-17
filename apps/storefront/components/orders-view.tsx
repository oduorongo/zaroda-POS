"use client";


import { PasswordInput } from "@zaroda/ui";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, listOrders, setBuyerPin } from "../lib/api";
import { kes } from "../lib/format";
import { guestOrderPath, guestOrders, type GuestOrderRef } from "../lib/remember";
import type { Order } from "../lib/types";
import AuthForm from "./auth-form";
import OrderStatusBadge from "./order-status";
import { useStore } from "./store-provider";

export default function OrdersView() {
  const { ready, buyer, token, signOut, setBuyer } = useStore();
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceOrders, setDeviceOrders] = useState<GuestOrderRef[]>([]);
  useEffect(() => setDeviceOrders(guestOrders()), []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    listOrders(token)
      .then((result) => !cancelled && setOrders(result))
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) signOut();
        else setError(err instanceof ApiError ? err.message : "Could not load your orders.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, signOut]);

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;

  if (!buyer) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-2xl font-bold">My orders</h1>
        {deviceOrders.length > 0 && <DeviceOrders orders={deviceOrders} />}
        <div className="max-w-md space-y-4 rounded-lg border border-border bg-surface p-6">
          <h2 className="text-lg font-semibold">{deviceOrders.length > 0 ? "Have an account? Sign in to see all your orders" : "Sign in to see your orders"}</h2>
          <AuthForm />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">My orders</h1>
        <Link href="/" className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700">
          Order something else
        </Link>
      </div>
      {token && buyer && !buyer.hasPin && <AddPin token={token} phone={buyer.phone} onDone={setBuyer} />}
      {error && <p className="text-sm text-error-600">{error}</p>}
      {!orders && !error && <p className="text-secondary-500">Loading your orders...</p>}
      {orders && orders.length === 0 && (
        <div className="rounded-md border border-border bg-surface p-6 text-center">
          <p className="text-secondary-500">You haven&apos;t ordered anything yet.</p>
          <Link href="/" className="mt-3 inline-block rounded-md bg-primary-600 px-5 py-2.5 font-semibold text-white">
            Browse shops
          </Link>
        </div>
      )}
      <ul className="space-y-3">
        {orders?.map((order) => (
          <li key={order.id}>
            <Link href={`/orders/${order.id}`} className="block rounded-lg border border-border bg-surface p-4 hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{order.shop.name}</p>
                  <p className="font-mono text-xs text-secondary-500">{order.orderNumber}</p>
                </div>
                <OrderStatusBadge order={order} />
              </div>
              <div className="mt-2 flex justify-between text-sm text-secondary-600">
                <span>
                  {order.lines.length} {order.lines.length === 1 ? "item" : "items"} - {new Date(order.createdAt).toLocaleDateString("en-KE")}
                </span>
                <span className="font-semibold text-foreground">{kes(order.amountDue)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {deviceOrders.length > 0 && <DeviceOrders orders={deviceOrders} />}
    </div>
  );
}

/** Orders placed on this phone without signing in, opened through their private links. */
function DeviceOrders({ orders }: { orders: GuestOrderRef[] }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-secondary-600">Ordered on this phone without signing in</h2>
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id}>
            <Link href={guestOrderPath(o.id, o.key)} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 hover:shadow-md">
              <span>
                <span className="block font-semibold">{o.shopName}</span>
                <span className="font-mono text-xs text-secondary-500">{o.orderNumber}</span>
              </span>
              <span className="text-sm text-secondary-600">{new Date(o.createdAt).toLocaleDateString("en-KE")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Offered to shoppers who signed in with an email or text code: add a phone number and PIN so next time is quicker. */
function AddPin({ token, phone, onDone }: { token: string; phone: string | null; onDone: (buyer: Awaited<ReturnType<typeof setBuyerPin>>) => void }) {
  const [number, setNumber] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await setBuyerPin(token, pin, phone ? undefined : number.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save your PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <p className="font-semibold">Sign in faster next time</p>
      <p className="text-sm text-secondary-500">Choose a PIN and next time you can sign in with just your phone number{phone ? ` (${phone.replace(/^254/, "0")})` : ""} and PIN - no email or code needed.</p>
      {!phone && (
        <input type="tel" inputMode="tel" required placeholder="Your phone number, e.g. 0712 345 678" value={number} onChange={(e) => setNumber(e.target.value)} className="w-full rounded-md border border-border bg-surface p-3" />
      )}
      <PasswordInput
        
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="new-password"
        maxLength={6}
        required
        placeholder="PIN: 4 to 6 numbers"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full rounded-md border border-border bg-surface p-3 text-center text-xl tracking-[0.4em]"
      />
      {error && <p className="text-sm text-error-600">{error}</p>}
      <button type="submit" disabled={busy || pin.length < 4 || (!phone && number.trim().length < 9)} className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
        {busy ? "Saving..." : "Save my PIN"}
      </button>
    </form>
  );
}
