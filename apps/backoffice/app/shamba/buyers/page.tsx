"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { BUYER_KINDS, SHAMBA_BRAND, SHAMBA_INK, day, inputClass, todayKey, type FarmEnterprise } from "../../../lib/shamba";
import { downloadPdf, printPdf, type PdfDocument } from "../../../lib/pdf";

const salesPdf = (r: Report): PdfDocument => ({
  title: "Sales by enterprise",
  subtitle: `${day(r.from)} to ${day(r.to)}`,
  tables: [
    {
      columns: [{ label: "Enterprise" }, { label: "At the till", money: true }, { label: "On credit", money: true }, { label: "Total", money: true }],
      rows: r.rows.map((x) => [x.name, x.till, x.credit, x.total]),
      totals: ["All", r.rows.reduce((a, x) => a + x.till, 0), r.rows.reduce((a, x) => a + x.credit, 0), r.total],
    },
  ],
});

type Tab = "buyers" | "deliver" | "pay" | "report";
interface Buyer { id: string; name: string; kind: string; phone: string | null; memberNo: string | null; creditLimit: number | null; termsDays: number | null; active: boolean; owed: number; credit: number; current: number; d31: number; d61: number; d90: number; overLimit: boolean }
interface Delivery { id: string; date: string; buyer: string; product: string; unit: string; quantity: number; unitPrice: number; amount: number; slipNo: string | null; session: string | null; overLimit: boolean; voidedAt: string | null; voidReason: string | null }
interface ProductRow { id: string; name: string; baseUnit: string; variants: { id: string; name: string | null; price: string }[] }
interface Report { from: string; to: string; total: number; rows: { enterpriseId: string | null; name: string; till: number; credit: number; total: number }[] }

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const pill = (on: boolean) => (on ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_INK });
const products = () => apiGet<ProductRow[]>("/products").then((p) => (Array.isArray(p) ? p : [])).catch(() => [] as ProductRow[]);
const options = (rows: ProductRow[]) => rows.flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.name}${v.name ? ` - ${v.name}` : ""}`, unit: p.baseUnit, price: Number(v.price) })));

function useBuyers() {
  const [rows, setRows] = useState<Buyer[] | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => apiGet<Buyer[]>("/farm/sales/buyers").then(setRows).catch((err) => (err instanceof ApiError && err.status === 402 ? setUpgrade(err.message) : setError(errText(err, "Could not load buyers"))));
  useEffect(() => {
    void load();
  }, []);
  return { rows, upgrade, error, load };
}

function Upgrade({ message }: { message: string }) {
  return (
    <Card>
      <p className="text-sm">{message}</p>
      <Link href="/shamba/pricing" className="mt-2 inline-block text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>See plans</Link>
    </Card>
  );
}

function Buyers({ manager }: { manager: boolean }) {
  const { rows, upgrade, error, load } = useBuyers();
  const blank = { name: "", kind: "COOP", phone: "", memberNo: "", creditLimit: "", termsDays: "30", kraPin: "" };
  const [f, setF] = useState(blank);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (upgrade) return <Upgrade message={upgrade} />;
  const total = (rows ?? []).reduce((s, b) => s + b.owed, 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await apiPost("/farm/sales/buyers", {
        name: f.name.trim(), kind: f.kind, phone: f.phone.trim() || undefined, memberNo: f.memberNo.trim() || undefined, kraPin: f.kraPin.trim() || undefined,
        creditLimit: f.creditLimit ? Number(f.creditLimit) : undefined, termsDays: f.termsDays ? Number(f.termsDays) : undefined,
      });
      setF(blank);
      await load();
    } catch (e2) {
      setErr(errText(e2, "Could not add the buyer"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error ?? err} />
      <Card title={`Buyers · owed to the farm ${kes(total)}`}>
        {!rows ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-secondary-500">No buyers yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th className="py-1">Buyer</th>
                  <th>Owes</th>
                  <th>0-30</th>
                  <th>31-60</th>
                  <th>61-90</th>
                  <th>90+</th>
                  <th>Limit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <tr key={b.id} className="border-t border-border">
                    <td className="py-1.5">
                      <Link href={`/shamba/buyers/${b.id}`} className="font-semibold underline" style={{ color: SHAMBA_INK }}>
                        {b.name}
                      </Link>
                      <span className="block text-xs text-secondary-500">
                        {BUYER_KINDS[b.kind] ?? b.kind}
                        {b.memberNo ? ` · member ${b.memberNo}` : ""}
                      </span>
                    </td>
                    <td className="font-semibold" style={b.overLimit ? { color: SHAMBA_BRAND.orange } : undefined}>
                      {kes(b.owed)}
                      {b.credit > 0 && <span className="block text-xs font-normal text-secondary-500">credit {kes(b.credit)}</span>}
                    </td>
                    <td>{b.current ? b.current.toLocaleString("en-KE") : "-"}</td>
                    <td>{b.d31 ? b.d31.toLocaleString("en-KE") : "-"}</td>
                    <td>{b.d61 ? b.d61.toLocaleString("en-KE") : "-"}</td>
                    <td className={b.d90 ? "font-semibold text-red-700" : ""}>{b.d90 ? b.d90.toLocaleString("en-KE") : "-"}</td>
                    <td className="text-xs">{b.creditLimit !== null ? `${kes(b.creditLimit)}${b.overLimit ? " (over)" : ""}` : "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {manager && (
        <Card title="Add a buyer">
          <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label className="col-span-2">
              Name
              <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required placeholder="e.g. Uriri Dairy Co-operative" />
            </label>
            <label>
              Kind
              <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
                {Object.entries(BUYER_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Phone
              <input className={inputClass} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </label>
            <label>
              Your member no.
              <input className={inputClass} value={f.memberNo} onChange={(e) => setF({ ...f, memberNo: e.target.value })} placeholder="co-op / processor" />
            </label>
            <label>
              Credit limit (KES)
              <input type="number" min="0" className={inputClass} value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} placeholder="none" />
            </label>
            <label>
              Pays within (days)
              <input type="number" min="0" className={inputClass} value={f.termsDays} onChange={(e) => setF({ ...f, termsDays: e.target.value })} />
            </label>
            <label>
              KRA PIN
              <input className={inputClass} value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value })} />
            </label>
            <div className="col-span-2 sm:col-span-4">
              <Btn busy={busy} disabled={!f.name.trim()}>Add buyer</Btn>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Deliver({ manager }: { manager: boolean }) {
  const { rows: buyers, upgrade } = useBuyers();
  const [prods, setProds] = useState<ProductRow[]>([]);
  const [list, setList] = useState<Delivery[]>([]);
  const blank = { buyerId: "", date: todayKey(), session: "", variantId: "", quantity: "", unitPrice: "", slipNo: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Delivery[]>("/farm/sales/deliveries").then(setList).catch(() => {});
  useEffect(() => {
    void load();
    void products().then(setProds);
  }, []);
  if (upgrade) return <Upgrade message={upgrade} />;
  const opts = options(prods);
  const item = opts.find((o) => o.id === f.variantId);
  const amount = Number(f.quantity || 0) * (f.unitPrice ? Number(f.unitPrice) : item?.price ?? 0);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ amount: number; owed: number; overLimit: boolean }>("/farm/sales/deliveries", {
        buyerId: f.buyerId, date: f.date, session: f.session || undefined, variantId: f.variantId, quantity: Number(f.quantity), unitPrice: f.unitPrice ? Number(f.unitPrice) : undefined, slipNo: f.slipNo.trim() || undefined,
      });
      setDone(`Delivered: ${kes(r.amount)} on credit. ${buyers?.find((b) => b.id === f.buyerId)?.name} now owes ${kes(r.owed)}${r.overLimit ? " (past its limit, approved)" : ""}.`);
      setF({ ...blank, buyerId: f.buyerId, variantId: f.variantId, unitPrice: f.unitPrice });
      await load();
    } catch (err) {
      setError(errText(err, "Could not record the delivery"));
    } finally {
      setBusy(false);
    }
  }
  async function voidRow(id: string) {
    const reason = window.prompt("Why void this delivery? (it goes back into stock and off the buyer's bill)");
    if (!reason || reason.trim().length < 3) return;
    try {
      await apiPost(`/farm/sales/deliveries/${id}/void`, { reason });
      await load();
    } catch (err) {
      setError(errText(err, "Could not void it"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      {done && <p className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_INK }}>{done}</p>}
      <Card title="Deliver on credit">
        <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <label className="col-span-2">
            Buyer
            <select className={inputClass} value={f.buyerId} onChange={(e) => setF({ ...f, buyerId: e.target.value })} required>
              <option value="">Choose</option>
              {(buyers ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} (owes {kes(b.owed)})
                </option>
              ))}
            </select>
          </label>
          <label>
            Date
            <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
          </label>
          <label>
            Milking
            <select className={inputClass} value={f.session} onChange={(e) => setF({ ...f, session: e.target.value })}>
              <option value="">-</option>
              <option value="AM">Morning</option>
              <option value="NOON">Midday</option>
              <option value="PM">Evening</option>
            </select>
          </label>
          <label className="col-span-2">
            Product
            <select className={inputClass} value={f.variantId} onChange={(e) => setF({ ...f, variantId: e.target.value })} required>
              <option value="">Choose</option>
              {opts.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label} (per {o.unit})
                </option>
              ))}
            </select>
          </label>
          <label>
            Quantity{item ? ` (${item.unit})` : ""}
            <input type="number" inputMode="decimal" step="0.001" min="0.001" className="mt-1 w-full rounded-lg border border-border bg-surface p-3 text-lg text-foreground" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} required />
          </label>
          <label>
            Price (KES)
            <input type="number" inputMode="decimal" min="0" className={inputClass} value={f.unitPrice} onChange={(e) => setF({ ...f, unitPrice: e.target.value })} placeholder={item ? String(item.price) : ""} />
          </label>
          <label className="col-span-2">
            Buyer&apos;s slip / receipt no.
            <input className={inputClass} value={f.slipNo} onChange={(e) => setF({ ...f, slipNo: e.target.value })} />
          </label>
          <p className="col-span-2 self-end text-sm font-semibold sm:col-span-2">{amount > 0 ? kes(amount) : ""}</p>
          <p className="col-span-2 text-xs text-secondary-500 sm:col-span-4">Milk and eggs from treated animals are not in stock, so they cannot be delivered. Past a buyer&apos;s limit, only a farm manager can deliver.</p>
          <div className="col-span-2 sm:col-span-4">
            <Btn busy={busy} disabled={!f.buyerId || !f.variantId || !f.quantity}>Record delivery</Btn>
          </div>
        </form>
      </Card>
      {list.length > 0 && (
        <Card title="Last 14 days">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th className="py-1">Date</th>
                  <th>Buyer</th>
                  <th>What</th>
                  <th>Amount</th>
                  <th>Slip</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className={`border-t border-border ${d.voidedAt ? "text-secondary-400 line-through" : ""}`} title={d.voidReason ?? undefined}>
                    <td className="py-1.5 whitespace-nowrap">
                      {day(d.date)}
                      {d.session ? ` ${d.session}` : ""}
                    </td>
                    <td>{d.buyer}</td>
                    <td>
                      {d.quantity} {d.unit} {d.product}
                    </td>
                    <td>
                      {kes(d.amount)}
                      {d.overLimit && <span className="ml-1 text-xs" style={{ color: SHAMBA_BRAND.orange }}>over limit</span>}
                    </td>
                    <td>{d.slipNo ?? "-"}</td>
                    <td className="text-right">
                      {!d.voidedAt && manager && (
                        <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => void voidRow(d.id)}>
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Pay() {
  const { rows: buyers, upgrade, load } = useBuyers();
  const blank = { buyerId: "", date: todayKey(), amount: "", method: "MPESA", reference: "", notes: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (upgrade) return <Upgrade message={upgrade} />;
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const r = await apiPost<{ owed: number; credit: number }>("/farm/sales/payments", { buyerId: f.buyerId, date: f.date, amount: Number(f.amount), method: f.method, reference: f.reference.trim() || undefined, notes: f.notes.trim() || undefined });
      setDone(`Payment saved. ${buyers?.find((b) => b.id === f.buyerId)?.name} now owes ${kes(r.owed)}${r.credit ? ` and has ${kes(r.credit)} credit` : ""}.`);
      setF({ ...blank });
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the payment"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Money received from a buyer">
      <ErrorBox error={error} />
      {done && <p className="mb-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_INK }}>{done}</p>}
      <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <label className="col-span-2">
          Buyer
          <select className={inputClass} value={f.buyerId} onChange={(e) => setF({ ...f, buyerId: e.target.value })} required>
            <option value="">Choose</option>
            {(buyers ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} (owes {kes(b.owed)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Date
          <input type="date" className={inputClass} value={f.date} max={todayKey()} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </label>
        <label>
          Amount (KES)
          <input type="number" inputMode="decimal" min="1" className="mt-1 w-full rounded-lg border border-border bg-surface p-3 text-lg text-foreground" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
        </label>
        <label>
          How
          <select className={inputClass} value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>
            <option value="MPESA">M-Pesa</option>
            <option value="BANK">Bank</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CASH">Cash</option>
          </select>
        </label>
        <label className="col-span-1 sm:col-span-3">
          {f.method === "CASH" ? "Receipt no. (optional)" : f.method === "CHEQUE" ? "Cheque no." : f.method === "BANK" ? "Bank reference" : "M-Pesa code"}
          <input className={inputClass} value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} required={f.method !== "CASH"} />
        </label>
        <div className="col-span-2 sm:col-span-4">
          <Btn busy={busy} disabled={!f.buyerId || !f.amount}>Save payment</Btn>
        </div>
      </form>
    </Card>
  );
}

function SalesReport({ manager }: { manager: boolean }) {
  const [r, setR] = useState<Report | null>(null);
  const [prods, setProds] = useState<ProductRow[]>([]);
  const [enterprises, setEnterprises] = useState<FarmEnterprise[]>([]);
  const [tags, setTags] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = () => apiGet<Report>("/farm/sales/report").then(setR).catch((err) => setError(errText(err, "Could not load the sales report")));
  useEffect(() => {
    void load();
    void products().then(setProds);
    apiGet<FarmEnterprise[]>("/farm/enterprises").then(setEnterprises).catch(() => {});
    apiGet<{ variantId: string; enterpriseId: string }[]>("/farm/sales/tags").then((t) => setTags(Object.fromEntries(t.map((x) => [x.variantId, x.enterpriseId])))).catch(() => {});
  }, []);
  async function saveTags() {
    setError(null);
    setSaved(false);
    try {
      await apiPut("/farm/sales/tags", { tags: options(prods).map((o) => ({ variantId: o.id, enterpriseId: tags[o.id] || null })) });
      setSaved(true);
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the tags"));
    }
  }
  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card
        title="Sales by enterprise, last 30 days"
        action={
          r ? (
            <span className="flex gap-3 text-sm">
              <button type="button" className="underline" onClick={() => void downloadPdf(salesPdf(r), `sales-by-enterprise-${r.to}`)}>Download PDF</button>
              <button type="button" className="underline" onClick={() => void printPdf(salesPdf(r))}>Print</button>
            </span>
          ) : undefined
        }
      >
        {!r ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500">
                <th className="py-1">Enterprise</th>
                <th>At the till</th>
                <th>On credit</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {r.rows.map((x) => (
                <tr key={x.enterpriseId ?? "none"} className="border-t border-border">
                  <td className="py-1.5">{x.name}</td>
                  <td>{kes(x.till)}</td>
                  <td>{kes(x.credit)}</td>
                  <td className="font-semibold">{kes(x.total)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-border font-bold">
                <td className="py-1.5">All</td>
                <td />
                <td />
                <td>{kes(r.total)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>
      {manager && (
        <Card title="Which enterprise each product belongs to">
          <p className="mb-2 text-xs text-secondary-500">Till sales and deliveries of a product count toward its enterprise (Fresh milk to Dairy herd).</p>
          {saved && <p className="text-sm" style={{ color: SHAMBA_INK }}>Saved.</p>}
          <div className="space-y-1 text-sm">
            {options(prods).map((o) => (
              <label key={o.id} className="grid grid-cols-2 items-center gap-2">
                <span>{o.label}</span>
                <select className="rounded-lg border border-border bg-surface p-2" value={tags[o.id] ?? ""} onChange={(e) => setTags({ ...tags, [o.id]: e.target.value })}>
                  <option value="">-</option>
                  {enterprises.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="mt-3">
            <Btn type="button" onClick={() => void saveTags()}>Save</Btn>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function BuyersPage() {
  const [tab, setTab] = useState<Tab>("buyers");
  return (
    <ShambaAppFrame>
      {(session) => {
        const manager = session.role === "OWNER" || session.role === "MANAGER";
        return (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Buyers &amp; credit</h1>
              <p className="text-sm text-secondary-600">Co-ops, hotels and schools that take produce on credit: deliveries, payments, what each owes and statements.</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(["buyers", "deliver", "pay", "report"] as Tab[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold sm:flex-none" style={pill(tab === t)}>
                  {{ buyers: "Buyers", deliver: "Deliver", pay: "Payment", report: "Sales by enterprise" }[t]}
                </button>
              ))}
            </div>
            {tab === "buyers" && <Buyers manager={manager} />}
            {tab === "deliver" && <Deliver manager={manager} />}
            {tab === "pay" && <Pay />}
            {tab === "report" && <SalesReport manager={manager} />}
          </div>
        );
      }}
    </ShambaAppFrame>
  );
}
