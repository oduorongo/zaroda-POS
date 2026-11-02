"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPost, ApiError } from "../../lib/api";

interface Bundle { id: string; code: string; name: string; sms: number; price: number; isActive: boolean; sortOrder: number }
interface Band { upTo: number | null; darajaCost: number; markup: number }

const input = "w-full rounded border border-border bg-background px-2 py-1 text-sm";

/** SMS bundles and the per-payout fee table for construction businesses. Placeholder figures until ZARODA sets real ones. */
export function PriceLists() {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [bands, setBands] = useState<{ upTo: string; darajaCost: string; markup: string }[]>([]);
  const [draft, setDraft] = useState({ code: "", name: "", sms: "", price: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    apiGet<{ bundles: Bundle[]; bands: Band[] }>("/platform-admin/construction/price-lists").then((r) => {
      setBundles(r.bundles);
      setBands(r.bands.map((b) => ({ upTo: b.upTo === null ? "" : String(b.upTo), darajaCost: String(b.darajaCost), markup: String(b.markup) })));
    });
  useEffect(() => {
    void load();
  }, []);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMsg(null);
    try {
      await fn();
      setMsg({ ok: true, text: done });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : "That did not work." });
    }
  };
  const saveBundle = (b: Omit<Bundle, "id">) => act(() => apiPost("/platform-admin/construction/sms-bundles", b), `${b.code} saved`);

  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="font-semibold">Price lists: SMS bundles and M-Pesa payout fees</h2>
      {msg && <p className={`rounded border px-3 py-2 text-sm ${msg.ok ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-800"}`}>{msg.text}</p>}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-semibold">SMS bundles</h3>
          <table className="mt-1 w-full text-sm">
            <thead><tr className="text-left text-secondary-600"><th>Code</th><th>Name</th><th className="text-right">Texts</th><th className="text-right">KES</th><th /></tr></thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id} className="border-t border-border">
                  <td className="py-1">{b.code}</td><td>{b.name}</td><td className="text-right">{b.sms.toLocaleString("en-KE")}</td><td className="text-right">{b.price.toLocaleString("en-KE")}</td>
                  <td className="text-right">
                    <button type="button" className="text-xs underline" onClick={() => { const p = prompt(`New price for ${b.name} (KES)`, String(b.price)); if (p) void saveBundle({ ...b, price: Number(p) }); }}>Price</button>{" "}
                    <button type="button" className="text-xs underline" onClick={() => saveBundle({ ...b, isActive: !b.isActive })}>{b.isActive ? "Switch off" : "Switch on"}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 grid grid-cols-4 gap-2">
            <input className={input} placeholder="SMS_10000" value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
            <input className={input} placeholder="10,000 texts" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className={input} placeholder="Texts" inputMode="numeric" value={draft.sms} onChange={(e) => setDraft({ ...draft, sms: e.target.value })} />
            <input className={input} placeholder="KES" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
          </div>
          <button type="button" className="mt-2 rounded bg-primary-600 px-3 py-1 text-sm text-white" onClick={() => saveBundle({ code: draft.code, name: draft.name, sms: Number(draft.sms), price: Number(draft.price), isActive: true, sortOrder: bundles.length })}>Add bundle</button>
        </div>

        <div>
          <h3 className="text-sm font-semibold">Fee per M-Pesa wage payout</h3>
          <p className="text-xs text-secondary-600">Safaricom&apos;s cost for the amount, plus ZARODA&apos;s markup. Leave &quot;up to&quot; empty on the last band (the biggest payouts).</p>
          <table className="mt-1 w-full text-sm">
            <thead><tr className="text-left text-secondary-600"><th>Up to (KES)</th><th>Safaricom cost</th><th>Markup</th><th /></tr></thead>
            <tbody>
              {bands.map((b, i) => (
                <tr key={i}>
                  {(["upTo", "darajaCost", "markup"] as const).map((k) => (
                    <td key={k} className="py-1 pr-2"><input className={input} inputMode="decimal" value={b[k]} placeholder={k === "upTo" ? "above" : ""} onChange={(e) => setBands(bands.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)))} /></td>
                  ))}
                  <td><button type="button" className="text-xs underline" onClick={() => setBands(bands.filter((_, j) => j !== i))}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="mt-2 text-xs underline" onClick={() => setBands([...bands, { upTo: "", darajaCost: "0", markup: "10" }])}>Add band</button>{" "}
          <button type="button" className="ml-2 mt-2 rounded bg-primary-600 px-3 py-1 text-sm text-white" onClick={() => act(() => apiPost("/platform-admin/construction/payout-fees", { bands: bands.map((b) => ({ upTo: b.upTo.trim() === "" ? null : Number(b.upTo), darajaCost: Number(b.darajaCost), markup: Number(b.markup) })) }), "Payout fees saved")}>Save fees</button>
        </div>
      </div>
    </section>
  );
}
