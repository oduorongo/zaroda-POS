"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { Card, CardContent, Button, Input, Label } from "@zaroda/ui";

function formatKes(value: number) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PriceTagClient() {
  const [productName, setProductName] = useState("Product name");
  const [price, setPrice] = useState("100");
  const [barcodeValue, setBarcodeValue] = useState("");
  const [copies, setCopies] = useState("8");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hasBarcode, setHasBarcode] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !barcodeValue.trim()) {
      setHasBarcode(false);
      return;
    }
    try {
      JsBarcode(canvas, barcodeValue, { format: "CODE128", width: 1.4, height: 36, displayValue: false, margin: 0 });
      setHasBarcode(true);
    } catch {
      setHasBarcode(false);
    }
  }, [barcodeValue]);

  const priceValue = parseFloat(price) || 0;
  const tagCount = Math.min(Math.max(parseInt(copies, 10) || 1, 1), 40);

  function printTags() {
    window.print();
  }

  return (
    <main>
      <section className="mx-auto max-w-4xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground print:hidden">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground print:hidden">Price Tag Generator</h1>
        <p className="mt-2 text-secondary-500 print:hidden">
          Enter a product and price, optionally add a barcode value, and print a sheet of tags.
        </p>

        <Card className="mt-8 print:hidden">
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="productName">Product name</Label>
                <Input id="productName" value={productName} onChange={(e) => setProductName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="price">Price (KES)</Label>
                <Input id="price" type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="barcodeValue">Barcode value (optional)</Label>
                <Input id="barcodeValue" value={barcodeValue} onChange={(e) => setBarcodeValue(e.target.value)} placeholder="SKU or code" />
              </div>
              <div>
                <Label htmlFor="copies">Number of tags</Label>
                <Input id="copies" type="number" min="1" max="40" value={copies} onChange={(e) => setCopies(e.target.value)} />
              </div>
            </div>
            <Button onClick={printTags} className="mt-6 w-full" size="lg">
              Print tags
            </Button>
          </CardContent>
        </Card>

        <canvas ref={canvasRef} className="hidden" />

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4 print:grid-cols-3 print:gap-2">
          {Array.from({ length: tagCount }).map((_, i) => (
            <div key={i} className="rounded-md border border-dashed border-border bg-white p-3 text-center shadow-sm">
              <p className="truncate text-xs font-medium text-secondary-700">{productName || "Product name"}</p>
              <p className="mt-1 text-xl font-bold text-foreground">KES {formatKes(priceValue)}</p>
              {hasBarcode && (
                <div className="mt-2 flex justify-center">
                  {/* Rendered via the hidden canvas above; shown here as a scaled-down copy */}
                  <BarcodeMirror sourceRef={canvasRef} />
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function BarcodeMirror({ sourceRef }: { sourceRef: RefObject<HTMLCanvasElement> }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const canvas = sourceRef.current;
    if (!canvas) return;
    setSrc(canvas.toDataURL("image/png"));
  });

  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" className="h-8 w-full object-contain" />;
}
