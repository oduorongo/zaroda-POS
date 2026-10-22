"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { variantTitleOf } from "../lib/variant-label";

interface PickerProduct {
  id: string;
  name: string;
  variants: { id: string; sku: string; name: string | null; barcode: string | null; quantityMode: "COUNT" | "WEIGHT" }[];
}
interface Stock {
  variantId: string;
  quantity: number;
}

export interface PickedVariant {
  id: string;
  label: string;
  sku: string;
  quantityMode: "COUNT" | "WEIGHT";
}

/**
 * A searchable box for choosing a product option by name (or code or barcode), showing how many are in stock at the chosen
 * branch. Replaces typing an internal id. The caller still gets the option's id to send to the server.
 */
export function VariantPicker({ branchId, value, onChange }: { branchId: string; value: PickedVariant | null; onChange: (v: PickedVariant | null) => void }) {
  const [products, setProducts] = useState<PickerProduct[]>([]);
  const [stock, setStock] = useState<Map<string, number>>(new Map());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiGet<PickerProduct[]>("/products")
      .then(setProducts)
      .catch(() => setError("Could not load your products."));
  }, []);
  useEffect(() => {
    if (!branchId) return;
    apiGet<Stock[]>(`/inventory/items?branchId=${branchId}`)
      .then((items) => setStock(new Map(items.map((i) => [i.variantId, Number(i.quantity)]))))
      .catch(() => setStock(new Map()));
  }, [branchId]);
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = products.flatMap((p) =>
      p.variants.map((v) => ({ id: v.id, label: `${variantTitleOf(p.name, v)} (${v.sku})`, sku: v.sku, quantityMode: v.quantityMode, search: `${p.name} ${v.name ?? ""} ${v.sku} ${v.barcode ?? ""}`.toLowerCase() })),
    );
    return (q ? all.filter((o) => o.search.includes(q)) : all).slice(0, 50);
  }, [products, query]);

  if (value) {
    return (
      <div className="flex flex-1 items-center justify-between gap-2 rounded-md border border-border bg-background p-2 text-sm">
        <span>
          {value.label} <span className="text-xs text-secondary-500">· {stock.get(value.id) ?? 0} in stock here</span>
        </span>
        <button type="button" onClick={() => { onChange(null); setQuery(""); }} className="text-xs text-primary-600 hover:underline">
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={box} className="relative min-w-0 flex-1">
      <input
        placeholder="Search a product by name, code or barcode"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        className="w-full rounded-md border border-border bg-background p-2 text-sm"
      />
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-surface shadow-lg">
          {options.length === 0 && <li className="p-2 text-sm text-secondary-500">Nothing matches that.</li>}
          {options.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                onClick={() => {
                  onChange({ id: o.id, label: o.label, sku: o.sku, quantityMode: o.quantityMode });
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-secondary-500/10"
              >
                <span>{o.label}</span>
                <span className="shrink-0 text-xs text-secondary-500">{stock.get(o.id) ?? 0} in stock</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
