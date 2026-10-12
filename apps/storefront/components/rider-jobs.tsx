"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, deliverJob, listMyJobs, listOpenJobs, pickUpJob, quoteJob, withdrawQuote } from "../lib/api";
import { displayPhone, kes } from "../lib/format";
import type { MyJob, OpenJob } from "../lib/types";

const POLL_MS = 20_000;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" });
const field = "mt-1 w-full rounded-md border border-border bg-surface p-2 text-base";

/** An approved rider's work: deliveries they won (pick up, deliver with the buyer's code), and open jobs to quote on. */
export default function RiderJobs({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const [open, setOpen] = useState<OpenJob[] | null>(null);
  const [mine, setMine] = useState<MyJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, m] = await Promise.all([listOpenJobs(token), listMyJobs(token)]);
      setOpen(o);
      setMine(m);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof ApiError ? err.message : "Could not load your jobs.");
    }
  }, [token, onUnauthorized]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  const active = mine?.filter((j) => j.status !== "DELIVERED") ?? [];
  const finished = mine?.filter((j) => j.status === "DELIVERED") ?? [];

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-error-600">{error}</p>}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">My deliveries</h2>
        {!mine && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {mine && active.length === 0 && <p className="rounded-md border border-border bg-surface p-4 text-sm text-secondary-600">No deliveries right now. When a customer chooses your price, the job appears here.</p>}
        {active.map((job) => (
          <MyJobCard key={job.id} job={job} token={token} onChanged={() => void load()} onUnauthorized={onUnauthorized} />
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Jobs you can quote on</h2>
        {open && open.length === 0 && <p className="rounded-md border border-border bg-surface p-4 text-sm text-secondary-600">No open jobs right now. This page checks for new ones every few seconds.</p>}
        {open?.map((job) => (
          <OpenJobCard key={job.id} job={job} token={token} onChanged={() => void load()} onUnauthorized={onUnauthorized} />
        ))}
      </section>

      {finished.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Recently delivered</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface text-sm">
            {finished.map((j) => (
              <li key={j.id} className="flex justify-between gap-3 p-3">
                <span>
                  {j.shopName} · {j.dropoffSummary}
                </span>
                <span className="font-mono">{kes(j.cashCollected ?? j.agreedFee ?? 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function OpenJobCard({ job, token, onChanged, onUnauthorized }: { job: OpenJob; token: string; onChanged: () => void; onUnauthorized: () => void }) {
  const [fee, setFee] = useState(job.myQuote ? String(job.myQuote.fee) : "");
  const [eta, setEta] = useState(job.myQuote?.etaMinutes ? String(job.myQuote.etaMinutes) : "");
  const [note, setNote] = useState(job.myQuote?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof ApiError ? err.message : fallback);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  const live = job.myQuote && job.myQuote.status === "OFFERED";

  return (
    <article className="space-y-3 rounded-lg border border-border bg-surface p-4 text-sm">
      <div>
        <p className="font-semibold">{job.shopName}</p>
        <p className="text-secondary-600">
          Pick up: {job.pickupArea}
          <br />
          Deliver to: {job.dropoffSummary}
          <br />
          {job.itemCount} {job.itemCount === 1 ? "item" : "items"} · quote before {time(job.quoteDeadline)}
        </p>
      </div>
      {live && (
        <p className="rounded-md bg-success-50 p-2 text-success-700">
          Your price: <strong>{kes(job.myQuote!.fee)}</strong>. Waiting for the customer to choose.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => quoteJob(token, job.id, { fee: Number(fee), etaMinutes: eta ? Number(eta) : undefined, note: note.trim() || undefined }), "Could not send your price.");
        }}
        className="space-y-2"
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            Your price (KES)
            <input required type="number" inputMode="numeric" min={20} max={10000} step={1} value={fee} onChange={(e) => setFee(e.target.value)} className={field} />
          </label>
          <label className="block">
            Minutes to arrive <span className="text-secondary-500">(optional)</span>
            <input type="number" inputMode="numeric" min={1} max={600} step={1} value={eta} onChange={(e) => setEta(e.target.value)} className={field} />
          </label>
        </div>
        <label className="block">
          Note for the customer <span className="text-secondary-500">(optional)</span>
          <input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
        {error && <p className="text-error-600">{error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={busy || !fee} className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
            {busy ? "Sending..." : live ? "Change my price" : "Send my price"}
          </button>
          {live && (
            <button type="button" disabled={busy} onClick={() => void run(() => withdrawQuote(token, job.id), "Could not withdraw.")} className="rounded-md border border-border px-4 py-2 hover:bg-secondary-100 disabled:opacity-50">
              Withdraw
            </button>
          )}
        </div>
      </form>
    </article>
  );
}

function MyJobCard({ job, token, onChanged, onUnauthorized }: { job: MyJob; token: string; onChanged: () => void; onUnauthorized: () => void }) {
  const [code, setCode] = useState("");
  const [cash, setCash] = useState(job.agreedFee !== null ? String(job.agreedFee) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized();
      else setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="space-y-3 rounded-lg border-2 border-primary-500 bg-surface p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold">
            {job.shopName} · order {job.orderNumber}
          </p>
          <p className="text-secondary-600">
            {job.itemCount} {job.itemCount === 1 ? "item" : "items"} · collect from {job.pickupArea}
          </p>
        </div>
        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-medium text-primary-700">{job.status === "ASSIGNED" ? "Go and collect" : "Out for delivery"}</span>
      </div>

      <div className="rounded-md bg-secondary-50 p-3 text-foreground">
        <p className="font-medium">{job.buyerName ?? "Customer"}</p>
        {job.buyerPhone && (
          <a href={`tel:+${job.buyerPhone}`} className="font-mono text-primary-600 underline">
            {displayPhone(job.buyerPhone)}
          </a>
        )}
        <p className="mt-1 whitespace-pre-line">{job.deliveryAddress}</p>
      </div>
      {job.agreedFee !== null && (
        <p>
          Collect <strong>{kes(job.agreedFee)}</strong> in cash from the customer for the delivery.
        </p>
      )}
      {error && <p className="text-error-600">{error}</p>}

      {job.status === "ASSIGNED" && (
        <button
          onClick={() => void run(() => pickUpJob(token, job.id), "Could not update the job.")}
          disabled={busy}
          className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {busy ? "Saving..." : "I have picked up the goods"}
        </button>
      )}

      {job.status === "PICKED_UP" &&
        (job.codeLocked ? (
          <p className="rounded-md bg-warning-50 p-3 text-warning-700">Too many wrong codes. Please ask the shop to settle this delivery.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => deliverJob(token, job.id, { code: code.trim(), cashCollected: cash === "" ? undefined : Number(cash) }), "Could not confirm the delivery.");
            }}
            className="space-y-2"
          >
            <label className="block">
              The 4-digit code from the customer
              <input required inputMode="numeric" maxLength={4} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className={`${field} text-center text-2xl tracking-[0.5em]`} />
            </label>
            <label className="block">
              Cash you collected (KES)
              <input type="number" inputMode="numeric" min={0} step={1} value={cash} onChange={(e) => setCash(e.target.value)} className={field} />
            </label>
            <button type="submit" disabled={busy || code.length !== 4} className="w-full rounded-md bg-success-600 px-4 py-3 font-semibold text-white hover:bg-success-700 disabled:opacity-50">
              {busy ? "Confirming..." : "Confirm delivery"}
            </button>
          </form>
        ))}
    </article>
  );
}
