"use client";

import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, LoadingState } from "@zaroda/ui";
import { ApiError } from "../../../lib/api";
import { TeamShell } from "../../../components/team-shell";
import { teamGet, teamPost, type TeamMe, type TeamRider } from "../../../lib/team-api";

const VEHICLES = [
  ["BODA", "Boda boda"],
  ["TUK_TUK", "Tuk tuk"],
  ["VEHICLE", "Vehicle"],
] as const;
const STATUS = {
  PENDING: { label: "Waiting for Zaroda approval", variant: "warning" },
  APPROVED: { label: "Approved", variant: "success" },
  SUSPENDED: { label: "Suspended", variant: "error" },
} as const;

const inputClass = "mt-1 w-full rounded-md border border-border bg-background p-2";

function RidersBody({ me }: { me: TeamMe }) {
  const [riders, setRiders] = useState<TeamRider[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [vehicleType, setVehicleType] = useState("BODA");
  const [plateNumber, setPlateNumber] = useState("");
  const [area, setArea] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState<{ name: string; phone: string; pin: string } | null>(null);

  async function load() {
    try {
      setRiders(await teamGet<TeamRider[]>("/riders"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load riders.");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const created = await teamPost<{ temporaryPin: string }>("/riders", {
        fullName: fullName.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        phone: phone.trim(),
        vehicleType,
        ...(plateNumber.trim() ? { plateNumber: plateNumber.trim() } : {}),
        ...(area.trim() ? { area: area.trim() } : {}),
      });
      setDone({ name: fullName.trim(), phone: phone.trim(), pin: created.temporaryPin });
      setShowForm(false);
      setFullName("");
      setEmail("");
      setPhone("");
      setPlateNumber("");
      setArea("");
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Could not sign the rider up.");
    } finally {
      setBusy(false);
    }
  }

  const isLeader = me.agent.role === "LEADER";

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{isLeader ? "Your team's riders" : "Your riders"}</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Sign up a rider"}</Button>
      </div>

      {done && (
        <div className="rounded-lg border border-success-600/40 bg-success-50 p-4 text-sm">
          <p className="font-semibold">{done.name} is signed up.</p>
          <p className="mt-1">
            Their PIN is <span className="font-mono text-lg font-bold tracking-widest">{done.pin}</span> - tell them now, it is shown only once.
          </p>
          <p className="mt-1">Zaroda will approve them. They then sign in at shop.zarodashop.com/rider with their phone number ({done.phone}) and this PIN. They can change the PIN after signing in.</p>
          <Button size="sm" variant="secondary" className="mt-2" onClick={() => setDone(null)}>
            OK
          </Button>
        </div>
      )}

      {showForm && (
        <form onSubmit={add} className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              Full name
              <input required className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </label>
            <label className="text-sm">
              Email (optional)
              <input type="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className="text-sm">
              Phone
              <input required className={inputClass} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" />
            </label>
            <label className="text-sm">
              Vehicle
              <select className={inputClass} value={vehicleType} onChange={(e) => setVehicleType(e.target.value)}>
                {VEHICLES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Number plate (optional)
              <input className={inputClass} value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} />
            </label>
            <label className="text-sm">
              Area they work in (optional)
              <input className={inputClass} value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Milimani, Kisumu CBD" />
            </label>
          </div>
          <p className="text-xs text-secondary-500">The rider joins the shared pool and is credited to you. Zaroda approves riders before they can take deliveries.</p>
          {formError && <p className="text-sm text-error-600">{formError}</p>}
          <Button type="submit" disabled={busy || !fullName.trim() || !phone.trim()}>
            {busy ? "Signing up..." : "Sign up this rider"}
          </Button>
        </form>
      )}

      {!riders && !error && <LoadingState label="Loading riders..." />}
      {error && <p className="text-sm text-error-600">{error}</p>}
      {riders && riders.length === 0 && <EmptyState title="No riders yet" description="Sign up a rider and they will appear here." />}

      <ul className="space-y-3">
        {riders?.map((r) => (
          <li key={r.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{r.fullName ?? r.phone}</span>
              <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
            </div>
            <p className="text-sm text-secondary-500">
              {VEHICLES.find(([v]) => v === r.vehicleType)?.[1] ?? "No vehicle yet"}
              {r.phone ? ` · 0${r.phone.replace(/^254/, "")}` : ""}
              {r.area ? ` · ${r.area}` : ""} · signed up {new Date(r.createdAt).toLocaleDateString("en-KE")}
              {isLeader && r.onboardedBy ? ` · by ${r.onboardedBy.fullName}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function TeamRidersPage() {
  return <TeamShell active="riders">{(me) => <RidersBody me={me} />}</TeamShell>;
}
