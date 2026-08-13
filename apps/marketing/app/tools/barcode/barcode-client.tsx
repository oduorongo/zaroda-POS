"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { Card, CardContent, Button, Input, Label } from "@zaroda/ui";

type Format = "CODE128" | "EAN13";

const FORMATS: { value: Format; label: string }[] = [
  { value: "CODE128", label: "CODE128 (any text)" },
  { value: "EAN13", label: "EAN-13 (12-13 digits)" },
];

function defaultValueFor(format: Format) {
  return format === "EAN13" ? "590123412345" : "ZARODA-0001";
}

export default function BarcodeClient() {
  const [format, setFormat] = useState<Format>("CODE128");
  const [value, setValue] = useState(defaultValueFor("CODE128"));
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    try {
      JsBarcode(canvas, value, {
        format,
        width: 2,
        height: 90,
        displayValue: true,
        margin: 12,
      });
      setError(null);
    } catch {
      setError(
        format === "EAN13"
          ? "EAN-13 needs 12 or 13 digits."
          : "Couldn't render that value as a barcode."
      );
    }
  }, [format, value]);

  function handleFormatChange(next: Format) {
    setFormat(next);
    setValue(defaultValueFor(next));
  }

  function downloadPng() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `barcode-${value}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  }

  return (
    <main>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Barcode Generator</h1>
        <p className="mt-2 text-secondary-500">Create a CODE128 or EAN-13 barcode and download it as a PNG.</p>

        <Card className="mt-8">
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="format">Format</Label>
                <select
                  id="format"
                  value={format}
                  onChange={(e) => handleFormatChange(e.target.value as Format)}
                  className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground"
                >
                  {FORMATS.map((f) => (
                    <option key={f.value} value={f.value}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="value">Value</Label>
                <Input
                  id="value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={defaultValueFor(format)}
                  inputMode={format === "EAN13" ? "numeric" : "text"}
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-error-600">{error}</p>}

            <div className="mt-6 flex flex-col items-center gap-4 rounded-lg border border-border bg-surface p-6">
              <canvas ref={canvasRef} className="max-w-full" />
            </div>

            <Button onClick={downloadPng} disabled={!!error || !value} className="mt-6 w-full" size="lg">
              Download PNG
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
