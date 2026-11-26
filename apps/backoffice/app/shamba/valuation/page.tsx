"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { PriceBreakdown, kes, type ValuationList, type ValuationRate, type ValuationSettings } from "../../../components/shamba/valuation";
import { SHAMBA_BRAND, SHAMBA_INK, SPECIES, inputClass } from "../../../lib/shamba";
import { downloadPdf, fromReport, printPdf, type ReportLike } from "../../../lib/pdf";

const RATE_SPECIES = ["CATTLE", "GOAT", "SHEEP", "PIG", "CHICKEN", "DUCK", "TURKEY", "RABBIT", "FISH"];

function Rates({ settings, onSaved }: { settings: ValuationSettings; onSaved: () => void }) {
  const [margin, setMargin] = useState(String(Math.round(settings.margin * 100)));
  const [selling, setSelling] = useState(String(Math.round(settings.sellingCost * 100)));
  const [rates, setRates] = useState<Record<string, ValuationRate>>(settings.rates);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (sp: string, k: keyof ValuationRate, v: string) =>
    setRates({ ...rates, [sp]: { ...rates[sp], [k]: k === "primeAgeMonths" ? (v === "" ? null : Math.max(1, Math.floor(Number(v)))) : k === "ageDropRate" ? Number(v) / 100 : Number(v) } });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiPut("/farm/valuation/settings", {
        margin: Number(margin) / 100,
        sellingCost: Number(selling) / 100,
        rates: RATE_SPECIES.map((species) => ({ species, ...rates[species] })),
      });
      // the livestock value in the books follows at once (owners and managers; otherwise the next pass, within 5 minutes)
      await apiPost("/accounting/post-now", {}).catch(() => {});
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errText(err, "Could not save the rates"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Your prices and rates">
      <form onSubmit={save} className="space-y-3 text-sm">
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <label>
            Margin on cost (%)
            <input type="number" min={0} max={500} className={inputClass} value={margin} onChange={(e) => setMargin(e.target.value)} />
          </label>
          <label>
            Costs to sell (transport, commission, %)
            <input type="number" min={0} max={50} className={inputClass} value={selling} onChange={(e) => setSelling(e.target.value)} />
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem]">
            <thead>
              <tr className="text-left text-xs text-secondary-500">
                <th className="py-1">Animal</th>
                <th>Born value (KES)</th>
                <th>Market price / kg live (KES)</th>
                <th>Prime age (months)</th>
                <th>Drop a year past it (%)</th>
              </tr>
            </thead>
            <tbody>
              {RATE_SPECIES.map((sp) => (
                <tr key={sp} className="border-t border-border">
                  <td className="py-1 pr-2 font-medium">{SPECIES[sp] ?? sp}</td>
                  <td className="pr-2"><input type="number" min={0} className={inputClass} value={rates[sp].birthValue} onChange={(e) => set(sp, "birthValue", e.target.value)} /></td>
                  <td className="pr-2"><input type="number" min={0} className={inputClass} value={rates[sp].pricePerKg} onChange={(e) => set(sp, "pricePerKg", e.target.value)} /></td>
                  <td className="pr-2"><input type="number" min={1} placeholder="never" className={inputClass} value={rates[sp].primeAgeMonths ?? ""} onChange={(e) => set(sp, "primeAgeMonths", e.target.value)} /></td>
                  <td><input type="number" min={0} max={100} className={inputClass} value={Math.round(rates[sp].ageDropRate * 100)} onChange={(e) => set(sp, "ageDropRate", e.target.value)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-secondary-500">These start as rough Kenyan figures. Set the market price per kg to what similar animals sell for in your area. The margin only sets the asking price; it is not part of the value in the books.</p>
        <ErrorBox error={error} />
        {saved && <p className="text-sm font-semibold" style={{ color: SHAMBA_INK }}>Saved. Values and the books (Livestock) are updated.</p>}
        <Btn busy={busy}>Save rates</Btn>
      </form>
    </Card>
  );
}

function ValuationPage({ manager }: { manager: boolean }) {
  const [data, setData] = useState<ValuationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => apiGet<ValuationList>("/farm/valuation").then(setData).catch((err) => setError(errText(err, "Could not load the valuation")));
  useEffect(() => {
    void load();
  }, []);

  async function pdf(print: boolean) {
    try {
      const report = await apiGet<ReportLike>("/farm/reports/valuation");
      if (print) await printPdf(fromReport(report));
      else await downloadPdf(fromReport(report), `animal-valuation-${data?.asOf ?? ""}`);
    } catch (err) {
      setError(errText(err, "Could not make the PDF"));
    }
  }

  const total = data?.items.reduce((s, v) => s + v.total, 0) ?? 0;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Valuation</h1>
        <p className="text-sm text-secondary-600">
          What each animal and flock is worth as an asset (IAS 41): a weighed animal at its weight x the market price less costs to sell; one not yet weighed at what it cost
          (bought or born value, feed, vet). Past its prime the value drops. Milk, eggs and young are income, shown apart under &quot;Is it paying its way?&quot;. The total is carried in
          the farm&apos;s books as Livestock.
        </p>
      </div>
      <ErrorBox error={error} />
      {data && (
        <Card
          title={`All livestock: ${kes(total)}`}
          action={
            <span className="flex gap-3 text-sm">
              <button type="button" className="underline" onClick={() => void pdf(false)}>Download PDF</button>
              <button type="button" className="underline" onClick={() => void pdf(true)}>Print</button>
            </span>
          }
        >
          {data.items.length === 0 ? (
            <p className="text-sm text-secondary-500">No animals or flocks yet. <Link href="/shamba/animals" className="underline">Add them</Link>.</p>
          ) : (
            <ul className="divide-y divide-border">
              {data.items.map((v) => (
                <li key={v.id} className="py-2">
                  <button type="button" className="flex w-full items-center justify-between gap-2 text-left" onClick={() => setOpen(open === v.id ? null : v.id)}>
                    <span>
                      <span className="font-semibold">{v.kind === "GROUP" ? v.name : [v.tag, v.name].filter(Boolean).join(" · ")}</span>
                      <span className="block text-xs text-secondary-500">
                        {[SPECIES[v.species] ?? v.species, v.kind === "GROUP" ? `${v.heads} head` : null, v.ageMonths != null ? `${v.ageMonths} months` : null, v.weightKg != null ? `${v.weightKg} kg` : null].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="font-bold" style={{ color: SHAMBA_INK }}>{kes(v.value)}</span>
                      {v.warnings.length > 0 && <span className="block text-xs" style={{ color: SHAMBA_BRAND.orange }}>{v.warnings[0].split(":")[0]}</span>}
                      {v.kind === "GROUP" && <span className="block text-xs text-secondary-500">each · {kes(v.total)} all</span>}
                    </span>
                  </button>
                  {open === v.id && (
                    <div className="mt-2 rounded-lg bg-background p-3">
                      <PriceBreakdown v={v} margin={data.settings.margin} sellingCost={data.settings.sellingCost} />
                      <Link href={v.kind === "GROUP" ? `/shamba/groups/${v.id}` : `/shamba/animals/${v.id}`} className="mt-2 inline-block text-sm underline">
                        Open {v.kind === "GROUP" ? "flock" : "animal"}
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {data && manager && <Rates key={JSON.stringify(data.settings)} settings={data.settings} onSaved={() => void load()} />}
    </div>
  );
}

export default function Page() {
  return <ShambaAppFrame>{(session) => <ValuationPage manager={session.role === "OWNER" || session.role === "MANAGER"} />}</ShambaAppFrame>;
}
