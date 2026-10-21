"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import JsBarcode from "jsbarcode";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { variantTitleOf } from "../../lib/variant-label";

interface Variant {
  id: string;
  sku: string;
  name?: string | null;
  barcode: string | null;
  price: string;
}
interface Product {
  id: string;
  name: string;
  variants: Variant[];
}
interface Item {
  variantId: string;
  title: string;
  sku: string;
  barcode: string | null;
  price: number;
}
interface Picked {
  item: Item;
  copies: number;
}

// Label sizes (millimetres). A roll printer prints one label per page, cut to size; a sheet printer fills A4 in a grid.
const SIZES = {
  roll: { label: "Roll label 50 x 30 mm (one per page)", w: 50, h: 30, sheet: false },
  big: { label: "Roll label 100 x 50 mm (one per page)", w: 100, h: 50, sheet: false },
  a4: { label: "A4 sheet, 3 across x 8 down (70 x 37 mm)", w: 70, h: 37, sheet: true },
} as const;
type SizeKey = keyof typeof SIZES;
const MAX_LABELS = 500;

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

/** One barcode drawn as a crisp SVG. A valid 13-digit EAN is drawn as EAN-13; anything else as Code 128. */
function BarcodeSvg({ value, height }: { value: string; height: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, { format: /^\d{13}$/.test(value) ? "EAN13" : "CODE128", displayValue: true, height, width: 1.6, margin: 0, fontSize: 11, textMargin: 1 });
    } catch {
      // EAN-13 with a wrong check digit, for example: fall back to Code 128, which takes anything
      try {
        JsBarcode(ref.current, value, { format: "CODE128", displayValue: true, height, width: 1.4, margin: 0, fontSize: 11, textMargin: 1 });
      } catch {
        /* nothing drawable */
      }
    }
  }, [value, height]);
  return <svg ref={ref} className="max-w-full" />;
}

/** Print barcode labels for products: pick them, say how many of each, and print on a label roll or an A4 sheet. */
export default function LabelsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [search, setSearch] = useState("");
  const [size, setSize] = useState<SizeKey>("a4");
  const [showPrice, setShowPrice] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setSession(s);
    void apiGet<Product[]>("/products")
      .then((products) =>
        setItems(
          products.flatMap((p) =>
            p.variants.map((v) => ({ variantId: v.id, title: variantTitleOf(p.name, v), sku: v.sku, barcode: v.barcode, price: Number(v.price) })),
          ),
        ),
      )
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load your products."));
  }, [router]);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return items.filter((i) => i.title.toLowerCase().includes(term) || i.sku.toLowerCase().includes(term) || (i.barcode ?? "").includes(term)).slice(0, 15);
  }, [items, search]);

  const total = picked.reduce((sum, p) => sum + p.copies, 0);
  const missing = picked.filter((p) => !p.item.barcode);

  function add(item: Item) {
    setPicked((prev) => (prev.some((p) => p.item.variantId === item.variantId) ? prev : [...prev, { item, copies: 1 }]));
    setSearch("");
  }

  async function makeBarcodes() {
    setBusy(true);
    setError(null);
    try {
      const made = await apiPost<{ id: string; barcode: string | null }[]>("/products/barcodes/generate", { variantIds: missing.map((m) => m.item.variantId) });
      const byId = new Map(made.map((v) => [v.id, v.barcode]));
      setPicked((prev) => prev.map((p) => ({ ...p, item: { ...p.item, barcode: byId.get(p.item.variantId) ?? p.item.barcode } })));
      setItems((prev) => prev.map((i) => ({ ...i, barcode: byId.get(i.variantId) ?? i.barcode })));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make the barcodes.");
    } finally {
      setBusy(false);
    }
  }

  const dims = SIZES[size];
  // One entry per printed label.
  const labels = picked.filter((p) => p.item.barcode).flatMap((p) => Array.from({ length: p.copies }, (_, i) => ({ key: `${p.item.variantId}-${i}`, item: p.item })));

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Only the labels print: everything else is hidden, and the page size follows the label for roll printers. */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .label-sheet, .label-sheet * { visibility: visible !important; }
          .label-sheet { position: absolute; left: 0; top: 0; width: 100%; }
          @page { size: ${dims.sheet ? "A4" : `${dims.w}mm ${dims.h}mm`}; margin: ${dims.sheet ? "8mm 0" : "0"}; }
          .label-sheet .label { break-inside: avoid; ${dims.sheet ? "" : "break-after: page;"} border: none !important; }
        }
      `}</style>
      <div className="print:hidden">
        <Nav session={session} />
        <PageHeader />
      </div>
      <main className="mx-auto max-w-4xl space-y-4 p-6">
        <div className="space-y-4 print:hidden">
          <h1 className="text-xl font-bold">Barcode labels</h1>
          <p className="text-sm text-secondary-500">Choose the products, say how many labels of each, then print. Products with no barcode yet can be given one of your own - handy for bread, repacked goods and food.</p>
          {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

          <div className="rounded-lg border border-border bg-surface p-4">
            <label className="block text-sm">
              Add a product
              <input placeholder="Search by name, code or barcode" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-sm" />
            </label>
            {search.trim() && (
              <div className="mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-background">
                {matches.length === 0 ? (
                  <p className="p-2 text-sm text-secondary-500">No matching products.</p>
                ) : (
                  matches.map((m) => (
                    <button key={m.variantId} onClick={() => add(m)} className="block w-full px-2 py-1.5 text-left text-sm hover:bg-surface">
                      {m.title} <span className="text-secondary-500">({m.sku})</span> {!m.barcode && <span className="text-xs text-amber-500">no barcode yet</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {picked.length > 0 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface p-4">
              {picked.map((p) => (
                <div key={p.item.variantId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {p.item.title} <span className="text-secondary-500">{p.item.barcode ? `· ${p.item.barcode}` : "· no barcode yet"}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <label className="text-xs text-secondary-500">Labels</label>
                    <input
                      type="number"
                      min={1}
                      max={200}
                      value={p.copies}
                      onChange={(e) => setPicked((prev) => prev.map((x) => (x.item.variantId === p.item.variantId ? { ...x, copies: Math.max(1, Math.min(200, Math.floor(Number(e.target.value) || 1))) } : x)))}
                      className="w-20 rounded-md border border-border bg-background p-1.5 text-right text-sm"
                    />
                    <button onClick={() => setPicked((prev) => prev.filter((x) => x.item.variantId !== p.item.variantId))} className="text-xs text-error-600 hover:underline">
                      Remove
                    </button>
                  </span>
                </div>
              ))}
              {missing.length > 0 && (
                <div className="rounded-md bg-amber-500/10 p-3 text-sm">
                  {missing.length} {missing.length === 1 ? "product has" : "products have"} no barcode yet, so no label can be printed for {missing.length === 1 ? "it" : "them"}.
                  <button onClick={() => void makeBarcodes()} disabled={busy} className="ml-3 rounded-md bg-primary-600 px-3 py-1.5 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy ? "Making..." : "Make barcodes for them"}
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-4 border-t border-border pt-3">
                <label className="text-sm">
                  Label size
                  <select value={size} onChange={(e) => setSize(e.target.value as SizeKey)} className="mt-1 block rounded-md border border-border bg-background p-2 text-sm">
                    {(Object.keys(SIZES) as SizeKey[]).map((k) => (
                      <option key={k} value={k}>
                        {SIZES[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} /> Show the price
                </label>
                <button
                  onClick={() => window.print()}
                  disabled={labels.length === 0 || total > MAX_LABELS}
                  className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  Print {labels.length} {labels.length === 1 ? "label" : "labels"}
                </button>
              </div>
              {total > MAX_LABELS && <p className="text-xs text-error-600">Print up to {MAX_LABELS} labels at a time.</p>}
              <p className="text-xs text-secondary-500">In the print window choose your label printer, set margins to &quot;None&quot; and scale to 100%.</p>
            </div>
          )}
          {labels.length > 0 && <h2 className="text-sm font-semibold text-secondary-600">Preview</h2>}
        </div>

        <div
          className="label-sheet"
          style={dims.sheet ? { display: "grid", gridTemplateColumns: `repeat(3, ${dims.w}mm)`, gridAutoRows: `${dims.h}mm`, justifyContent: "center" } : { display: "flex", flexWrap: "wrap", gap: "8px" }}
        >
          {labels.slice(0, MAX_LABELS).map(({ key, item }) => (
            <div
              key={key}
              className="label flex flex-col items-center justify-center overflow-hidden border border-dashed border-border bg-white p-1 text-center text-black"
              style={{ width: `${dims.w}mm`, height: `${dims.h}mm` }}
            >
              <p className="w-full truncate text-[10px] font-semibold leading-tight">{item.title}</p>
              {showPrice && <p className="text-[10px] leading-tight">{kes(item.price)}</p>}
              <BarcodeSvg value={item.barcode!} height={dims.h >= 40 ? 40 : 24} />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
