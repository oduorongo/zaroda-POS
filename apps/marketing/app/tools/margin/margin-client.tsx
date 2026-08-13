"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, Input, Label } from "@zaroda/ui";

function formatKes(value: number) {
  if (!Number.isFinite(value)) return "KES 0.00";
  return `KES ${value.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function MarginClient() {
  const [mode, setMode] = useState<"forward" | "reverse">("forward");

  const [cost, setCost] = useState("100");
  const [sellingPrice, setSellingPrice] = useState("150");

  const [reverseCost, setReverseCost] = useState("100");
  const [desiredMargin, setDesiredMargin] = useState("30");

  const forward = useMemo(() => {
    const c = parseFloat(cost);
    const s = parseFloat(sellingPrice);
    if (!Number.isFinite(c) || !Number.isFinite(s) || c < 0 || s < 0) return null;
    const profit = s - c;
    const marginPct = s === 0 ? 0 : (profit / s) * 100;
    const markupPct = c === 0 ? 0 : (profit / c) * 100;
    return { profit, marginPct, markupPct };
  }, [cost, sellingPrice]);

  const reverse = useMemo(() => {
    const c = parseFloat(reverseCost);
    const m = parseFloat(desiredMargin);
    if (!Number.isFinite(c) || !Number.isFinite(m) || c < 0 || m >= 100 || m < 0) return null;
    const price = c / (1 - m / 100);
    const profit = price - c;
    const markupPct = c === 0 ? 0 : (profit / c) * 100;
    return { price, profit, markupPct };
  }, [reverseCost, desiredMargin]);

  return (
    <main>
      <section className="mx-auto max-w-2xl px-6 py-16">
        <Link href="/tools" className="text-sm text-secondary-500 hover:text-foreground">
          ← All tools
        </Link>
        <h1 className="mt-3 text-3xl font-bold text-foreground">Profit Margin Calculator</h1>
        <p className="mt-2 text-secondary-500">Work out margin and markup in KES, or find the selling price for a target margin.</p>

        <div className="mt-6 inline-flex rounded-md border border-border p-1">
          {(["forward", "reverse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`rounded px-4 py-1.5 text-sm font-medium ${
                mode === m ? "bg-primary-600 text-white" : "text-secondary-600 hover:text-foreground"
              }`}
            >
              {m === "forward" ? "Cost → Margin" : "Margin → Price"}
            </button>
          ))}
        </div>

        {mode === "forward" ? (
          <Card className="mt-6">
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="cost">Cost price (KES)</Label>
                  <Input id="cost" type="number" min="0" value={cost} onChange={(e) => setCost(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="sellingPrice">Selling price (KES)</Label>
                  <Input id="sellingPrice" type="number" min="0" value={sellingPrice} onChange={(e) => setSellingPrice(e.target.value)} />
                </div>
              </div>

              {forward ? (
                <div className="mt-6 grid grid-cols-3 gap-4 rounded-lg border border-border bg-surface p-4 text-center">
                  <div>
                    <div className="text-xs text-secondary-400">Profit</div>
                    <div className="mt-1 font-semibold text-foreground">{formatKes(forward.profit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Margin</div>
                    <div className="mt-1 font-semibold text-foreground">{forward.marginPct.toFixed(1)}%</div>
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Markup</div>
                    <div className="mt-1 font-semibold text-foreground">{forward.markupPct.toFixed(1)}%</div>
                  </div>
                </div>
              ) : (
                <p className="mt-6 text-sm text-error-600">Enter valid, non-negative numbers.</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="mt-6">
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label htmlFor="reverseCost">Cost price (KES)</Label>
                  <Input id="reverseCost" type="number" min="0" value={reverseCost} onChange={(e) => setReverseCost(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="desiredMargin">Desired margin (%)</Label>
                  <Input id="desiredMargin" type="number" min="0" max="99" value={desiredMargin} onChange={(e) => setDesiredMargin(e.target.value)} />
                </div>
              </div>

              {reverse ? (
                <div className="mt-6 grid grid-cols-3 gap-4 rounded-lg border border-border bg-surface p-4 text-center">
                  <div>
                    <div className="text-xs text-secondary-400">Selling price</div>
                    <div className="mt-1 font-semibold text-foreground">{formatKes(reverse.price)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Profit</div>
                    <div className="mt-1 font-semibold text-foreground">{formatKes(reverse.profit)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-secondary-400">Markup</div>
                    <div className="mt-1 font-semibold text-foreground">{reverse.markupPct.toFixed(1)}%</div>
                  </div>
                </div>
              ) : (
                <p className="mt-6 text-sm text-error-600">Margin must be between 0 and 99, cost must be non-negative.</p>
              )}
            </CardContent>
          </Card>
        )}
      </section>
    </main>
  );
}
