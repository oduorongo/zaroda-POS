"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clearSession, db, getActiveSession, getDeviceConfig, type CachedVariant, type CashierSession, type DeviceConfig } from "../../lib/db";
import { useSyncEngine } from "../../hooks/use-sync-engine";

interface CartEntry {
  variant: CachedVariant;
  quantity: number;
}

export default function PosPage() {
  const router = useRouter();
  const [device, setDevice] = useState<DeviceConfig | null>(null);
  const [session, setSession] = useState<CashierSession | null>(null);
  const [variants, setVariants] = useState<CachedVariant[]>([]);
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<Map<string, number>>(new Map());
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [tendered, setTendered] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  const sync = useSyncEngine();

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
      setVariants(await db.variants.toArray());
    })();
  }, [router]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return variants;
    return variants.filter(
      (v) => v.productName.toLowerCase().includes(q) || v.sku.toLowerCase().includes(q) || v.barcode?.includes(q),
    );
  }, [variants, search]);

  const cartEntries: CartEntry[] = useMemo(
    () =>
      Array.from(cart.entries())
        .map(([variantId, quantity]) => {
          const variant = variants.find((v) => v.id === variantId);
          return variant ? { variant, quantity } : null;
        })
        .filter((entry): entry is CartEntry => entry !== null),
    [cart, variants],
  );

  const totals = useMemo(() => {
    let subtotal = 0;
    let tax = 0;
    for (const { variant, quantity } of cartEntries) {
      const lineSubtotal = variant.price * quantity;
      subtotal += lineSubtotal;
      tax += lineSubtotal * variant.taxRate;
    }
    return { subtotal, tax, total: subtotal + tax };
  }, [cartEntries]);

  function addToCart(variant: CachedVariant) {
    setCart((prev) => {
      const next = new Map(prev);
      next.set(variant.id, (next.get(variant.id) ?? 0) + 1);
      return next;
    });
  }

  function setQuantity(variantId: string, quantity: number) {
    setCart((prev) => {
      const next = new Map(prev);
      if (quantity <= 0) next.delete(variantId);
      else next.set(variantId, quantity);
      return next;
    });
  }

  async function completeSale() {
    if (!device || !session || cartEntries.length === 0) return;
    const amount = Number(tendered);
    if (!Number.isFinite(amount) || amount < totals.total - 0.01) return;

    await db.outbox.add({
      clientId: crypto.randomUUID(),
      branchId: device.branchId,
      terminalId: device.terminalId,
      cashierSessionId: session.cashierSessionId,
      lineItems: cartEntries.map((e) => ({ variantId: e.variant.id, quantity: e.quantity })),
      paymentAmount: totals.total,
      createdAt: new Date().toISOString(),
      status: "pending",
      lastError: null,
      serverSaleId: null,
    });

    setCart(new Map());
    setCheckoutOpen(false);
    setTendered("");
    setToast(`Sale queued - change due: ${Math.max(0, amount - totals.total).toFixed(2)}`);
    setTimeout(() => setToast(null), 4000);
    void sync.runSync();
  }

  async function switchCashier() {
    await clearSession();
    router.replace("/login");
  }

  if (!device || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-slate-900 text-slate-100">
      <header className="flex items-center justify-between border-b border-slate-800 p-3">
        <div>
          <p className="font-semibold">{session.cashierName}</p>
          <p className="text-xs text-slate-400">
            {sync.isSyncing ? "Syncing..." : sync.pendingCount > 0 ? `${sync.pendingCount} sale(s) pending sync` : "All synced"}
          </p>
        </div>
        <button onClick={switchCashier} className="rounded-md bg-slate-800 px-3 py-2 text-sm hover:bg-slate-700">
          Switch cashier
        </button>
      </header>

      {toast && <div className="bg-green-800 p-2 text-center text-sm">{toast}</div>}

      <div className="flex flex-1 overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden p-3">
          <input
            className="mb-3 rounded-md border border-slate-700 bg-slate-800 p-2.5"
            placeholder="Search product, SKU, or scan barcode..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {filtered.map((variant) => (
              <button
                key={variant.id}
                onClick={() => addToCart(variant)}
                className="flex flex-col items-start rounded-lg bg-slate-800 p-3 text-left hover:bg-slate-700"
              >
                <span className="font-medium">{variant.productName}</span>
                <span className="text-xs text-slate-400">{variant.sku}</span>
                <span className="mt-1 font-mono text-lg font-bold text-blue-400">KES {variant.price.toFixed(2)}</span>
              </button>
            ))}
            {filtered.length === 0 && <p className="col-span-full text-center text-slate-400">No matching products.</p>}
          </div>
        </div>

        <div className="flex w-80 flex-col border-l border-slate-800 p-3">
          <h2 className="font-semibold">Cart</h2>
          <div className="mt-2 flex-1 space-y-2 overflow-y-auto">
            {cartEntries.map(({ variant, quantity }) => (
              <div key={variant.id} className="rounded-md bg-slate-800 p-2">
                <p className="text-sm font-medium">{variant.productName}</p>
                <div className="mt-1 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setQuantity(variant.id, quantity - 1)} className="h-7 w-7 rounded bg-slate-700">
                      -
                    </button>
                    <span className="w-6 text-center">{quantity}</span>
                    <button onClick={() => setQuantity(variant.id, quantity + 1)} className="h-7 w-7 rounded bg-slate-700">
                      +
                    </button>
                  </div>
                  <span className="font-mono">KES {(variant.price * quantity).toFixed(2)}</span>
                </div>
              </div>
            ))}
            {cartEntries.length === 0 && <p className="text-sm text-slate-500">Cart is empty.</p>}
          </div>

          <div className="mt-3 space-y-1 border-t border-slate-700 pt-3 text-sm">
            <div className="flex justify-between text-slate-400">
              <span>Subtotal</span>
              <span>KES {totals.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>Tax</span>
              <span>KES {totals.tax.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-lg font-bold">
              <span>Total</span>
              <span>KES {totals.total.toFixed(2)}</span>
            </div>
          </div>

          <button
            onClick={() => setCheckoutOpen(true)}
            disabled={cartEntries.length === 0}
            className="mt-3 w-full rounded-md bg-blue-600 p-3 font-semibold hover:bg-blue-500 disabled:opacity-40"
          >
            Charge (Cash)
          </button>
        </div>
      </div>

      {checkoutOpen && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-xl bg-slate-800 p-6">
            <h2 className="text-xl font-bold">Cash payment</h2>
            <p className="mt-1 text-slate-400">Total due: KES {totals.total.toFixed(2)}</p>
            <input
              type="number"
              autoFocus
              className="mt-4 w-full rounded-md border border-slate-600 bg-slate-900 p-3 text-lg"
              placeholder="Amount tendered"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
            {Number(tendered) >= totals.total && (
              <p className="mt-2 text-green-400">Change due: KES {(Number(tendered) - totals.total).toFixed(2)}</p>
            )}
            <div className="mt-4 flex gap-3">
              <button onClick={() => setCheckoutOpen(false)} className="flex-1 rounded-md bg-slate-700 p-3">
                Cancel
              </button>
              <button
                onClick={completeSale}
                disabled={!Number.isFinite(Number(tendered)) || Number(tendered) < totals.total - 0.01}
                className="flex-1 rounded-md bg-blue-600 p-3 font-semibold disabled:opacity-40"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
