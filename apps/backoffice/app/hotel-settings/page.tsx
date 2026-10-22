"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";
import { field, ghostBtn, kes, primaryBtn, type RoomType } from "../front-desk/types";

const explain = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface Rules {
  cancelFreeDays: number;
  cancelKeepPercent: number;
  nightAuditHour: number;
  noShowCutoffHour: number;
  confirmationSms: boolean;
  reminderSms: boolean;
  thankYouSms: boolean;
}
interface Tax {
  name: string;
  percent: number;
  isActive: boolean;
}
interface Rates {
  roomTypeId: string;
  name: string;
  baseRate: number;
  weekendRate: number | null;
  weekendDays: number[];
  includedAdults: number;
  freeChildren: number;
  extraAdultRate: number;
  extraChildRate: number;
  seasons: { id: string; name: string; startDate: string; endDate: string; rate: number; weekendRate: number | null }[];
  meals: { plan: string; label: string; adultPrice: number; childPrice: number }[];
}

const card = "space-y-3 rounded-xl border border-border bg-surface p-4";

/** The hotel's own rules: cancellation policy, night audit hour, guest texts, room taxes and each room type's price list. */
export default function HotelSettingsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) return void router.replace("/login");
    if (!isBackofficeRole(s.role)) {
      clearSession();
      return void router.replace("/login");
    }
    if (s.industryType !== "HOTEL" && s.industryType !== "RESTAURANT") return void router.replace("/sales");
    setSession(s);
  }, [router]);

  if (!session) return null;
  const isManager = session.role === "MANAGER" || session.role === "OWNER";
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-4xl space-y-5 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">Rates &amp; rules</h1>
          <Link href="/front-desk" className={ghostBtn}>Back to the front desk</Link>
        </div>
        {!isManager && <p className="rounded-md bg-amber-950 p-3 text-sm text-amber-200">Only a manager or owner can change these. You can look.</p>}
        <RulesCard editable={isManager} />
        <TaxesCard editable={isManager} />
        <RatesCard editable={isManager} />
      </main>
    </div>
  );
}

function RulesCard({ editable }: { editable: boolean }) {
  const [r, setR] = useState<Rules | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => void apiGet<Rules>("/hotel/settings").then(setR).catch((e) => setMsg({ ok: false, text: explain(e, "Could not load.") })), []);
  if (!r) return <section className={card}>{msg ? <p className="text-sm text-red-300">{msg.text}</p> : <p className="text-sm text-secondary-500">Loading...</p>}</section>;
  const num = (k: keyof Rules, v: string) => setR({ ...r, [k]: Number(v) });
  async function save() {
    try {
      setR(await apiPut<Rules>("/hotel/settings", r));
      setMsg({ ok: true, text: "Saved." });
    } catch (e) {
      setMsg({ ok: false, text: explain(e, "Could not save.") });
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Cancellation, night audit and guest texts</h2>
      {msg && <p className={`rounded-md p-2 text-sm ${msg.ok ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300"}`}>{msg.text}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Free cancellation until this many days before arrival<input type="number" min={0} max={365} disabled={!editable} className={field} value={r.cancelFreeDays} onChange={(e) => num("cancelFreeDays", e.target.value)} /></label>
        <label className="text-sm">After that, the hotel keeps this % of what was paid<input type="number" min={0} max={100} disabled={!editable} className={field} value={r.cancelKeepPercent} onChange={(e) => num("cancelKeepPercent", e.target.value)} /></label>
        <label className="text-sm">The night audit runs by itself at this hour (0-23, Kenya time)<input type="number" min={0} max={23} disabled={!editable} className={field} value={r.nightAuditHour} onChange={(e) => num("nightAuditHour", e.target.value)} /></label>
        <label className="text-sm">An unpaid arrival is a no-show after this hour (0-23)<input type="number" min={0} max={23} disabled={!editable} className={field} value={r.noShowCutoffHour} onChange={(e) => num("noShowCutoffHour", e.target.value)} /></label>
      </div>
      <p className="text-xs text-secondary-500">With 0% kept, a cancelled booking always gets everything back (the usual before you set a policy). A guest who opted out never gets a text.</p>
      <div className="flex flex-wrap gap-4 text-sm">
        {(["confirmationSms", "reminderSms", "thankYouSms"] as const).map((k) => (
          <label key={k} className="flex items-center gap-2">
            <input type="checkbox" disabled={!editable} checked={r[k]} onChange={(e) => setR({ ...r, [k]: e.target.checked })} />
            {k === "confirmationSms" ? "Text a confirmation (and a cancellation notice)" : k === "reminderSms" ? "Remind the day before arrival" : "Thank the guest after check-out"}
          </label>
        ))}
      </div>
      {editable && <button className={primaryBtn} onClick={() => void save()}>Save</button>}
    </section>
  );
}

function TaxesCard({ editable }: { editable: boolean }) {
  const [taxes, setTaxes] = useState<Tax[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => void apiGet<Tax[]>("/hotel/taxes").then(setTaxes).catch((e) => setMsg({ ok: false, text: explain(e, "Could not load.") })), []);
  if (!taxes) return <section className={card}>{msg ? <p className="text-sm text-red-300">{msg.text}</p> : <p className="text-sm text-secondary-500">Loading...</p>}</section>;
  const total = taxes.filter((t) => t.isActive).reduce((s, t) => s + t.percent, 0);
  async function save() {
    try {
      setTaxes(await apiPut<Tax[]>("/hotel/taxes", { taxes: taxes!.filter((t) => t.name.trim()).map((t) => ({ name: t.name.trim(), percent: Number(t.percent), isActive: t.isActive })) }));
      setMsg({ ok: true, text: "Saved. New nights use these taxes." });
    } catch (e) {
      setMsg({ ok: false, text: explain(e, "Could not save.") });
    }
  }
  return (
    <section className={card}>
      <h2 className="font-semibold">Room taxes and levies</h2>
      <p className="text-sm text-secondary-500">Percentages you set (for example VAT and a tourism levy). They are added on top of the room price, shown by name on the guest&apos;s folio and flow into the sale made at check-out. With none set, the tax class on the room&apos;s product (Products screen) is used.</p>
      {msg && <p className={`rounded-md p-2 text-sm ${msg.ok ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300"}`}>{msg.text}</p>}
      {taxes.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_7rem_auto_auto] items-center gap-2">
          <input disabled={!editable} className={field} placeholder="Name (e.g. VAT)" value={t.name} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <input disabled={!editable} type="number" min={0} max={100} step="0.01" className={field} value={t.percent} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, percent: Number(e.target.value) } : x)))} />
          <label className="flex items-center gap-1 text-sm"><input type="checkbox" disabled={!editable} checked={t.isActive} onChange={(e) => setTaxes(taxes.map((x, j) => (j === i ? { ...x, isActive: e.target.checked } : x)))} />On</label>
          {editable && <button className="text-xs text-red-400" onClick={() => setTaxes(taxes.filter((_, j) => j !== i))}>Remove</button>}
        </div>
      ))}
      {taxes.length === 0 && <p className="text-sm text-secondary-500">No room taxes set.</p>}
      <p className="text-sm">All together: <strong>{Math.round(total * 100) / 100}%</strong></p>
      {editable && (
        <div className="flex gap-2">
          <button className={ghostBtn} onClick={() => setTaxes([...taxes, { name: "", percent: 0, isActive: true }])}>+ Add a tax</button>
          <button className={primaryBtn} onClick={() => void save()}>Save</button>
        </div>
      )}
    </section>
  );
}

function RatesCard({ editable }: { editable: boolean }) {
  const [types, setTypes] = useState<RoomType[]>([]);
  const [typeId, setTypeId] = useState("");
  const [rates, setRates] = useState<Rates | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [season, setSeason] = useState({ name: "", startDate: "", endDate: "", rate: "", weekendRate: "" });

  useEffect(() => {
    apiGet<RoomType[]>("/hotel/room-types")
      .then((t) => {
        const active = t.filter((x) => x.isActive);
        setTypes(active);
        if (active[0]) setTypeId(active[0].id);
      })
      .catch((e) => setMsg({ ok: false, text: explain(e, "Could not load the room types.") }));
  }, []);

  const load = useCallback(async () => {
    if (!typeId) return;
    try {
      setRates(await apiGet<Rates>(`/hotel/room-types/${typeId}/rates`));
    } catch (e) {
      setMsg({ ok: false, text: explain(e, "Could not load the prices.") });
    }
  }, [typeId]);
  useEffect(() => void load(), [load]);

  async function run(label: string, fn: () => Promise<Rates>) {
    try {
      setRates(await fn());
      setMsg({ ok: true, text: label });
    } catch (e) {
      setMsg({ ok: false, text: explain(e, "That did not work.") });
    }
  }

  if (types.length === 0) return <section className={card}><h2 className="font-semibold">Prices</h2><p className="text-sm text-secondary-500">Add a room type first (Rooms &amp; housekeeping).</p></section>;
  return (
    <section className={card}>
      <h2 className="font-semibold">Prices for each room type</h2>
      <p className="text-sm text-secondary-500">The marketplace and the front desk use this same price list. A night&apos;s price is: the season (if one covers it), else the weekend price on a weekend night, else the usual price; then extra guests and meals are added. Tax comes on top.</p>
      <label className="block text-sm">Room type
        <select className={field} value={typeId} onChange={(e) => { setTypeId(e.target.value); setRates(null); }}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name} - usual price {kes(t.pricePerNight)}</option>)}
        </select>
      </label>
      {msg && <p className={`rounded-md p-2 text-sm ${msg.ok ? "bg-green-950 text-green-300" : "bg-red-950 text-red-300"}`}>{msg.text}</p>}
      {rates && (
        <>
          <RateCardForm rates={rates} editable={editable} onSave={(body) => run("Prices saved.", () => apiPut<Rates>(`/hotel/room-types/${typeId}/rate-card`, body))} />
          <MealForm rates={rates} editable={editable} onSave={(prices) => run("Meal prices saved.", () => apiPut<Rates>(`/hotel/room-types/${typeId}/meal-prices`, { prices }))} />
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-semibold">Seasons <span className="font-normal text-secondary-500">(both dates included; where two overlap, the later start wins)</span></p>
            {rates.seasons.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><strong>{s.name}</strong> · {s.startDate} to {s.endDate} · {kes(s.rate)}{s.weekendRate !== null ? ` (weekends ${kes(s.weekendRate)})` : ""}</span>
                {editable && <button className="text-xs text-red-400" onClick={() => void run("Season removed.", () => apiDelete<Rates>(`/hotel/room-types/${typeId}/seasons/${s.id}`))}>Remove</button>}
              </div>
            ))}
            {rates.seasons.length === 0 && <p className="text-sm text-secondary-500">No seasons.</p>}
            {editable && (
              <div className="grid gap-2 sm:grid-cols-5">
                <input className={field} placeholder="Name" value={season.name} onChange={(e) => setSeason({ ...season, name: e.target.value })} />
                <input type="date" className={field} value={season.startDate} onChange={(e) => setSeason({ ...season, startDate: e.target.value })} />
                <input type="date" className={field} value={season.endDate} onChange={(e) => setSeason({ ...season, endDate: e.target.value })} />
                <input type="number" min={1} className={field} placeholder="Price a night" value={season.rate} onChange={(e) => setSeason({ ...season, rate: e.target.value })} />
                <input type="number" min={1} className={field} placeholder="Weekend (optional)" value={season.weekendRate} onChange={(e) => setSeason({ ...season, weekendRate: e.target.value })} />
                <button className={ghostBtn} disabled={!season.name || !season.startDate || !season.endDate || !season.rate} onClick={() => void run("Season added.", () => apiPost<Rates>(`/hotel/room-types/${typeId}/seasons`, { name: season.name, startDate: season.startDate, endDate: season.endDate, rate: Number(season.rate), weekendRate: season.weekendRate ? Number(season.weekendRate) : undefined }).then((r) => (setSeason({ name: "", startDate: "", endDate: "", rate: "", weekendRate: "" }), r)))}>Add the season</button>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function RateCardForm({ rates, editable, onSave }: { rates: Rates; editable: boolean; onSave: (body: unknown) => void }) {
  const [f, setF] = useState({ weekendRate: rates.weekendRate === null ? "" : String(rates.weekendRate), weekendDays: rates.weekendDays, includedAdults: String(rates.includedAdults), freeChildren: String(rates.freeChildren), extraAdultRate: String(rates.extraAdultRate), extraChildRate: String(rates.extraChildRate) });
  useEffect(() => setF({ weekendRate: rates.weekendRate === null ? "" : String(rates.weekendRate), weekendDays: rates.weekendDays, includedAdults: String(rates.includedAdults), freeChildren: String(rates.freeChildren), extraAdultRate: String(rates.extraAdultRate), extraChildRate: String(rates.extraChildRate) }), [rates]);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Weekend price and extra guests</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">Weekend price a night <span className="text-secondary-500">(empty = usual price)</span><input type="number" min={1} disabled={!editable} className={field} value={f.weekendRate} onChange={(e) => setF({ ...f, weekendRate: e.target.value })} /></label>
        <label className="text-sm">Adults included in the price<input type="number" min={1} max={10} disabled={!editable} className={field} value={f.includedAdults} onChange={(e) => setF({ ...f, includedAdults: e.target.value })} /></label>
        <label className="text-sm">Children who stay free (per room)<input type="number" min={0} max={10} disabled={!editable} className={field} value={f.freeChildren} onChange={(e) => setF({ ...f, freeChildren: e.target.value })} /></label>
        <label className="text-sm">Each extra adult, a night<input type="number" min={0} disabled={!editable} className={field} value={f.extraAdultRate} onChange={(e) => setF({ ...f, extraAdultRate: e.target.value })} /></label>
        <label className="text-sm">Each extra child, a night<input type="number" min={0} disabled={!editable} className={field} value={f.extraChildRate} onChange={(e) => setF({ ...f, extraChildRate: e.target.value })} /></label>
      </div>
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="text-secondary-500">Weekend nights:</span>
        {DAYS.map((d, i) => (
          <label key={d} className="flex items-center gap-1"><input type="checkbox" disabled={!editable} checked={f.weekendDays.includes(i)} onChange={(e) => setF({ ...f, weekendDays: e.target.checked ? [...f.weekendDays, i] : f.weekendDays.filter((x) => x !== i) })} />{d}</label>
        ))}
      </div>
      {editable && <button className={primaryBtn} onClick={() => onSave({ weekendRate: f.weekendRate ? Number(f.weekendRate) : null, weekendDays: f.weekendDays, includedAdults: Number(f.includedAdults), freeChildren: Number(f.freeChildren), extraAdultRate: Number(f.extraAdultRate), extraChildRate: Number(f.extraChildRate) })}>Save</button>}
    </div>
  );
}

function MealForm({ rates, editable, onSave }: { rates: Rates; editable: boolean; onSave: (prices: { plan: string; adultPrice: number; childPrice: number }[]) => void }) {
  const [rows, setRows] = useState(rates.meals.map((m) => ({ ...m, adultPrice: String(m.adultPrice), childPrice: String(m.childPrice) })));
  useEffect(() => setRows(rates.meals.map((m) => ({ ...m, adultPrice: String(m.adultPrice), childPrice: String(m.childPrice) }))), [rates]);
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">Meal plans <span className="font-normal text-secondary-500">(per person per night; 0 = not offered)</span></p>
      {rows.map((m, i) => (
        <div key={m.plan} className="grid grid-cols-[1fr_8rem_8rem] items-center gap-2 text-sm">
          <span>{m.label}</span>
          <input type="number" min={0} disabled={!editable} className={field} placeholder="Adult" value={m.adultPrice} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, adultPrice: e.target.value } : x)))} />
          <input type="number" min={0} disabled={!editable} className={field} placeholder="Child" value={m.childPrice} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, childPrice: e.target.value } : x)))} />
        </div>
      ))}
      {editable && <button className={primaryBtn} onClick={() => onSave(rows.map((m) => ({ plan: m.plan, adultPrice: Number(m.adultPrice) || 0, childPrice: Number(m.childPrice) || 0 })))}>Save</button>}
    </div>
  );
}
