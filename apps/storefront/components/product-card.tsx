"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Minus, Plus } from "lucide-react";
import { formatQty, kes } from "../lib/format";
import type { ShopProduct } from "../lib/types";
import { useStore } from "./store-provider";

// Items sold by weight/volume move in half-units; counted items by one.
const stepFor = (mode: "COUNT" | "WEIGHT") => (mode === "WEIGHT" ? 0.5 : 1);

export default function ProductCard({ shopSlug, product }: { shopSlug: string; product: ShopProduct }) {
  const { cartFor, setLineQuantity } = useStore();
  const [variantId, setVariantId] = useState(product.variants[0]?.id);
  const [imageIndex, setImageIndex] = useState(0);
  const gallery = useRef<HTMLDivElement>(null);

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
      <div className="group relative aspect-square bg-secondary-500/10">
        {product.images.length > 0 ? (
          // Swipeable strip: each photo is one full-width snap point, so a finger swipe (or the arrows) moves one photo at a time.
          <div
            ref={gallery}
            onScroll={(e) => {
              const el = e.currentTarget;
              setImageIndex(Math.round(el.scrollLeft / el.clientWidth));
            }}
            className="flex h-full w-full snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {product.images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={src}
                src={src}
                alt={`${product.name} - photo ${i + 1}`}
                loading="lazy"
                draggable={false}
                className="h-full w-full shrink-0 snap-center object-cover"
              />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-secondary-400">
            <ImageOff size={32} aria-hidden />
          </div>
        )}
        {product.images.length > 1 && (
          <>
            <button
              type="button"
              onClick={() => gallery.current?.scrollBy({ left: -gallery.current.clientWidth })}
              disabled={imageIndex === 0}
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow disabled:hidden"
            >
              <ChevronLeft size={18} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => gallery.current?.scrollBy({ left: gallery.current.clientWidth })}
              disabled={imageIndex >= product.images.length - 1}
              aria-label="Next photo"
              className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow disabled:hidden"
            >
              <ChevronRight size={18} aria-hidden />
            </button>
            <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">
              {imageIndex + 1}/{product.images.length}
            </span>
            <div className="pointer-events-none absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
              {product.images.map((_, i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full shadow ${i === imageIndex ? "bg-white" : "bg-white/50"}`} />
              ))}
            </div>
          </>
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
            <span className="rounded-md bg-secondary-500/10 px-3 py-2 text-sm text-secondary-500">Sold out</span>
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
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary-500/5"
              >
                <Minus size={16} aria-hidden />
              </button>
              <span className="min-w-[2.5rem] text-center font-semibold">{formatQty(inCart)}</span>
              <button
                onClick={() => set(inCart + step)}
                disabled={atMax}
                aria-label="Add one"
                className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-secondary-500/5 disabled:opacity-40"
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
