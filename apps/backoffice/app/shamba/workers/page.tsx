"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, ApiError } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { SHAMBA_BRAND, day, inputClass, todayKey } from "../../../lib/shamba";
import { downloadPdf, printPdf, type PdfDocument } from "../../../lib/pdf";

/** A pay run as a payroll sheet: each worker's days, gross, statutory deductions and net. */
const runPdf = (r: Run): PdfDocument => {
  const m = { money: true };
  return {
    title: `Pay run ${r.number}`,
    subtitle: `${day(r.periodStart)} to ${day(r.periodEnd)} · ${r.status === "DRAFT" ? "Draft" : r.status === "APPROVED" ? "Approved" : "Paid"}`,
    tables: [
      {
        columns: [{ label: "Worker" }, { label: "Days", number: true }, { label: "Rate", ...m }, { label: "Gross", ...m }, { label: "NSSF", ...m }, { label: "SHIF", ...m }, { label: "Housing", ...m }, { label: "PAYE", ...m }, { label: "Net", ...m }, { label: "Paid" }],
        rows: r.lines.map((l) => [l.worker, l.days, l.dailyRate, l.gross, l.nssf, l.shif, l.housingLevy, l.paye, l.net, [l.method, l.reference].filter(Boolean).join(" ") || l.status]),
        totals: ["Total", r.lines.reduce((a, l) => a + l.days, 0), null, r.gross, r.lines.reduce((a, l) => a + l.nssf, 0), r.lines.reduce((a, l) => a + l.shif, 0), r.lines.reduce((a, l) => a + l.housingLevy, 0), r.lines.reduce((a, l) => a + l.paye, 0), r.net, ""],
      },
    ],
    notes: ["NSSF, SHIF, Housing Levy and PAYE are what the farm must remit."],
  };
};

type Tab = "muster" | "workers" | "runs" | "payout";
type Status = "PRESENT" | "HALF_DAY" | "ABSENT";
interface Worker { id: string; name: string; phone: string | null; idNumber: string | null; dailyRate: number; notes: string | null; active: boolean }
interface MusterRow { id: string; name: string; dailyRate: number; status: Status | null; task: string | null; locked: boolean }
interface RunRow { id: string; number: string; periodStart: string; periodEnd: string; status: "DRAFT" | "APPROVED" | "PAID"; workers: number; gross: number; deductions: number; net: number }
interface RunLine { id: string; worker: string; phone: string | null; days: number; dailyRate: number; gross: number; nssf: number; shif: number; housingLevy: number; paye: number; net: number; status: string; method: string | null; reference: string | null; failureReason: string | null }
interface Run extends RunRow { lines: RunLine[] }

const STATUS: Record<Status, string> = { PRESENT: "Present", HALF_DAY: "Half day", ABSENT: "Absent" };
const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const pill = (on: boolean) => (on ? { background: SHAMBA_BRAND.navy, color: "white", borderColor: SHAMBA_BRAND.navy } : { borderColor: "#cbd5e1", color: SHAMBA_BRAND.navy });

function Muster() {
  const [date, setDate] = useState(todayKey());
  const [rows, setRows] = useState<MusterRow[] | null>(null);
  const [marks, setMarks] = useState<Record<string, { status: Status; task: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () =>
    apiGet<{ workers: MusterRow[] }>(`/farm/labour/muster?date=${date}`)
      .then((r) => {
        setRows(r.workers);
        setMarks(Object.fromEntries(r.workers.map((w) => [w.id, { status: w.status ?? "PRESENT", task: w.task ?? "" }])));
      })
      .catch((err) => setError(errText(err, "Could not load the muster roll")));
  useEffect(() => {
    setDone(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  async function save() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiPut<{ present: number; marked: number }>("/farm/labour/muster", {
        date,
        entries: rows.filter((w) => !w.locked).map((w) => ({ workerId: w.id, status: marks[w.id].status, task: marks[w.id].task.trim() || undefined })),
      });
      setDone(`Saved: ${r.present} of ${r.marked} at work on ${date}.`);
      await load();
    } catch (err) {
      setError(errText(err, "Could not save the muster roll"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="mb-3 max-w-[12rem] text-sm">
        Day
        <input type="date" className={inputClass} value={date} max={todayKey()} onChange={(e) => setDate(e.target.value)} />
      </div>
      <ErrorBox error={error} />
      {done && <p className="mb-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: SHAMBA_BRAND.gold, background: "#fbf6e3", color: SHAMBA_BRAND.navy }}>{done}</p>}
      {!rows ? (
        <p className="text-sm text-secondary-500">Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-secondary-500">No workers yet. Add them on the Workers tab.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((w) => (
            <div key={w.id} className="rounded-lg border border-secondary-200 p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>
                  {w.name} <span className="text-xs font-normal text-secondary-500">{kes(w.dailyRate)} a day</span>
                </span>
                {w.locked && <span className="text-xs text-secondary-500">Paid - fixed</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(Object.keys(STATUS) as Status[]).map((s) => (
                  <button key={s} type="button" disabled={w.locked} onClick={() => setMarks({ ...marks, [w.id]: { ...marks[w.id], status: s } })} className="flex-1 rounded-lg border px-2 py-2 text-sm font-semibold disabled:opacity-50" style={pill(marks[w.id]?.status === s)}>
                    {STATUS[s]}
                  </button>
                ))}
              </div>
              <input className="mt-2 w-full rounded-lg border border-secondary-300 bg-white p-2 text-sm" placeholder="Task (optional)" disabled={w.locked} value={marks[w.id]?.task ?? ""} onChange={(e) => setMarks({ ...marks, [w.id]: { ...marks[w.id], task: e.target.value } })} />
            </div>
          ))}
          <div className="sticky bottom-2 rounded-lg bg-white/95 p-2 shadow">
            <Btn type="button" busy={busy} onClick={() => void save()}>Save muster roll</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function Workers({ manager }: { manager: boolean }) {
  const [rows, setRows] = useState<Worker[] | null>(null);
  const blank = { name: "", phone: "", idNumber: "", dailyRate: "", notes: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<Worker[]>("/farm/labour/workers?all=1").then(setRows).catch((err) => setError(errText(err, "Could not load workers")));
  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/labour/workers", { name: f.name.trim(), phone: f.phone.trim() || undefined, idNumber: f.idNumber.trim() || undefined, dailyRate: Number(f.dailyRate), notes: f.notes.trim() || undefined });
      setF(blank);
      await load();
    } catch (err) {
      setError(errText(err, "Could not add the worker"));
    } finally {
      setBusy(false);
    }
  }
  async function toggle(w: Worker) {
    try {
      await apiPut(`/farm/labour/workers/${w.id}`, { name: w.name, phone: w.phone ?? undefined, idNumber: w.idNumber ?? undefined, dailyRate: w.dailyRate, notes: w.notes ?? undefined, active: !w.active });
      await load();
    } catch (err) {
      setError(errText(err, "Could not change it"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card title="Workers">
        <p className="mb-2 text-xs text-secondary-500">Casual workers are paid by the day. They do not sign in and never count toward your plan&apos;s users.</p>
        {!rows ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary-500">
                <th className="py-1">Name</th>
                <th>M-Pesa</th>
                <th>A day</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id} className={`border-t border-secondary-100 ${w.active ? "" : "text-secondary-400"}`}>
                  <td className="py-1.5">
                    {w.name}
                    {w.notes ? <span className="block text-xs text-secondary-500">{w.notes}</span> : null}
                  </td>
                  <td>{w.phone ? `0${w.phone.slice(3)}` : "-"}</td>
                  <td>{kes(w.dailyRate)}</td>
                  <td className="text-right">
                    {manager && (
                      <button type="button" className="text-xs underline" onClick={() => void toggle(w)}>
                        {w.active ? "Stop" : "Bring back"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      {manager && (
        <Card title="Add a worker">
          <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <label className="col-span-2">
              Name
              <input className={inputClass} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
            </label>
            <label>
              M-Pesa number
              <input className={inputClass} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="0712 345 678" />
            </label>
            <label>
              Pay a day (KES)
              <input type="number" inputMode="numeric" min="1" className={inputClass} value={f.dailyRate} onChange={(e) => setF({ ...f, dailyRate: e.target.value })} required />
            </label>
            <label>
              ID number
              <input className={inputClass} value={f.idNumber} onChange={(e) => setF({ ...f, idNumber: e.target.value })} />
            </label>
            <label className="col-span-1 sm:col-span-3">
              Usual work
              <input className={inputClass} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
            </label>
            <div className="col-span-2 sm:col-span-4">
              <Btn busy={busy} disabled={!f.name.trim() || !f.dailyRate}>Add worker</Btn>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function Runs() {
  const [rows, setRows] = useState<RunRow[] | null>(null);
  const [open, setOpen] = useState<Run | null>(null);
  const [f, setF] = useState({ periodStart: "", periodEnd: todayKey() });
  const [error, setError] = useState<string | null>(null);
  const [upgrade, setUpgrade] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => apiGet<RunRow[]>("/farm/labour/runs").then(setRows).catch((err) => (err instanceof ApiError && err.status === 402 ? setUpgrade(err.message) : setError(errText(err, "Could not load pay runs"))));
  useEffect(() => {
    void load();
  }, []);
  if (upgrade) {
    return (
      <Card>
        <p className="text-sm">{upgrade}</p>
        <Link href="/shamba/pricing" className="mt-2 inline-block text-sm font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>See plans</Link>
      </Card>
    );
  }
  const show = (id: string) => apiGet<Run>(`/farm/labour/runs/${id}`).then(setOpen).catch((err) => setError(errText(err, "Could not open it")));

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<Run>("/farm/labour/runs", f);
      setOpen(r);
      await load();
    } catch (err) {
      setError(errText(err, "Could not make the pay run"));
    } finally {
      setBusy(false);
    }
  }
  async function act(run: Run, what: "approve" | "cash" | "mpesa" | "manual" | "delete") {
    setError(null);
    try {
      if (what === "delete") {
        if (!window.confirm(`Delete draft ${run.number}?`)) return;
        await apiDelete(`/farm/labour/runs/${run.id}`);
        setOpen(null);
      } else if (what === "approve") setOpen(await apiPost<Run>(`/farm/labour/runs/${run.id}/approve`, {}));
      else if (what === "manual") {
        const reference = window.prompt("M-Pesa code of the payment you sent by hand");
        if (!reference) return;
        setOpen(await apiPost<Run>(`/farm/labour/runs/${run.id}/pay`, { method: "MPESA_MANUAL", reference }));
      } else setOpen(await apiPost<Run>(`/farm/labour/runs/${run.id}/pay`, { method: what === "cash" ? "CASH" : "MPESA" }));
      await load();
    } catch (err) {
      setError(errText(err, "Could not do that"));
    }
  }

  return (
    <div className="space-y-4">
      <ErrorBox error={error} />
      <Card title="New pay run">
        <form onSubmit={create} className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <label>
            From
            <input type="date" className={inputClass} value={f.periodStart} max={todayKey()} onChange={(e) => setF({ ...f, periodStart: e.target.value })} required />
          </label>
          <label>
            To
            <input type="date" className={inputClass} value={f.periodEnd} max={todayKey()} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} required />
          </label>
          <div className="col-span-2 flex items-end">
            <Btn busy={busy} disabled={!f.periodStart}>Work out pay</Btn>
          </div>
          <p className="col-span-2 text-xs text-secondary-500 sm:col-span-4">From the muster roll, with NSSF, SHIF, Housing Levy and PAYE at the rates in force. Someone else approves it, then you pay.</p>
        </form>
      </Card>
      {open && (
        <Card title={`${open.number}: ${day(open.periodStart)} to ${day(open.periodEnd)}`} action={
            <span className="flex gap-3 text-sm">
              <button type="button" className="underline" onClick={() => void downloadPdf(runPdf(open), `pay-run-${open.number}`)}>Download PDF</button>
              <button type="button" className="underline" onClick={() => void printPdf(runPdf(open))}>Print</button>
              <button type="button" className="underline" onClick={() => setOpen(null)}>Close</button>
            </span>
          }>
          <p className="text-sm">
            {open.status === "DRAFT" ? "Draft - waiting for approval" : open.status === "APPROVED" ? "Approved - ready to pay" : "Paid"} · gross {kes(open.gross)} · deductions {kes(open.deductions)} · <b>net {kes(open.net)}</b>
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-secondary-500">
                  <th className="py-1">Worker</th>
                  <th>Days</th>
                  <th>Gross</th>
                  <th>NSSF</th>
                  <th>SHIF</th>
                  <th>Housing</th>
                  <th>PAYE</th>
                  <th>Net</th>
                  <th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {open.lines.map((l) => (
                  <tr key={l.id} className="border-t border-secondary-100">
                    <td className="py-1.5">{l.worker}</td>
                    <td>{l.days}</td>
                    <td>{l.gross.toLocaleString("en-KE")}</td>
                    <td>{l.nssf}</td>
                    <td>{l.shif}</td>
                    <td>{l.housingLevy}</td>
                    <td>{l.paye}</td>
                    <td className="font-semibold">{l.net.toLocaleString("en-KE")}</td>
                    <td className="text-xs">{l.status === "PAID" ? `${l.method === "CASH" ? "Cash" : "M-Pesa"}${l.reference ? ` ${l.reference}` : ""}` : l.status === "FAILED" ? <span className="text-red-700">{l.failureReason}</span> : l.status === "SENDING" ? "Sending..." : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {open.status === "DRAFT" && (
              <>
                <Btn type="button" onClick={() => void act(open, "approve")}>Approve</Btn>
                <button type="button" className="text-sm text-red-700 underline" onClick={() => void act(open, "delete")}>Delete draft</button>
              </>
            )}
            {open.status === "APPROVED" && (
              <>
                <Btn type="button" onClick={() => void act(open, "mpesa")}>Pay by M-Pesa</Btn>
                <Btn type="button" tone="navy" onClick={() => void act(open, "cash")}>Mark paid in cash</Btn>
                <button type="button" className="text-sm underline" onClick={() => void act(open, "manual")}>Paid by M-Pesa by hand</button>
              </>
            )}
          </div>
        </Card>
      )}
      <Card title="Pay runs">
        {!rows ? (
          <p className="text-sm text-secondary-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-secondary-500">No pay runs yet.</p>
        ) : (
          <ul className="divide-y divide-secondary-100 text-sm">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <button type="button" className="text-left underline" onClick={() => void show(r.id)}>
                  {r.number} · {day(r.periodStart)} to {day(r.periodEnd)} · {r.workers} workers
                </button>
                <span>
                  {kes(r.net)} · <b>{r.status === "DRAFT" ? "Draft" : r.status === "APPROVED" ? "Approved" : "Paid"}</b>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Payout() {
  const [s, setS] = useState<{ ready: boolean; environment: string; shortcode: string; initiator: string; hasKeys: boolean } | null>(null);
  const [f, setF] = useState({ environment: "production", shortcode: "", initiator: "", consumerKey: "", consumerSecret: "", securityCredential: "" });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    apiGet<{ ready: boolean; environment: string; shortcode: string; initiator: string; hasKeys: boolean }>("/farm/labour/payout-account")
      .then((r) => {
        setS(r);
        setF((x) => ({ ...x, environment: r.environment, shortcode: r.shortcode, initiator: r.initiator }));
      })
      .catch((err) => setError(errText(err, "Could not load the payout account")));
  }, []);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      setS(await apiPut("/farm/labour/payout-account", { ...f, consumerKey: f.consumerKey || undefined, consumerSecret: f.consumerSecret || undefined, securityCredential: f.securityCredential || undefined }));
      setF({ ...f, consumerKey: "", consumerSecret: "", securityCredential: "" });
      setSaved(true);
    } catch (err) {
      setError(errText(err, "Could not save it"));
    }
  }
  return (
    <Card title="M-Pesa payout account">
      <p className="mb-2 text-sm text-secondary-600">
        Wages go from the farm&apos;s own M-Pesa B2C account (from Safaricom Daraja). {s?.ready ? <b>Ready to pay.</b> : "Not set up yet: until then, mark wages paid in cash or by hand."}
      </p>
      <ErrorBox error={error} />
      {saved && <p className="text-sm" style={{ color: SHAMBA_BRAND.navy }}>Saved.</p>}
      <form onSubmit={save} className="grid grid-cols-2 gap-2 text-sm">
        <label>
          Environment
          <select className={inputClass} value={f.environment} onChange={(e) => setF({ ...f, environment: e.target.value })}>
            <option value="production">Live</option>
            <option value="sandbox">Test (sandbox)</option>
          </select>
        </label>
        <label>
          B2C shortcode
          <input className={inputClass} value={f.shortcode} onChange={(e) => setF({ ...f, shortcode: e.target.value })} required />
        </label>
        <label className="col-span-2">
          Initiator name
          <input className={inputClass} value={f.initiator} onChange={(e) => setF({ ...f, initiator: e.target.value })} required />
        </label>
        {(["consumerKey", "consumerSecret", "securityCredential"] as const).map((k) => (
          <label key={k} className="col-span-2">
            {{ consumerKey: "Consumer key", consumerSecret: "Consumer secret", securityCredential: "Security credential" }[k]}
            <input type="password" className={inputClass} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={s?.hasKeys ? "Saved - leave empty to keep" : ""} autoComplete="off" />
          </label>
        ))}
        <div className="col-span-2">
          <Btn>Save</Btn>
        </div>
      </form>
    </Card>
  );
}

export default function WorkersPage() {
  const [tab, setTab] = useState<Tab>("muster");
  return (
    <ShambaAppFrame>
      {(session) => {
        const manager = session.role === "OWNER" || session.role === "MANAGER";
        const tabs: Tab[] = manager ? ["muster", "workers", "runs", "payout"] : ["muster", "workers"];
        return (
          <div className="space-y-4">
            <div>
              <h1 className="text-2xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Workers</h1>
              <p className="text-sm text-secondary-600">Casual workers, the daily muster roll, and wages paid by M-Pesa with payslips by SMS.</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {tabs.map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold sm:flex-none" style={pill(tab === t)}>
                  {{ muster: "Muster roll", workers: "Workers", runs: "Pay runs", payout: "Payout account" }[t]}
                </button>
              ))}
            </div>
            {tab === "muster" && <Muster />}
            {tab === "workers" && <Workers manager={manager} />}
            {tab === "runs" && <Runs />}
            {tab === "payout" && <Payout />}
          </div>
        );
      }}
    </ShambaAppFrame>
  );
}
