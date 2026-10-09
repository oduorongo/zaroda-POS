"use client";

import { useState } from "react";
import { ImageOff, Minus, Plus } from "lucide-react";
import { formatQty, kes } from "../lib/format";
import type { ShopProduct } from "../lib/types";
import { useStore } from "./store-provider";

// Items sold by weight/volume move in half-units; counted items by one.
const stepFor = (mode: "COUNT" | "WEIGHT") => (mode === "WEIGHT" ? 0.5 : 1);

export default function ProductCard({ shopSlug, product }: { shopSlug: string; product: ShopProduct }) {
  const { cartFor, setLineQuantity } = useStore();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [imageIndex, setImageIndex] = useState(0);

  const variant = product.variants.find((v) => v.id === variantId) ?? product.variants[0];
  if (!variant) return null;

  const inCart = cartFor(shopSlug).find((l) => l.variantId === variant.id)?.quantity ?? 0;
  const step = stepFor(variant.quantityMode);
  const soldOut = variant.available <= 0;
  const atMax = inCart + step > variant.available;

  const set = (quantity: number) =>
    setLineQuantity(
      shopSlug,
      { variantId: variant.id, productName: product.name, sku: variant.sku, price: variant.price, quantityMode: variant.quantityMode },
      Math.max(0, Math.round(quantity * 1000) / 1000),
    );

  return (
    <article className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface">
      <div className="relative aspect-square bg-secondary-100">
        {product.images.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.images[imageIndex]} alt={product.name} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-secondary-400">
            <ImageOff size={32} aria-hidden />
          </div>
        )}
        {product.images.length > 1 && (
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {product.images.map((_, i) => (
              <button
                key={i}
                onClick={() => setImageIndex(i)}
                aria-label={`Photo ${i + 1}`}
                className={`h-2 w-2 rounded-full ${i === imageIndex ? "bg-white" : "bg-white/50"} shadow`}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <h3 className="font-semibold leading-snug">{product.name}</h3>
          {product.category && <p className="text-xs text-secondary-500">{product.category.name}</p>}
        </div>
        {product.description && <p className="line-clamp-3 text-sm text-secondary-600">{product.description}</p>}

        {product.variants.length > 1 && (
          <select
            value={variant.id}
            onChange={(e) => setVariantId(e.target.value)}
            aria-label={`Option for ${product.name}`}
            className="rounded-md border border-border bg-surface p-2 text-sm"
          >
            {product.variants.map((v) => (
              <option key={v.id} value={v.id}>
                {v.sku} - {kes(v.price)}
              </option>
            ))}
          </select>
        )}

        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div>
            <p className="text-lg font-bold">{kes(variant.price)}</p>
            {variant.quantityMode === "WEIGHT" && <p className="text-xs text-secondary-500">per unit (kg / litre)</p>}
            {!soldOut && variant.available <= 5 && (
              <p className="text-xs text-warning-700">Only {formatQty(variant.available)} left</p>
            )}
          </div>

          {soldOut ? (
            <span className="rounded-md bg-secondary-100 px-3 py-2 text-sm text-secondary-500">Sold out</span>
          ) : inCart === 0 ? (
            <button
              onClick={() => set(step)}
              className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              Add
            </button>
          ) : (
            <div className="flex items-center gap-1" role="group" aria-label={`Quantity of ${product.name}`}>
              <button
                onClick={() => set(inCart - step)}
                aria-label="Remove one"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary-50"
              >
                <Minus size={16} aria-hidden />
              </button>
              <span className="min-w-[2.5rem] text-center font-semibold">{formatQty(inCart)}</span>
              <button
                onClick={() => set(inCart + step)}
                disabled={atMax}
                aria-label="Add one"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary-50 disabled:opacity-40"
              >
                <Plus size={16} aria-hidden />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
