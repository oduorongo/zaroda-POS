"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { SHAMBA_BRAND } from "../../lib/shamba";
import { Card } from "./frame";

export interface ValuationRate { birthValue: number; pricePerKg: number; primeAgeMonths: number | null; ageDropRate: number }
export interface ValuationSettings { margin: number; sellingCost: number; rates: Record<string, ValuationRate> }
export interface ValuedItem {
  id: string;
  kind: "ANIMAL" | "GROUP";
  tag: string | null;
  name: string | null;
  species: string;
  ageMonths: number | null;
  weightKg: number | null;
  heads: number;
  entry: number;
  feed: number;
  vet: number;
  cost: number;
  basis: "MARKET" | "COST";
  marketValue: number | null;
  ageAdjustment: number;
  sellingCosts: number;
  value: number;
  total: number;
  askingPrice: number;
  produce: "MILK" | "EGGS" | null;
  produceIncome: number;
  offspring: number;
  offspringValue: number;
  profit: number;
  warnings: string[];
}
export interface ValuationList { settings: ValuationSettings; asOf: string; items: ValuedItem[] }

export const kes = (n: number) => `${n < 0 ? "- " : ""}KES ${Math.abs(Math.round(n)).toLocaleString("en-KE")}`;

function Lines({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="space-y-0.5">
      {rows.map(([k, val]) => (
        <div key={k} className="flex justify-between gap-2 border-t border-secondary-100 pt-0.5">
          <dt className="text-secondary-600">{k}</dt>
          <dd className="text-right">{val}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The animal's value as an asset (IAS 41), and apart from it what it has brought in. */
export function PriceBreakdown({ v, margin, sellingCost }: { v: ValuedItem; margin: number; sellingCost: number }) {
  const each = v.kind === "GROUP" ? " a head" : "";
  const value: [string, string][] =
    v.basis === "MARKET"
      ? [[`Market value (${v.weightKg} kg at the market price)`, kes(v.marketValue ?? 0)]]
      : [
          [v.kind === "GROUP" ? "Bought / hatched, per head" : "Bought / born value", kes(v.entry)],
          ["Feed eaten", kes(v.feed)],
          ["Vet and drugs", kes(v.vet)],
        ];
  if (v.ageAdjustment) value.push([`Past prime age (${v.ageMonths} months)`, kes(v.ageAdjustment)]);
  if (v.sellingCosts) value.push([`Costs to sell (${Math.round(sellingCost * 100)}%)`, kes(v.sellingCosts)]);
  const pays: [string, string][] = [["What it cost (bought/born, feed, vet)", kes(-v.cost)]];
  if (v.produceIncome) pays.push([v.produce === "MILK" ? "Milk it gave" : "Eggs laid", kes(v.produceIncome)]);
  if (v.offspring) pays.push([`${v.offspring} young born`, kes(v.offspringValue)]);
  pays.push(["Its value today", kes(v.value)]);
  return (
    <div className="space-y-3 text-sm">
      <div>
        <p className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>
          {kes(v.value)}
          <span className="text-sm font-normal text-secondary-500">{each}</span>
        </p>
        {v.kind === "GROUP" && <p className="text-secondary-600">{kes(v.total)} for all {v.heads}</p>}
        <p className="mb-2 text-xs text-secondary-500">
          {v.basis === "MARKET" ? "Fair value: its weight at the market price, less costs to sell." : "At cost: no market price yet (it has not been weighed)."}
        </p>
        {v.warnings.map((w) => (
          <p key={w} className="mb-1 text-xs font-semibold" style={{ color: SHAMBA_BRAND.orange }}>{w}</p>
        ))}
        <Lines rows={value} />
        <p className="mt-2">
          Asking price: <strong>{kes(v.askingPrice)}</strong>
          <span className="text-xs text-secondary-500"> (market value, never below cost + {Math.round(margin * 100)}%)</span>
        </p>
      </div>
      <div>
        <p className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>Is it paying its way?</p>
        <p className="mb-1 text-xs text-secondary-500">Milk, eggs and young are income, not part of its value.</p>
        <Lines rows={pays} />
        <p className="mt-1 font-semibold">Profit so far: {kes(v.profit)}</p>
      </div>
    </div>
  );
}

/** The value card on an animal's or flock's page (managers and auditors; hidden for others). */
export function SuggestedPriceCard({ id }: { id: string }) {
  const [data, setData] = useState<ValuationList | null>(null);
  useEffect(() => {
    apiGet<ValuationList>("/farm/valuation").then(setData, () => setData(null));
  }, [id]);
  const v = data?.items.find((i) => i.id === id);
  if (!data || !v) return null;
  return (
    <Card title="Value and profit">
      <PriceBreakdown v={v} margin={data.settings.margin} sellingCost={data.settings.sellingCost} />
    </Card>
  );
}
