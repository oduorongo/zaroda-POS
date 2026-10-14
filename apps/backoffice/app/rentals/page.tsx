"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, ApiError } from "../../lib/api";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { PageHeader } from "../../components/page-header";

interface Property {
  id: string;
  name: string;
  address: string | null;
  unitCount: number;
  occupiedCount: number;
}

interface Unit {
  id: string;
  label: string;
  monthlyRent: string;
  depositAmount: string;
  status: "VACANT" | "OCCUPIED";
  property: { id: string; name: string };
}

interface Tenant {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  idNumber: string | null;
  leases: { id: string; unit: { label: string; property: { name: string } } }[];
}

interface Lease {
  id: string;
  startDate: string;
  endDate: string | null;
  endedAt: string | null;
  monthlyRent: string;
  depositAmount: string;
  dueDay: number;
  status: "ACTIVE" | "ENDED";
  tenant: { id: string; name: string; phone: string | null };
  unit: { id: string; label: string; property: { id: string; name: string } };
}

type Tab = "properties" | "tenants" | "leases";

const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const money = (v: string | number) => Number(v).toLocaleString("en-KE", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const day = (iso: string) => iso.slice(0, 10);

/**
 * Landlord screen for the RENTAL industry: properties and their units,
 * tenants, and the leases that put a tenant in a unit. Rent invoicing and
 * payments arrive in the next phase.
 */
export default function RentalsPage() {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState<Tab>("properties");
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [leases, setLeases] = useState<Lease[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [propForm, setPropForm] = useState({ name: "", address: "" });
  const [unitForm, setUnitForm] = useState({ propertyId: "", label: "", monthlyRent: "", depositAmount: "" });
  const [tenantForm, setTenantForm] = useState({ name: "", phone: "", email: "", idNumber: "" });
  const [leaseForm, setLeaseForm] = useState({ unitId: "", tenantId: "", startDate: "", dueDay: "1", monthlyRent: "", depositAmount: "" });

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    if (s.industryType !== "RENTAL") {
      router.replace("/sales");
      return;
    }
    setSession(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    try {
      const [p, u, t, l] = await Promise.all([
        apiGet<Property[]>("/rental/properties"),
        apiGet<Unit[]>("/rental/units"),
        apiGet<Tenant[]>("/rental/tenants"),
        apiGet<Lease[]>("/rental/leases"),
      ]);
      setProperties(p);
      setUnits(u);
      setTenants(t);
      setLeases(l);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load your rental records.");
    }
  }

  // Runs a save, reloads the lists and shows any server message (like "this unit is already occupied").
  async function submit(action: () => Promise<unknown>, reset: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      reset();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That did not save. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const addProperty = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(
      () => apiPost("/rental/properties", { name: propForm.name, address: propForm.address || undefined }),
      () => setPropForm({ name: "", address: "" }),
    );
  };

  const addUnit = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(
      () =>
        apiPost("/rental/units", {
          propertyId: unitForm.propertyId,
          label: unitForm.label,
          monthlyRent: Number(unitForm.monthlyRent),
          depositAmount: unitForm.depositAmount ? Number(unitForm.depositAmount) : undefined,
        }),
      () => setUnitForm({ ...unitForm, label: "", monthlyRent: "", depositAmount: "" }),
    );
  };

  const addTenant = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(
      () =>
        apiPost("/rental/tenants", {
          name: tenantForm.name,
          phone: tenantForm.phone || undefined,
          email: tenantForm.email || undefined,
          idNumber: tenantForm.idNumber || undefined,
        }),
      () => setTenantForm({ name: "", phone: "", email: "", idNumber: "" }),
    );
  };

  const addLease = (e: React.FormEvent) => {
    e.preventDefault();
    void submit(
      () =>
        apiPost("/rental/leases", {
          unitId: leaseForm.unitId,
          tenantId: leaseForm.tenantId,
          startDate: leaseForm.startDate,
          dueDay: Number(leaseForm.dueDay),
          monthlyRent: leaseForm.monthlyRent ? Number(leaseForm.monthlyRent) : undefined,
          depositAmount: leaseForm.depositAmount ? Number(leaseForm.depositAmount) : undefined,
        }),
      () => setLeaseForm({ unitId: "", tenantId: "", startDate: "", dueDay: "1", monthlyRent: "", depositAmount: "" }),
    );
  };

  const endLease = (lease: Lease) => {
    if (!window.confirm(`End ${lease.tenant.name}'s lease on ${lease.unit.property.name} ${lease.unit.label}? The unit becomes vacant.`)) return;
    void submit(() => apiPatch(`/rental/leases/${lease.id}/end`, {}), () => {});
  };

  if (!session) return null;

  const vacantUnits = units.filter((u) => u.status === "VACANT");
  const occupied = units.filter((u) => u.status === "OCCUPIED").length;
  const monthlyRoll = leases.filter((l) => l.status === "ACTIVE").reduce((sum, l) => sum + Number(l.monthlyRent), 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4 sm:p-6">
        <h1 className="mb-4 text-xl font-bold">Rentals</h1>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-secondary-500">Units</p>
            <p className="text-lg font-bold">{units.length}</p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-secondary-500">Occupied</p>
            <p className="text-lg font-bold">
              {occupied}
              <span className="text-xs font-normal text-secondary-500"> / {units.length}</span>
            </p>
          </div>
          <div className="rounded-lg border border-border bg-surface p-3">
            <p className="text-xs text-secondary-500">Rent per month (KES)</p>
            <p className="text-lg font-bold">{money(monthlyRoll)}</p>
          </div>
        </div>

        {error && <p className="mb-4 rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}

        <div className="mb-4 flex gap-2">
          {(["properties", "tenants", "leases"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-2 text-sm capitalize ${tab === t ? "bg-primary-600 text-white" : "border border-border bg-surface"}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "properties" && (
          <div className="space-y-6">
            <form onSubmit={addProperty} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-[1fr_1fr_auto]">
              <input className={input} placeholder="Property name (e.g. Kilimani Apartments)" required value={propForm.name} onChange={(e) => setPropForm({ ...propForm, name: e.target.value })} />
              <input className={input} placeholder="Address / location" value={propForm.address} onChange={(e) => setPropForm({ ...propForm, address: e.target.value })} />
              <button className={button} disabled={busy}>Add property</button>
            </form>

            <form onSubmit={addUnit} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-5">
              <select className={input} required value={unitForm.propertyId} onChange={(e) => setUnitForm({ ...unitForm, propertyId: e.target.value })}>
                <option value="">Property...</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input className={input} placeholder="Unit (A4, Shop 2)" required value={unitForm.label} onChange={(e) => setUnitForm({ ...unitForm, label: e.target.value })} />
              <input className={input} type="number" min="0" step="0.01" placeholder="Monthly rent" required value={unitForm.monthlyRent} onChange={(e) => setUnitForm({ ...unitForm, monthlyRent: e.target.value })} />
              <input className={input} type="number" min="0" step="0.01" placeholder="Deposit" value={unitForm.depositAmount} onChange={(e) => setUnitForm({ ...unitForm, depositAmount: e.target.value })} />
              <button className={button} disabled={busy}>Add unit</button>
            </form>

            {properties.map((p) => (
              <section key={p.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">{p.name}</h2>
                  <span className="text-xs text-secondary-500">
                    {p.address ? `${p.address} · ` : ""}
                    {p.occupiedCount}/{p.unitCount} occupied
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {units
                    .filter((u) => u.property.id === p.id)
                    .map((u) => (
                      <div key={u.id} className={`rounded-md border-2 p-2 text-center ${u.status === "OCCUPIED" ? "border-green-700" : "border-amber-700"}`}>
                        <p className="font-bold">{u.label}</p>
                        <p className="text-xs">KES {money(u.monthlyRent)}</p>
                        <p className="text-xs uppercase tracking-wide text-secondary-500">{u.status}</p>
                      </div>
                    ))}
                  {p.unitCount === 0 && <p className="col-span-full text-sm text-secondary-500">No units yet.</p>}
                </div>
              </section>
            ))}
            {properties.length === 0 && <p className="text-sm text-secondary-500">Add your first property above.</p>}
          </div>
        )}

        {tab === "tenants" && (
          <div className="space-y-6">
            <form onSubmit={addTenant} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-5">
              <input className={input} placeholder="Full name" required value={tenantForm.name} onChange={(e) => setTenantForm({ ...tenantForm, name: e.target.value })} />
              <input className={input} placeholder="Phone" value={tenantForm.phone} onChange={(e) => setTenantForm({ ...tenantForm, phone: e.target.value })} />
              <input className={input} type="email" placeholder="Email" value={tenantForm.email} onChange={(e) => setTenantForm({ ...tenantForm, email: e.target.value })} />
              <input className={input} placeholder="ID number" value={tenantForm.idNumber} onChange={(e) => setTenantForm({ ...tenantForm, idNumber: e.target.value })} />
              <button className={button} disabled={busy}>Add tenant</button>
            </form>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="p-2">Name</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">ID</th>
                    <th className="p-2">Renting</th>
                  </tr>
                </thead>
                <tbody>
                  {tenants.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="p-2 font-medium">{t.name}</td>
                      <td className="p-2">{t.phone ?? "-"}</td>
                      <td className="p-2">{t.idNumber ?? "-"}</td>
                      <td className="p-2">{t.leases.map((l) => `${l.unit.property.name} ${l.unit.label}`).join(", ") || "-"}</td>
                    </tr>
                  ))}
                  {tenants.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-3 text-secondary-500">No tenants yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === "leases" && (
          <div className="space-y-6">
            <form onSubmit={addLease} className="grid gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-3">
              <select
                className={input}
                required
                value={leaseForm.unitId}
                onChange={(e) => {
                  const unit = units.find((u) => u.id === e.target.value);
                  setLeaseForm({ ...leaseForm, unitId: e.target.value, monthlyRent: unit ? String(Number(unit.monthlyRent)) : "", depositAmount: unit ? String(Number(unit.depositAmount)) : "" });
                }}
              >
                <option value="">Vacant unit...</option>
                {vacantUnits.map((u) => (
                  <option key={u.id} value={u.id}>{u.property.name} - {u.label}</option>
                ))}
              </select>
              <select className={input} required value={leaseForm.tenantId} onChange={(e) => setLeaseForm({ ...leaseForm, tenantId: e.target.value })}>
                <option value="">Tenant...</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              <input className={input} type="date" required value={leaseForm.startDate} onChange={(e) => setLeaseForm({ ...leaseForm, startDate: e.target.value })} />
              <input className={input} type="number" min="0" step="0.01" placeholder="Monthly rent" value={leaseForm.monthlyRent} onChange={(e) => setLeaseForm({ ...leaseForm, monthlyRent: e.target.value })} />
              <input className={input} type="number" min="0" step="0.01" placeholder="Deposit" value={leaseForm.depositAmount} onChange={(e) => setLeaseForm({ ...leaseForm, depositAmount: e.target.value })} />
              <div className="flex gap-2">
                <input className={input} type="number" min="1" max="28" title="Day of the month rent is due" value={leaseForm.dueDay} onChange={(e) => setLeaseForm({ ...leaseForm, dueDay: e.target.value })} />
                <button className={button} disabled={busy}>Start lease</button>
              </div>
            </form>
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-secondary-500">
                  <tr>
                    <th className="p-2">Unit</th>
                    <th className="p-2">Tenant</th>
                    <th className="p-2">Since</th>
                    <th className="p-2">Rent</th>
                    <th className="p-2">Due day</th>
                    <th className="p-2">Status</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {leases.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="p-2">{l.unit.property.name} {l.unit.label}</td>
                      <td className="p-2 font-medium">{l.tenant.name}</td>
                      <td className="p-2">{day(l.startDate)}</td>
                      <td className="p-2">{money(l.monthlyRent)}</td>
                      <td className="p-2">{l.dueDay}</td>
                      <td className="p-2">{l.status === "ENDED" && l.endedAt ? `Ended ${day(l.endedAt)}` : l.status}</td>
                      <td className="p-2 text-right">
                        {l.status === "ACTIVE" && (
                          <button onClick={() => endLease(l)} disabled={busy} className="rounded border border-border px-2 py-1 text-xs hover:bg-background">
                            End lease
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {leases.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-3 text-secondary-500">No leases yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
