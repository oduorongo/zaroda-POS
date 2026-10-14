"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getMe } from "../lib/api";
import type { Buyer } from "../lib/types";

export interface CartLine {
  variantId: string;
  productName: string;
  sku: string;
  price: number;
  quantityMode: "COUNT" | "WEIGHT";
  quantity: number;
}

type Carts = Record<string, CartLine[]>;

interface StoreContextValue {
  ready: boolean;
  buyer: Buyer | null;
  token: string | null;
  signIn: (token: string, buyer: Buyer) => void;
  signOut: () => void;
  setBuyer: (buyer: Buyer) => void;
  cartFor: (slug: string) => CartLine[];
  setLineQuantity: (slug: string, line: Omit<CartLine, "quantity">, quantity: number) => void;
  clearCart: (slug: string) => void;
}

const TOKEN_KEY = "zaroda_buyer_token";
const CARTS_KEY = "zaroda_carts";

// localStorage can throw (private windows, blocked site data) - the shop
// must still work, just without remembering anything between visits.
function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* in-memory state still works for this visit */
  }
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [buyer, setBuyerState] = useState<Buyer | null>(null);
  const [carts, setCarts] = useState<Carts>({});

  useEffect(() => {
    try {
      const saved = JSON.parse(readStorage(CARTS_KEY) ?? "{}") as Carts;
      if (saved && typeof saved === "object") setCarts(saved);
    } catch {
      /* corrupt saved cart - start empty */
    }
    const savedToken = readStorage(TOKEN_KEY);
    if (!savedToken) {
      setReady(true);
      return;
    }
    getMe(savedToken)
      .then((me) => {
        setToken(savedToken);
        setBuyerState(me);
      })
      .catch((err: { status?: number }) => {
        // Only a rejected token means signed out - a network blip shouldn't log anyone out.
        if (err?.status === 401) writeStorage(TOKEN_KEY, null);
        else setToken(savedToken);
      })
      .finally(() => setReady(true));
  }, []);

  const persistCarts = useCallback((next: Carts) => {
    setCarts(next);
    writeStorage(CARTS_KEY, JSON.stringify(next));
  }, []);

  const value = useMemo<StoreContextValue>(
    () => ({
      ready,
      buyer,
      token,
      signIn: (newToken, newBuyer) => {
        writeStorage(TOKEN_KEY, newToken);
        setToken(newToken);
        setBuyerState(newBuyer);
      },
      signOut: () => {
        writeStorage(TOKEN_KEY, null);
        setToken(null);
        setBuyerState(null);
      },
      setBuyer: setBuyerState,
      cartFor: (slug) => carts[slug] ?? [],
      setLineQuantity: (slug, line, quantity) => {
        const current = carts[slug] ?? [];
        const exists = current.some((l) => l.variantId === line.variantId);
        // Keep items in the order they were first added.
        const next = exists
          ? current.map((l) => (l.variantId === line.variantId ? { ...line, quantity } : l)).filter((l) => l.quantity > 0)
          : quantity > 0
            ? [...current, { ...line, quantity }]
            : current;
        persistCarts({ ...carts, [slug]: next });
      },
      clearCart: (slug) => {
        const rest = { ...carts };
        delete rest[slug];
        persistCarts(rest);
      },
    }),
    [ready, buyer, token, carts, persistCarts],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore must be used inside StoreProvider");
  return ctx;
}
