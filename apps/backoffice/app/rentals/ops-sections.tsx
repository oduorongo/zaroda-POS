"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";

export interface PropertyOption {
  id: string;
  name: string;
}
export interface UnitOption {
  id: string;
  label: string;
  status: "VACANT" | "OCCUPIED";
  property: { id: string; name: string };
}

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const smallButton = "rounded border border-border px-2 py-1 text-xs hover:bg-background disabled:opacity-50";
const money = (v: number) => v.toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);
const nice = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

/** Shared save-and-reload plumbing so each section only describes its own form. */
function useAction(reload: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(action: () => Promise<string | void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const message = await action();
      if (message) setNotice(message);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, notice, run };
}

function Messages({ error, notice }: { error: string | null; notice: string | null }) {
  return (
    <>
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}
    </>
  );
}

// ── Expenses ──────────────────────────────────────────────────────────────

interface Expense {
  id: string;
  property: string;
  unit: string | null;
  category: string;
  description: string;
  vendor: string | null;
  amount: number;
  incurredAt: string;
}

const CATEGORIES = ["REPAIRS", "UTILITIES", "RATES_AND_TAXES", "INSURANCE", "CARETAKER", "MANAGEMENT_FEE", "OTHER"];

export function ExpensesSection({ properties }: { properties: PropertyOption[] }) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState({ propertyId: "", category: "REPAIRS", description: "", vendor: "", amount: "", incurredAt: "" });

  async function load() {
    setExpenses(await apiGet<Expense[]>("/rental/expenses"));
  }
  const { busy, error, notice, run } = useAction(load);
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiPost("/rental/expenses", {
        propertyId: form.propertyId,
        category: form.category,
        description: form.description,
        vendor: form.vendor || undefined,
        amount: Number(form.amount),
        incurredAt: form.incurredAt || undefined,
      });
      setForm({ ...form, description: "", vendor: "", amount: "", incurredAt: "" });
      return "Expense saved.";
    });
  };

  const total = expenses.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <form onSubmit={submit} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-4">
        <select className={input} required value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value })}>
          <option value="">Property...</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>{nice(c)}</option>
          ))}
        </select>
        <input className={input} required placeholder="What was it for?" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <input className={input} type="number" min="0.01" step="0.01" required placeholder="Amount (KES)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <input className={input} placeholder="Paid to (optional)" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
        <input className={input} type="date" title="Date (blank = today)" value={form.incurredAt} onChange={(e) => setForm({ ...form, incurredAt: e.target.value })} />
        <button className={`${button} sm:col-span-2`} disabled={busy}>Add expense</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-secondary-500">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Property</th>
              <th className="p-2">Type</th>
              <th className="p-2">Details</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {expenses.map((e) => (
              <tr key={e.id} className="border-t border-border">
                <td className="p-2">{day(e.incurredAt)}</td>
                <td className="p-2">{e.property}{e.unit ? ` ${e.unit}` : ""}</td>
                <td className="p-2">{nice(e.category)}</td>
                <td className="p-2">{e.description}{e.vendor ? <span className="text-secondary-500"> - {e.vendor}</span> : null}</td>
                <td className="p-2 text-right">{money(e.amount)}</td>
                <td className="p-2 text-right">
                  <button
                    className={smallButton}
                    disabled={busy}
                    onClick={() => window.confirm(`Delete this expense (KES ${money(e.amount)})?`) && void run(async () => { await apiDelete(`/rental/expenses/${e.id}`); return "Expense deleted."; })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-secondary-500">No expenses recorded yet.</td>
              </tr>
            )}
          </tbody>
          {expenses.length > 0 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="p-2" colSpan={4}>Total shown</td>
                <td className="p-2 text-right">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

// ── Maintenance ───────────────────────────────────────────────────────────

interface MaintenanceRow {
  id: string;
  property: string;
  propertyId: string;
  unit: string | null;
  unitId: string | null;
  reportedBy: string | null;
  title: string;
  description: string | null;
  priority: "LOW" | "NORMAL" | "URGENT";
  status: "OPEN" | "IN_PROGRESS" | "DONE" | "CANCELLED";
  reportedAt: string;
  resolvedAt: string | null;
  cost: number;
}

const PRIORITY_COLOR = { LOW: "text-secondary-500", NORMAL: "", URGENT: "font-semibold text-red-400" };

export function MaintenanceSection({ properties, units }: { properties: PropertyOption[]; units: UnitOption[] }) {
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [form, setForm] = useState({ propertyId: "", unitId: "", title: "", description: "", priority: "NORMAL" });
  const [costing, setCosting] = useState<MaintenanceRow | null>(null);
  const [cost, setCost] = useState({ amount: "", vendor: "" });

  async function load() {
    setRows(await apiGet<MaintenanceRow[]>("/rental/maintenance"));
  }
  const { busy, error, notice, run } = useAction(load);
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await apiPost("/rental/maintenance", {
        propertyId: form.propertyId,
        unitId: form.unitId || undefined,
        title: form.title,
        description: form.description || undefined,
        priority: form.priority,
      });
      setForm({ ...form, unitId: "", title: "", description: "" });
      return "Request logged.";
    });
  };

  const setStatus = (row: MaintenanceRow, status: MaintenanceRow["status"]) =>
    void run(async () => {
      await apiPatch(`/rental/maintenance/${row.id}`, { status });
    });

  const submitCost = (e: React.FormEvent) => {
    e.preventDefault();
    if (!costing) return;
    void run(async () => {
      await apiPost("/rental/expenses", {
        propertyId: costing.propertyId,
        unitId: costing.unitId || undefined,
        maintenanceId: costing.id,
        category: "REPAIRS",
        description: costing.title,
        vendor: cost.vendor || undefined,
        amount: Number(cost.amount),
      });
      setCosting(null);
      setCost({ amount: "", vendor: "" });
      return "Cost recorded as a repair expense.";
    });
  };

  const unitsHere = units.filter((u) => u.property.id === form.propertyId);
  const visible = rows.filter((r) => showClosed || r.status === "OPEN" || r.status === "IN_PROGRESS");

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <form onSubmit={submit} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-4">
        <select className={input} required value={form.propertyId} onChange={(e) => setForm({ ...form, propertyId: e.target.value, unitId: "" })}>
          <option value="">Property...</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className={input} value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
          <option value="">Whole property / common area</option>
          {unitsHere.map((u) => (
            <option key={u.id} value={u.id}>{u.label}</option>
          ))}
        </select>
        <input className={`${input} sm:col-span-2`} required minLength={2} placeholder="What needs fixing? (e.g. Leaking tap)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input className={`${input} sm:col-span-2`} placeholder="More detail (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <select className={input} value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
          <option value="LOW">Low priority</option>
          <option value="NORMAL">Normal</option>
          <option value="URGENT">Urgent</option>
        </select>
        <button className={button} disabled={busy}>Log request</button>
      </form>

      {costing && (
        <form onSubmit={submitCost} className="grid gap-2 rounded-lg border-2 border-amber-600 bg-surface p-3 sm:grid-cols-4">
          <p className="text-sm font-semibold sm:col-span-4">What did &quot;{costing.title}&quot; cost?</p>
          <input className={input} type="number" min="0.01" step="0.01" required placeholder="Amount (KES)" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
          <input className={input} placeholder="Paid to (optional)" value={cost.vendor} onChange={(e) => setCost({ ...cost, vendor: e.target.value })} />
          <div className="flex gap-2 sm:col-span-2">
            <button className={button} disabled={busy}>Save cost</button>
            <button type="button" className={smallButton} onClick={() => setCosting(null)}>Cancel</button>
          </div>
        </form>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
        Show finished and cancelled requests
      </label>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-secondary-500">
            <tr>
              <th className="p-2">Reported</th>
              <th className="p-2">Where</th>
              <th className="p-2">Problem</th>
              <th className="p-2">Status</th>
              <th className="p-2 text-right">Cost</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{day(r.reportedAt)}</td>
                <td className="p-2">{r.property}{r.unit ? ` ${r.unit}` : ""}</td>
                <td className={`p-2 ${PRIORITY_COLOR[r.priority]}`}>
                  {r.title}
                  {r.priority === "URGENT" && " (urgent)"}
                  {r.description && <span className="block text-xs font-normal text-secondary-500">{r.description}</span>}
                  {r.reportedBy && <span className="block text-xs font-normal text-secondary-500">Reported by {r.reportedBy}</span>}
                </td>
                <td className="p-2">{nice(r.status)}{r.resolvedAt ? ` (${day(r.resolvedAt)})` : ""}</td>
                <td className="p-2 text-right">{r.cost > 0 ? money(r.cost) : "-"}</td>
                <td className="space-x-1 p-2 text-right whitespace-nowrap">
                  {r.status === "OPEN" && <button className={smallButton} disabled={busy} onClick={() => setStatus(r, "IN_PROGRESS")}>Start</button>}
                  {(r.status === "OPEN" || r.status === "IN_PROGRESS") && (
                    <>
                      <button className={smallButton} disabled={busy} onClick={() => setStatus(r, "DONE")}>Done</button>
                      <button className={smallButton} disabled={busy} onClick={() => setStatus(r, "CANCELLED")}>Cancel</button>
                    </>
                  )}
                  {(r.status === "DONE" || r.status === "CANCELLED") && <button className={smallButton} disabled={busy} onClick={() => setStatus(r, "OPEN")}>Reopen</button>}
                  <button className={smallButton} disabled={busy} onClick={() => { setCosting(r); setCost({ amount: "", vendor: "" }); }}>+ Cost</button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="p-3 text-secondary-500">Nothing needs fixing right now.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Meters ────────────────────────────────────────────────────────────────

interface Reading {
  id: string;
  unit: string;
  unitId: string;
  kind: "WATER" | "ELECTRICITY";
  readingDate: string;
  reading: number;
  unitsUsed: number | null;
  ratePerUnit: number | null;
  charged: number;
}

export function MetersSection({ units }: { units: UnitOption[] }) {
  const [readings, setReadings] = useState<Reading[]>([]);
  const [form, setForm] = useState({ unitId: "", kind: "WATER", reading: "", ratePerUnit: "", previousReading: "", readingDate: "" });

  async function load() {
    setReadings(await apiGet<Reading[]>("/rental/meters"));
  }
  const { busy, error, notice, run } = useAction(load);
  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const lastForUnit = readings.find((r) => r.unitId === form.unitId && r.kind === form.kind);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const result = await apiPost<{ charged: number; unitsUsed: number | null; billedToTenant: boolean; note?: string }>("/rental/meters", {
        unitId: form.unitId,
        kind: form.kind,
        reading: Number(form.reading),
        ratePerUnit: form.ratePerUnit ? Number(form.ratePerUnit) : undefined,
        previousReading: !lastForUnit && form.previousReading ? Number(form.previousReading) : undefined,
        readingDate: form.readingDate || undefined,
      });
      setForm({ ...form, reading: "", previousReading: "", readingDate: "" });
      return result.billedToTenant
        ? `Reading saved. ${result.unitsUsed} units used - KES ${money(result.charged)} added to the tenant's balance.`
        : `Reading saved. ${result.note ?? ""}`.trim();
    });
  };

  return (
    <div className="space-y-4">
      <Messages error={error} notice={notice} />
      <p className="text-xs text-secondary-500">
        Enter the meter reading each month. The units used since the last reading are charged to the tenant at your rate. The first reading of a meter is just the starting point.
      </p>
      <form onSubmit={submit} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-4">
        <select className={input} required value={form.unitId} onChange={(e) => setForm({ ...form, unitId: e.target.value })}>
          <option value="">Unit...</option>
          {units.map((u) => (
            <option key={u.id} value={u.id}>{u.property.name} - {u.label}{u.status === "VACANT" ? " (vacant)" : ""}</option>
          ))}
        </select>
        <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="WATER">Water</option>
          <option value="ELECTRICITY">Electricity</option>
        </select>
        <input className={input} type="number" min="0" step="0.01" required placeholder={lastForUnit ? `Reading (last: ${lastForUnit.reading})` : "Meter reading"} value={form.reading} onChange={(e) => setForm({ ...form, reading: e.target.value })} />
        <input className={input} type="number" min="0" step="0.01" placeholder={lastForUnit?.ratePerUnit ? `Rate per unit (last: ${lastForUnit.ratePerUnit})` : "Rate per unit (KES)"} value={form.ratePerUnit} onChange={(e) => setForm({ ...form, ratePerUnit: e.target.value })} />
        {form.unitId && !lastForUnit && (
          <input className={input} type="number" min="0" step="0.01" placeholder="Previous reading (optional)" title="Only needed to bill this first reading" value={form.previousReading} onChange={(e) => setForm({ ...form, previousReading: e.target.value })} />
        )}
        <input className={input} type="date" title="Reading date (blank = today)" value={form.readingDate} onChange={(e) => setForm({ ...form, readingDate: e.target.value })} />
        <button className={button} disabled={busy}>Save reading</button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="text-xs uppercase text-secondary-500">
            <tr>
              <th className="p-2">Date</th>
              <th className="p-2">Unit</th>
              <th className="p-2">Meter</th>
              <th className="p-2 text-right">Reading</th>
              <th className="p-2 text-right">Used</th>
              <th className="p-2 text-right">Rate</th>
              <th className="p-2 text-right">Charged</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="p-2">{day(r.readingDate)}</td>
                <td className="p-2">{r.unit}</td>
                <td className="p-2">{nice(r.kind)}</td>
                <td className="p-2 text-right">{r.reading}</td>
                <td className="p-2 text-right">{r.unitsUsed ?? "start"}</td>
                <td className="p-2 text-right">{r.ratePerUnit ?? "-"}</td>
                <td className="p-2 text-right">{r.charged > 0 ? money(r.charged) : "-"}</td>
              </tr>
            ))}
            {readings.length === 0 && (
              <tr>
                <td colSpan={7} className="p-3 text-secondary-500">No readings yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Monthly report ────────────────────────────────────────────────────────

interface Report {
  business: string;
  month: string;
  properties: { propertyId: string; property: string; units: number; occupied: number; charged: number; collected: number; expenses: number; net: number; arrears: number }[];
  totals: { units: number; occupied: number; charged: number; collected: number; expenses: number; net: number; arrears: number };
  expensesByCategory: { category: string; amount: number }[];
}

export function ReportsSection() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    apiGet<Report>(`/rental/reports/monthly?month=${month}`)
      .then(setReport)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Could not load the report."));
  }, [month]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <input className="rounded-md border border-border bg-surface p-2 text-sm" type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
        <Link href={`/rentals/print/report/${month}`} target="_blank" className={`${smallButton} inline-block no-underline`}>Print report</Link>
      </div>
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Rent collected</p>
              <p className="text-lg font-bold">KES {money(report.totals.collected)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Expenses</p>
              <p className="text-lg font-bold">KES {money(report.totals.expenses)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Net income</p>
              <p className={`text-lg font-bold ${report.totals.net < 0 ? "text-red-400" : "text-green-400"}`}>KES {money(report.totals.net)}</p>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3">
              <p className="text-xs text-secondary-500">Arrears (all time)</p>
              <p className={`text-lg font-bold ${report.totals.arrears > 0 ? "text-red-400" : ""}`}>KES {money(report.totals.arrears)}</p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-secondary-500">
                <tr>
                  <th className="p-2">Property</th>
                  <th className="p-2">Occupied</th>
                  <th className="p-2 text-right">Charged</th>
                  <th className="p-2 text-right">Collected</th>
                  <th className="p-2 text-right">Expenses</th>
                  <th className="p-2 text-right">Net</th>
                  <th className="p-2 text-right">Arrears</th>
                </tr>
              </thead>
              <tbody>
                {report.properties.map((p) => (
                  <tr key={p.propertyId} className="border-t border-border">
                    <td className="p-2 font-medium">{p.property}</td>
                    <td className="p-2">{p.occupied}/{p.units}</td>
                    <td className="p-2 text-right">{money(p.charged)}</td>
                    <td className="p-2 text-right">{money(p.collected)}</td>
                    <td className="p-2 text-right">{money(p.expenses)}</td>
                    <td className={`p-2 text-right ${p.net < 0 ? "text-red-400" : ""}`}>{money(p.net)}</td>
                    <td className={`p-2 text-right ${p.arrears > 0 ? "text-red-400" : ""}`}>{money(p.arrears)}</td>
                  </tr>
                ))}
                {report.properties.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-3 text-secondary-500">Add a property to see a report.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {report.expensesByCategory.length > 0 && (
            <p className="text-xs text-secondary-500">
              Expenses: {report.expensesByCategory.map((c) => `${nice(c.category)} ${money(c.amount)}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
