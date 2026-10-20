"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getRiderMe, setRiderPin, updateRiderMe } from "../lib/api";
import type { Rider, VehicleType } from "../lib/types";
import RiderJobs from "./rider-jobs";
import RiderSignIn from "./rider-signin";

const TOKEN_KEY = "zaroda_rider_token";

const VEHICLES: { value: VehicleType; label: string }[] = [
  { value: "BODA", label: "Boda boda (motorbike)" },
  { value: "TUK_TUK", label: "Tuk tuk" },
  { value: "VEHICLE", label: "Vehicle (car, pickup, van)" },
];

// Browser storage can be unavailable (private windows, blocked site data) - the page then just asks you to sign in each visit.
const readToken = () => {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (token: string | null) => {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* nothing to do */
  }
};

/** Deliver with Zaroda: sign in by phone number and PIN, fill in your details, wait for approval. */
export default function RiderPortal() {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [rider, setRider] = useState<Rider | null>(null);

  const signOut = useCallback(() => {
    writeToken(null);
    setToken(null);
    setRider(null);
  }, []);

  useEffect(() => {
    const saved = readToken();
    if (!saved) {
      setReady(true);
      return;
    }
    getRiderMe(saved)
      .then((me) => {
        setToken(saved);
        setRider(me);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) writeToken(null);
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <p className="py-10 text-center text-secondary-500">Loading...</p>;

  if (!token || !rider) {
    return (
      <RiderSignIn
        onSignedIn={(accessToken, me) => {
          writeToken(accessToken);
          setToken(accessToken);
          setRider(me);
        }}
      />
    );
  }

  return <Profile token={token} rider={rider} onChange={setRider} onSignOut={signOut} />;
}

function StatusBanner({ rider }: { rider: Rider }) {
  if (rider.status === "SUSPENDED") {
    return (
      <div className="rounded-md border border-error-600/40 bg-error-50 p-4 text-sm text-error-900">
        <p className="font-semibold">Your account is suspended</p>
        <p className="mt-1">You can&apos;t take deliveries right now. Please contact {rider.kind === "SHOP" ? "the shop you ride for" : "Zaroda"} to find out why.</p>
      </div>
    );
  }
  if (rider.status === "APPROVED") {
    return (
      <div className="rounded-md border border-success-600/40 bg-success-50 p-4 text-sm text-success-900">
        <p className="font-semibold">You&apos;re approved</p>
        <p className="mt-1">
          {rider.kind === "SHOP" ? "You ride for a shop that added you." : "You're in the Zaroda rider pool."}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-warning-600/40 bg-warning-50 p-4 text-sm text-warning-900">
      <p className="font-semibold">{rider.profileComplete ? "Waiting for approval" : "Finish your details to apply"}</p>
      <p className="mt-1">
        {rider.profileComplete
          ? "Zaroda is checking your details. You'll be able to take deliveries once you're approved."
          : "Fill in your name, phone number and vehicle below, then save. Zaroda will then review your application."}
      </p>
    </div>
  );
}

function Profile({ token, rider, onChange, onSignOut }: { token: string; rider: Rider; onChange: (r: Rider) => void; onSignOut: () => void }) {
  const [fullName, setFullName] = useState(rider.fullName ?? "");
  const [phone, setPhone] = useState(rider.phone ? rider.phone.replace(/^254/, "0") : "");
  const [vehicleType, setVehicleType] = useState<VehicleType | "">(rider.vehicleType ?? "");
  const [plateNumber, setPlateNumber] = useState(rider.plateNumber ?? "");
  const [area, setArea] = useState(rider.area ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await updateRiderMe(token, {
        fullName,
        phone,
        vehicleType: vehicleType || undefined,
        plateNumber,
        area,
      });
      onChange(updated);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSignOut();
      else setError(err instanceof ApiError ? err.message : "Could not save your details.");
    } finally {
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";

  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Your rider account</h1>
          <p className="text-sm text-secondary-500">{rider.phone ? rider.phone.replace(/^254/, "0") : rider.email}</p>
        </div>
        <button onClick={onSignOut} className="text-sm text-secondary-500 hover:text-foreground">
          Sign out
        </button>
      </div>

      <StatusBanner rider={rider} />

      {rider.status === "APPROVED" && <RiderJobs token={token} onUnauthorized={onSignOut} />}

      <form onSubmit={save} className="space-y-4 rounded-lg border border-border bg-surface p-6">
        <div>
          <label htmlFor="r-name" className="block text-sm font-medium">
            Full name
          </label>
          <input id="r-name" required minLength={2} maxLength={80} value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="r-phone" className="block text-sm font-medium">
            Phone number
          </label>
          <input id="r-phone" type="tel" inputMode="tel" required placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} className={field} />
          <p className="mt-1 text-xs text-secondary-500">Customers and shops call this number about deliveries.</p>
        </div>
        <div>
          <label htmlFor="r-vehicle" className="block text-sm font-medium">
            What do you ride or drive?
          </label>
          <select id="r-vehicle" required value={vehicleType} onChange={(e) => setVehicleType(e.target.value as VehicleType | "")} className={field}>
            <option value="">Choose...</option>
            {VEHICLES.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="r-plate" className="block text-sm font-medium">
            Number plate <span className="font-normal text-secondary-500">(optional)</span>
          </label>
          <input id="r-plate" maxLength={15} placeholder="KMFA 123A" value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="r-area" className="block text-sm font-medium">
            Where do you usually work? <span className="font-normal text-secondary-500">(optional)</span>
          </label>
          <input id="r-area" maxLength={120} placeholder="e.g. Milimani and Kisumu town" value={area} onChange={(e) => setArea(e.target.value)} className={field} />
        </div>
        {error && <p className="text-sm text-error-600">{error}</p>}
        {saved && <p className="text-sm text-success-600">Saved.</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? "Saving..." : "Save my details"}
        </button>
      </form>

      <PinBox token={token} rider={rider} onChange={onChange} onSignOut={onSignOut} />
    </div>
  );
}

function PinBox({ token, rider, onChange, onSignOut }: { token: string; rider: Rider; onChange: (r: Rider) => void; onSignOut: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      onChange(await setRiderPin(token, pin));
      setPin("");
      setMessage("Your PIN is saved. Sign in with your phone number and this PIN next time.");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onSignOut();
      else setError(err instanceof ApiError ? err.message : "Could not save your PIN.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-border bg-surface p-6">
      <h2 className="font-semibold">{rider.hasPin ? "Change my PIN" : "Set a PIN to sign in with your phone"}</h2>
      {!rider.phone && <p className="text-sm text-secondary-500">Save your phone number above first - you sign in with it and your PIN.</p>}
      <input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="new-password"
        maxLength={6}
        placeholder="4 to 6 numbers"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full rounded-md border border-border bg-surface p-3 text-center text-xl tracking-[0.4em]"
      />
      {error && <p className="text-sm text-error-600">{error}</p>}
      {message && <p className="text-sm text-success-600">{message}</p>}
      <button type="submit" disabled={busy || pin.length < 4 || !rider.phone} className="w-full rounded-md border border-border px-4 py-3 font-semibold hover:bg-secondary-500/10 disabled:opacity-50">
        {busy ? "Saving..." : "Save PIN"}
      </button>
    </form>
  );
}
