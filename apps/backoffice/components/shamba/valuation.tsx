"use client";

import { useEffect, useState } from "react";
import { apiGet } from "../../lib/api";
import { SHAMBA_BRAND } from "../../lib/shamba";
import { Card } from "./frame";

export interface ValuationRate { birthValue: number; pricePerKg: number; primeAgeMonths: number | null; ageDropRate: number }
export interface ValuationSettings { margin: number; productionDays: number; rates: Record<string, ValuationRate> }
export interface ValuedItem {
  id: string;
  kind: "ANIMAL" | "GROUP";
  tag: string | null;
  name: string | null;
  species: string;
  ageMonths: number | null;
  weightKg: number | null;
  dailyProduce: number;
  produce: "MILK" | "EGGS" | null;
  heads: number;
  entry: number;
  feed: number;
  vet: number;
  cost: number;
  costPrice: number;
  weightValue: number | null;
  productionValue: number;
  ageAdjustment: number;
  suggested: number;
  total: number;
  basis: "COST" | "WEIGHT";
  warnings: string[];
}
export interface ValuationList { settings: ValuationSettings; asOf: string; items: ValuedItem[] }

export const kes = (n: number) => `KES ${Math.round(n).toLocaleString("en-KE")}`;

/** How the suggested price was reached, line by line. */
export function PriceBreakdown({ v, margin, days }: { v: ValuedItem; margin: number; days: number }) {
  const each = v.kind === "GROUP" ? " a head" : "";
  const lines: [string, string][] = [
    [v.kind === "GROUP" ? "Bought / hatched, per head" : v.entry ? "Bought / born value" : "Born value", kes(v.entry)],
    ["Feed eaten", kes(v.feed)],
    ["Vet and drugs", kes(v.vet)],
    ["Cost to date", kes(v.cost)],
    [`Cost + ${Math.round(margin * 100)}% margin`, kes(v.costPrice)],
    ["Weight value", v.weightValue == null ? "not weighed" : `${kes(v.weightValue)} (${v.weightKg} kg)`],
  ];
  if (v.productionValue > 0) lines.push([`${days} days of ${v.produce === "MILK" ? `milk (${v.dailyProduce} L/day)` : `eggs (${v.dailyProduce}/bird/day)`}`, `+ ${kes(v.productionValue)}`]);
  if (v.ageAdjustment) lines.push([`Past prime age (${v.ageMonths} months)`, `- ${kes(-v.ageAdjustment)}`]);
  return (
    <div className="text-sm">
      <p className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>
        {kes(v.suggested)}
        <span className="text-sm font-normal text-secondary-500">{each}</span>
      </p>
      {v.kind === "GROUP" && <p className="text-secondary-600">{kes(v.total)} for all {v.heads}</p>}
      <p className="mb-2 text-xs text-secondary-500">Priced on {v.basis === "WEIGHT" ? "its weight at the market price" : "what it cost plus your margin"}.</p>
      {v.warnings.map((w) => (
        <p key={w} className="mb-1 text-xs font-semibold" style={{ color: SHAMBA_BRAND.orange }}>{w}</p>
      ))}
      <dl className="space-y-0.5">
        {lines.map(([k, val]) => (
          <div key={k} className="flex justify-between gap-2 border-t border-secondary-100 pt-0.5">
            <dt className="text-secondary-600">{k}</dt>
            <dd className="text-right">{val}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The suggested selling price card on an animal's or flock's page (managers and auditors; hidden for others). */
export function SuggestedPriceCard({ id }: { id: string }) {
  const [data, setData] = useState<ValuationList | null>(null);
  useEffect(() => {
    apiGet<ValuationList>("/farm/valuation").then(setData, () => setData(null));
  }, [id]);
  const v = data?.items.find((i) => i.id === id);
  if (!data || !v) return null;
  return (
    <Card title="Suggested selling price">
      <PriceBreakdown v={v} margin={data.settings.margin} days={data.settings.productionDays} />
    </Card>
  );
}
