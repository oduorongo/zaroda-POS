"use client";

import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, apiUploadFile, ApiError } from "../../lib/api";
import { shrinkPhoto } from "../../lib/resize-image";

interface UnitOption {
  id: string;
  label: string;
  monthlyRent: string;
  depositAmount: string;
  status: "VACANT" | "OCCUPIED";
  property: { id: string; name: string };
}

interface Photo {
  id: string;
  url: string;
  sortOrder: number;
}

type State = "UNPAID" | "LIVE" | "EXPIRED" | "PAUSED" | "BLOCKED";

interface Listing {
  id: string;
  unitId: string;
  unitLabel: string | null;
  propertyName: string | null;
  title: string;
  unitType: string;
  area: string;
  monthlyRent: number;
  depositAmount: number;
  description: string | null;
  contactName: string | null;
  contactPhone: string;
  isActive: boolean;
  state: State;
  paidUntil: string | null;
  blockedReason: string | null;
  feeKes: number;
  days: number;
  photos: Photo[];
}

const UNIT_TYPES: [string, string][] = [
  ["BEDSITTER", "Bedsitter"],
  ["SINGLE_ROOM", "Single room"],
  ["ONE_BEDROOM", "1 bedroom"],
  ["TWO_BEDROOM", "2 bedroom"],
  ["THREE_BEDROOM", "3 bedroom"],
  ["SHOP", "Shop"],
  ["OFFICE", "Office"],
  ["OTHER", "Other"],
];

const MAX_PHOTOS = 8;
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const POLL_EVERY_MS = 5_000;
const POLL_FOR_MS = 120_000;
const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const money = (v: number | string) => Number(v).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const daysLeft = (iso: string | null) => (iso ? Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)) : 0);
const paidTime = (l: Listing) => (l.paidUntil ? new Date(l.paidUntil).getTime() : 0);

const STATE_STYLE: Record<State, string> = {
  LIVE: "bg-green-600/15 text-green-600",
  PAUSED: "bg-secondary-500/15 text-secondary-500",
  EXPIRED: "bg-amber-500/15 text-amber-600",
  UNPAID: "bg-amber-500/15 text-amber-600",
  BLOCKED: "bg-red-500/15 text-red-500",
};
const STATE_LABEL: Record<State, string> = { LIVE: "Live", PAUSED: "Paused", EXPIRED: "Expired", UNPAID: "Not paid", BLOCKED: "Taken down" };
// Adverts the landlord can pay for: not paused (resume first) and not taken down by Zaroda.
const payable = (l: Listing) => l.state === "UNPAID" || l.state === "EXPIRED" || l.state === "LIVE";

function statusLine(l: Listing): string {
  switch (l.state) {
    case "LIVE":
      return `${daysLeft(l.paidUntil)} days left`;
    case "UNPAID":
      return `Not public yet - pay KES ${l.feeKes} to publish`;
    case "EXPIRED":
      return `Lapsed - pay KES ${l.feeKes} for ${l.days} more days`;
    case "PAUSED":
      return "Paused - not shown to the public";
    case "BLOCKED":
      return `Taken down by Zaroda: ${l.blockedReason ?? "please contact Zaroda"}`;
  }
}

interface Draft {
  title: string;
  unitType: string;
  area: string;
  monthlyRent: string;
  depositAmount: string;
  description: string;
  contactName: string;
  contactPhone: string;
}

const draftFor = (unit: UnitOption, listing?: Listing): Draft =>
  listing
    ? {
        title: listing.title,
        unitType: listing.unitType,
        area: listing.area,
        monthlyRent: String(listing.monthlyRent),
        depositAmount: String(listing.depositAmount),
        description: listing.description ?? "",
        contactName: listing.contactName ?? "",
        contactPhone: listing.contactPhone,
      }
    : {
        title: "",
        unitType: "BEDSITTER",
        area: "",
        monthlyRent: String(Number(unit.monthlyRent)),
        depositAmount: String(Number(unit.depositAmount)),
        description: "",
        contactName: "",
        contactPhone: "",
      };

/**
 * Advertise empty units on the marketplace's "Houses to let" page. Contact-only: house-hunters call or WhatsApp the
 * number given here. Each advert costs KES 100 for 30 days, paid by M-Pesa; the public never sees the building's real
 * address, only the estate/town typed below.
 */
export function ListingsSection({ units, onChanged }: { units: UnitOption[]; onChanged: () => void }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ unit: UnitOption; listing?: Listing } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  // Adverts ticked to be paid for with ONE M-Pesa prompt (KES 100 each).
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  async function load(): Promise<Listing[] | null> {
    try {
      const rows = await apiGet<Listing[]>("/rental/listings");
      setListings(rows);
      // Keep the open editor in step (state, paid time, photos) after a payment or a change.
      setEditing((cur) => {
        const fresh = cur?.listing ? rows.find((l) => l.id === cur.listing?.id) : undefined;
        return cur && fresh ? { ...cur, listing: fresh } : cur;
      });
      return rows;
    } catch (err) {
      fail(err, "Could not load your adverts.");
      return null;
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const byUnit = new Map((listings ?? []).map((l) => [l.unitId, l]));
  const vacant = units.filter((u) => u.status === "VACANT");
  // Adverts whose unit has since been let are kept (paused) so they can be resumed when it falls vacant again.
  const orphaned = (listings ?? []).filter((l) => !vacant.some((u) => u.id === l.unitId));

  function startEdit(unit: UnitOption, listing?: Listing) {
    setEditing({ unit, listing });
    setDraft(draftFor(unit, listing));
    setError(null);
    setNotice(null);
  }

  async function run(key: string, action: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (done) setNotice(done);
      await load();
      onChanged();
    } catch (err) {
      fail(err, "That did not work. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing || !draft) return;
    const { unit } = editing;
    await run(
      `save-${unit.id}`,
      async () => {
        const saved = await apiPut<Listing>(`/rental/units/${unit.id}/listing`, {
          title: draft.title,
          unitType: draft.unitType,
          area: draft.area,
          monthlyRent: Number(draft.monthlyRent),
          depositAmount: Number(draft.depositAmount || 0),
          description: draft.description || undefined,
          contactName: draft.contactName || undefined,
          contactPhone: draft.contactPhone,
        });
        // Stay on the advert so photos can be added and the fee paid straight away.
        setEditing({ unit, listing: saved });
      },
      editing.listing ? "Saved." : "Saved. Add photos below, then pay to publish - adverts with photos get far more calls.",
    );
  }

  if (listings === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;

  const payBox = (targets: Listing[], close?: () => void) => (
    <PayBox
      listings={targets}
      refresh={async () => {
        const rows = await load();
        return rows ? rows.filter((l) => targets.some((t) => t.id === l.id)) : null;
      }}
      onDone={(message) => {
        setPayingId(null);
        setBulkOpen(false);
        setSelected(new Set());
        setNotice(message);
        onChanged();
      }}
      onCancel={close}
      onError={(message) => setError(message)}
    />
  );

  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const payableListings = vacant.map((u) => byUnit.get(u.id)).filter((l): l is Listing => !!l && payable(l));
  const needPayment = payableListings.filter((l) => l.state !== "LIVE");
  const chosen = payableListings.filter((l) => selected.has(l.id));

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-600">
        Advertise your empty units on the Zaroda Marketplace under <strong>Houses to let</strong>. House-hunters see your photos, rent and
        estate, then call or WhatsApp the number you give. Your exact address is never shown. <strong>Each advert costs KES 100 for 30 days</strong>,
        paid by M-Pesa. Advertising several units? Tick them and pay for all of them with one M-Pesa prompt. Pay again before it ends to add another 30 days. An advert switches off by itself when you give the unit to a tenant.
      </div>

      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

      {editing && draft ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">
              {editing.unit.property.name} - {editing.unit.label}
            </h2>
            <button className={ghost} onClick={() => setEditing(null)}>
              Back to list
            </button>
          </div>

          {editing.listing && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[editing.listing.state]}`}>{STATE_LABEL[editing.listing.state]}</span>
                <span className="text-sm text-secondary-500">{statusLine(editing.listing)}</span>
              </div>
              {payable(editing.listing) && payBox([editing.listing])}
              {editing.listing.state === "BLOCKED" && <p className="rounded-md bg-red-950 p-2 text-sm text-red-300">{statusLine(editing.listing)}</p>}
            </div>
          )}

          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              Headline
              <input className={input} required minLength={3} maxLength={80} placeholder="e.g. Spacious bedsitter near the stage" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label className="text-sm">
              Type
              <select className={input} value={draft.unitType} onChange={(e) => setDraft({ ...draft, unitType: e.target.value })}>
                {UNIT_TYPES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              Estate / town
              <input className={input} required maxLength={80} placeholder="e.g. Kasarani, Nairobi" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })} />
            </label>
            <label className="text-sm">
              Rent per month (KES)
              <input className={input} required type="number" min={1} value={draft.monthlyRent} onChange={(e) => setDraft({ ...draft, monthlyRent: e.target.value })} />
            </label>
            <label className="text-sm">
              Deposit (KES)
              <input className={input} type="number" min={0} value={draft.depositAmount} onChange={(e) => setDraft({ ...draft, depositAmount: e.target.value })} />
            </label>
            <label className="text-sm sm:col-span-2">
              Description <span className="text-secondary-500">(water, security, parking, floor, nearby stage...)</span>
              <textarea className={input} rows={4} maxLength={1000} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="text-sm">
              Contact name <span className="text-secondary-500">(optional)</span>
              <input className={input} maxLength={60} value={draft.contactName} onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
            </label>
            <label className="text-sm">
              Phone / WhatsApp
              <input className={input} required inputMode="tel" placeholder="0712 345 678" value={draft.contactPhone} onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
            </label>
            <div className="sm:col-span-2">
              <button className={button} disabled={busy !== null}>
                {editing.listing ? "Save changes" : "Save advert"}
              </button>
              {!editing.listing && <p className="mt-1 text-xs text-secondary-500">You pay KES 100 after saving, once you have added photos.</p>}
            </div>
          </form>

          {editing.listing && (
            <PhotoManager
              listing={editing.listing}
              onChange={(photos) => setEditing((cur) => (cur?.listing ? { ...cur, listing: { ...cur.listing, photos } } : cur))}
              onSaved={() => void load()}
              onError={(message) => setError(message)}
            />
          )}

          {editing.listing && editing.listing.state !== "BLOCKED" && (
            <CopyPanel
              listing={editing.listing}
              candidates={vacant.filter((u) => u.id !== editing.unit.id && !byUnit.has(u.id))}
              onCopied={async (result) => {
                setSelected(new Set(result.createdIds));
                setBulkOpen(false);
                setEditing(null);
                await load();
                const skippedNote = result.skipped.length > 0 ? ` ${result.skipped.length} unit${result.skipped.length === 1 ? " was" : "s were"} skipped.` : "";
                setNotice(
                  `Created ${result.created} advert${result.created === 1 ? "" : "s"}. They are not public until paid for - they are ticked below, so you can pay for all of them at once.${skippedNote}`,
                );
                onChanged();
              }}
              onError={(message) => setError(message)}
            />
          )}
        </div>
      ) : (
        <>
          {vacant.length === 0 && orphaned.length === 0 && (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">
              You have no empty units. When a unit becomes vacant it shows up here, ready to advertise.
            </p>
          )}
          {payableListings.length > 1 && (
            <div className="space-y-2 rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">Pay for several adverts at once</span>
                {needPayment.length > 1 && (
                  <button className={ghost} onClick={() => setSelected(new Set(needPayment.map((l) => l.id)))}>
                    Select all that need payment ({needPayment.length})
                  </button>
                )}
                {selected.size > 0 && (
                  <button className={ghost} onClick={() => { setSelected(new Set()); setBulkOpen(false); }}>
                    Clear
                  </button>
                )}
              </div>
              {chosen.length > 0 && !bulkOpen && (
                <button className={button} onClick={() => setBulkOpen(true)}>
                  Pay KES {money(chosen.reduce((sum, l) => sum + l.feeKes, 0))} for {chosen.length} {chosen.length === 1 ? "advert" : "adverts"}
                </button>
              )}
              {chosen.length > 0 && bulkOpen && payBox(chosen, () => setBulkOpen(false))}
              {chosen.length === 0 && <p className="text-xs text-secondary-500">Tick the adverts you want to pay for on the cards below.</p>}
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {vacant.map((unit) => {
              const listing = byUnit.get(unit.id);
              return (
                <div key={unit.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                  {listing && payable(listing) && payableListings.length > 1 && (
                    <label className="flex items-center gap-2 text-xs text-secondary-500">
                      <input type="checkbox" checked={selected.has(listing.id)} onChange={() => { toggle(listing.id); setBulkOpen(false); }} />
                      Tick to pay together with others
                    </label>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {unit.property.name} - {unit.label}
                      </p>
                      <p className="text-xs text-secondary-500">KES {money(unit.monthlyRent)} a month</p>
                    </div>
                    {listing && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[listing.state]}`}>{STATE_LABEL[listing.state]}</span>}
                  </div>
                  {listing ? (
                    <>
                      <div className="flex items-center gap-2">
                        {listing.photos[0] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={listing.photos[0].url} alt="" className="h-14 w-14 rounded-md object-cover" />
                        ) : (
                          <span className="flex h-14 w-14 items-center justify-center rounded-md bg-secondary-500/10 text-center text-[10px] text-secondary-500">No photo</span>
                        )}
                        <div className="min-w-0 text-sm">
                          <p className="truncate font-medium">{listing.title}</p>
                          <p className="text-xs text-secondary-500">{statusLine(listing)}</p>
                        </div>
                      </div>
                      {payingId === listing.id && payBox([listing], () => setPayingId(null))}
                      <div className="flex flex-wrap gap-2">
                        {payable(listing) && payingId !== listing.id && (
                          <button className={listing.state === "LIVE" ? ghost : button} disabled={busy !== null} onClick={() => setPayingId(listing.id)}>
                            {listing.state === "LIVE" ? `Add ${listing.days} days (KES ${listing.feeKes})` : `Pay KES ${listing.feeKes} to ${listing.state === "UNPAID" ? "publish" : "renew"}`}
                          </button>
                        )}
                        {listing.state === "PAUSED" && (
                          <button className={button} disabled={busy !== null} onClick={() => void run(`r-${listing.id}`, () => apiPatch(`/rental/listings/${listing.id}`, { isActive: true }), "Advert resumed.")}>
                            Resume
                          </button>
                        )}
                        {listing.state === "LIVE" && (
                          <button className={ghost} disabled={busy !== null} onClick={() => void run(`p-${listing.id}`, () => apiPatch(`/rental/listings/${listing.id}`, { isActive: false }), "Advert paused.")}>
                            Pause
                          </button>
                        )}
                        <button className={ghost} onClick={() => startEdit(unit, listing)}>
                          Edit / photos
                        </button>
                        <button
                          className={ghost}
                          disabled={busy !== null}
                          onClick={() => window.confirm("Remove this advert and its photos?") && void run(`d-${listing.id}`, () => apiDelete(`/rental/listings/${listing.id}`), "Advert removed.")}
                        >
                          Remove
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className={button} onClick={() => startEdit(unit)}>
                      Advertise this unit
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {orphaned.length > 0 && (
            <p className="text-xs text-secondary-500">
              {orphaned.length} older {orphaned.length === 1 ? "advert is" : "adverts are"} paused because {orphaned.length === 1 ? "its unit is" : "their units are"} now let. They return here if the unit falls vacant again.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const PHONE_KEY = "zaroda:advert-pay-phone";
const readPhone = () => {
  try {
    return localStorage.getItem(PHONE_KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * Pays KES 100 per advert (30 days each) with ONE M-Pesa prompt, for one advert or several. Sends the prompt, then watches
 * the adverts (free reads) until every payment lands; "I've paid - check now" is the rate-limited backup if it is slow.
 */
function PayBox({
  listings,
  refresh,
  onDone,
  onCancel,
  onError,
}: {
  listings: Listing[];
  refresh: () => Promise<Listing[] | null>;
  onDone: (message: string) => void;
  onCancel?: () => void;
  onError: (message: string) => void;
}) {
  const total = listings.reduce((sum, l) => sum + l.feeKes, 0);
  const many = listings.length > 1;
  const [phone, setPhone] = useState("");
  const [stage, setStage] = useState<"idle" | "sending" | "waiting" | "slow">("idle");
  const [hint, setHint] = useState<string | null>(null);
  const before = useRef<Map<string, number>>(new Map());
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => setPhone(readPhone()), []);
  useEffect(() => () => stopPolling(), []);

  function stopPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  async function landed(): Promise<boolean> {
    const fresh = await refresh();
    if (fresh && listings.every((l) => (fresh.find((f) => f.id === l.id) ? paidTime(fresh.find((f) => f.id === l.id) as Listing) : 0) > (before.current.get(l.id) ?? 0))) {
      stopPolling();
      const first = fresh.find((f) => f.id === listings[0].id);
      onDone(many ? `Payment received. ${listings.length} adverts are live for 30 days.` : `Payment received. Your advert is live for ${daysLeft(first?.paidUntil ?? null)} days.`);
      return true;
    }
    return false;
  }

  function startPolling() {
    stopPolling();
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      void (async () => {
        if (await landed()) return;
        if (Date.now() - startedAt > POLL_FOR_MS) {
          stopPolling();
          setStage("slow");
        }
      })();
    }, POLL_EVERY_MS);
  }

  async function pay() {
    setStage("sending");
    setHint(null);
    onError("");
    before.current = new Map(listings.map((l) => [l.id, paidTime(l)]));
    try {
      if (many) await apiPost("/rental/listings/pay", { listingIds: listings.map((l) => l.id), phone });
      else await apiPost(`/rental/listings/${listings[0].id}/pay`, { phone });
      try {
        localStorage.setItem(PHONE_KEY, phone);
      } catch {
        /* remembering the number is only a convenience */
      }
      setStage("waiting");
      startPolling();
    } catch (err) {
      setStage("idle");
      onError(err instanceof ApiError ? err.message : "Could not start the payment.");
    }
  }

  async function checkNow() {
    setHint(null);
    try {
      const result = await apiPost<{ result: string }>(`/rental/listings/${listings[0].id}/pay/check`, {});
      if (await landed()) return;
      setHint(result.result === "unavailable" ? "We could not check just now. Try again in a few minutes." : "Not received yet. If you have entered your PIN, wait a moment and check again.");
    } catch (err) {
      setHint(err instanceof ApiError ? err.message : "Could not check the payment.");
    }
  }

  if (stage === "waiting" || stage === "slow") {
    return (
      <div className="space-y-2 rounded-md bg-primary-600/10 p-3 text-sm">
        <p className="font-medium">Check your phone and enter your M-Pesa PIN to pay KES {money(total)}.</p>
        <p className="text-xs text-secondary-500">{stage === "waiting" ? "Waiting for the payment..." : "Still nothing yet."} This screen updates by itself.</p>
        {hint && <p className="text-xs text-amber-600">{hint}</p>}
        <div className="flex flex-wrap gap-2">
          {stage === "slow" && (
            <button className={button} onClick={() => void checkNow()}>
              I&apos;ve paid - check now
            </button>
          )}
          <button
            className={ghost}
            onClick={() => {
              stopPolling();
              setStage("idle");
            }}
          >
            {stage === "slow" ? "Send the prompt again" : "Cancel"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-md bg-secondary-500/10 p-3">
      <label className="block text-sm">
        M-Pesa number to pay KES {money(total)} {many ? `(${listings.length} adverts x KES ${listings[0].feeKes}, 30 days each)` : `(${listings[0].days} days)`}
        <input className={input} inputMode="tel" placeholder="0712 345 678" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={stage === "sending" || phone.trim().length < 9} onClick={() => void pay()}>
          {stage === "sending" ? "Sending..." : `Pay KES ${money(total)} with M-Pesa`}
        </button>
        {onCancel && (
          <button className={ghost} onClick={onCancel}>
            Close
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Saves retyping when several units are alike: creates an advert for each ticked empty unit with this advert's headline,
 * type, estate, description and contact. Photos are not copied (each unit looks different). The copies start unpaid.
 */
function CopyPanel({
  listing,
  candidates,
  onCopied,
  onError,
}: {
  listing: Listing;
  candidates: UnitOption[];
  onCopied: (result: { createdIds: string[]; created: number; skipped: { unitId: string; reason: string }[] }) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [useOwnRent, setUseOwnRent] = useState(true);
  const [busy, setBusy] = useState(false);

  if (candidates.length === 0) return null;

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function copy() {
    setBusy(true);
    onError("");
    try {
      const result = await apiPost<{ createdIds: string[]; created: number; skipped: { unitId: string; reason: string }[] }>(`/rental/listings/${listing.id}/copy`, {
        unitIds: [...picked],
        useOwnRent,
      });
      await onCopied(result);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not create the adverts.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Copy these details to your other empty units</h3>
      <p className="text-sm text-secondary-500">
        Creates an advert for each unit you tick, with the same headline, type, estate, description and contact as this one, so you do not retype them. Photos are not copied, because each unit looks different. Save your changes above first. The new adverts start unpaid - you pay for them all at once afterwards.
      </p>
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" className={ghost} onClick={() => setPicked(new Set(candidates.map((u) => u.id)))}>
          Select all ({candidates.length})
        </button>
        {picked.size > 0 && (
          <button type="button" className={ghost} onClick={() => setPicked(new Set())}>
            Clear
          </button>
        )}
      </div>
      <div className="grid max-h-64 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-2">
        {candidates.map((u) => (
          <label key={u.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={picked.has(u.id)} onChange={() => toggle(u.id)} />
            <span className="truncate">
              {u.property.name} - {u.label} <span className="text-secondary-500">(KES {money(u.monthlyRent)})</span>
            </span>
          </label>
        ))}
      </div>
      <div className="space-y-1 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" checked={useOwnRent} onChange={() => setUseOwnRent(true)} /> Use each unit&apos;s own rent and deposit
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={!useOwnRent} onChange={() => setUseOwnRent(false)} /> Use this advert&apos;s rent (KES {money(listing.monthlyRent)}) and deposit (KES {money(listing.depositAmount)}) for all
        </label>
      </div>
      <button className={button} disabled={busy || picked.size === 0} onClick={() => void copy()}>
        {busy ? "Creating..." : picked.size === 0 ? "Create adverts" : `Create ${picked.size} advert${picked.size === 1 ? "" : "s"}`}
      </button>
    </div>
  );
}

/** Photos of one advert: shrunk on the phone before upload, with a camera button, and a choice of cover photo. */
function PhotoManager({
  listing,
  onChange,
  onSaved,
  onError,
}: {
  listing: Listing;
  onChange: (photos: Photo[]) => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photos = [...listing.photos].sort((a, b) => a.sortOrder - b.sortOrder);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    for (const file of chosen) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return onError(`${file.name}: photos must be JPEG, PNG or WebP.`);
      if (file.size > MAX_ORIGINAL_BYTES) return onError(`${file.name}: that photo is too large.`);
    }
    setUploading(true);
    let current = photos;
    try {
      for (const original of chosen) {
        const file = await shrinkPhoto(original);
        const photo = await apiUploadFile<Photo>(`/rental/listings/${listing.id}/photos`, file);
        current = [...current, photo];
        onChange(current);
      }
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  async function makeCover(photo: Photo) {
    try {
      onChange(await apiPost<Photo[]>(`/rental/listings/${listing.id}/photos/${photo.id}/cover`, {}));
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not change the cover photo.");
    }
  }

  async function remove(photo: Photo) {
    try {
      await apiDelete(`/rental/listings/${listing.id}/photos/${photo.id}`);
      onChange(photos.filter((p) => p.id !== photo.id));
      onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "Could not remove the photo.");
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Photos</h3>
      <p className="text-sm text-secondary-500">Up to {MAX_PHOTOS}. The first is the cover shown in the list. Photos are made small automatically so they load fast on any network.</p>
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo, i) => (
            <div key={photo.id} className="space-y-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={`Photo ${i + 1}`} className="aspect-square w-full rounded-md object-cover" />
              <div className="flex gap-1 text-xs">
                {i === 0 ? (
                  <span className="rounded bg-primary-600/15 px-1.5 py-0.5 text-primary-600">Cover</span>
                ) : (
                  <button className="rounded border border-border px-1.5 py-0.5" onClick={() => void makeCover(photo)}>
                    Make cover
                  </button>
                )}
                <button className="rounded border border-border px-1.5 py-0.5" onClick={() => void remove(photo)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {photos.length < MAX_PHOTOS && (
        <div className="flex flex-wrap gap-2">
          <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
          <input ref={cameraInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void upload(e.target.files)} />
          <button className={ghost} disabled={uploading} onClick={() => cameraInput.current?.click()}>
            {uploading ? "Uploading..." : "Take photo"}
          </button>
          <button className={ghost} disabled={uploading} onClick={() => fileInput.current?.click()}>
            Add photos
          </button>
        </div>
      )}
    </div>
  );
}
