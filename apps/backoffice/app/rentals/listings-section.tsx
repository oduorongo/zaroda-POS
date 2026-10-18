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
  state: "LIVE" | "PAUSED" | "EXPIRED";
  expiresAt: string;
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
const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const money = (v: number | string) => Number(v).toLocaleString("en-KE", { maximumFractionDigits: 0 });
const daysLeft = (iso: string) => Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));

const STATE_STYLE: Record<Listing["state"], string> = {
  LIVE: "bg-green-600/15 text-green-600",
  PAUSED: "bg-secondary-500/15 text-secondary-500",
  EXPIRED: "bg-amber-500/15 text-amber-600",
};

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
 * number given here. The public never sees the building's real address, only the estate/town typed below.
 */
export function ListingsSection({ units, onChanged }: { units: UnitOption[]; onChanged: () => void }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ unit: UnitOption; listing?: Listing } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);

  async function load() {
    try {
      setListings(await apiGet<Listing[]>("/rental/listings"));
    } catch (err) {
      fail(err, "Could not load your adverts.");
    }
  }
  useEffect(() => {
    void load();
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
        // Stay on the advert so photos can be added straight away.
        setEditing({ unit, listing: saved });
      },
      "Saved. Add photos below - adverts with photos get far more calls.",
    );
  }

  if (listings === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface p-3 text-sm text-secondary-600">
        Advertise your empty units on the Zaroda Marketplace under <strong>Houses to let</strong>. House-hunters see your photos, rent and
        estate, then call or WhatsApp the number you give. Your exact address is never shown. An advert stays up for 30 days; tap{" "}
        <strong>Still available</strong> to keep it going, and it switches off by itself when you give the unit to a tenant.
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
                {editing.listing ? "Save changes" : "Publish advert"}
              </button>
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
        </div>
      ) : (
        <>
          {vacant.length === 0 && orphaned.length === 0 && (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">
              You have no empty units. When a unit becomes vacant it shows up here, ready to advertise.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            {vacant.map((unit) => {
              const listing = byUnit.get(unit.id);
              return (
                <div key={unit.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {unit.property.name} - {unit.label}
                      </p>
                      <p className="text-xs text-secondary-500">KES {money(unit.monthlyRent)} a month</p>
                    </div>
                    {listing && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_STYLE[listing.state]}`}>{listing.state === "LIVE" ? "Live" : listing.state === "PAUSED" ? "Paused" : "Expired"}</span>}
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
                          <p className="text-xs text-secondary-500">
                            {listing.state === "LIVE" ? `${daysLeft(listing.expiresAt)} days left` : listing.state === "EXPIRED" ? "Lapsed - tap Still available" : "Not shown to the public"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {listing.state === "LIVE" && (
                          <button className={ghost} disabled={busy !== null} onClick={() => void run(`c-${listing.id}`, () => apiPost(`/rental/listings/${listing.id}/confirm`, {}), "Great - it stays up for another 30 days.")}>
                            Still available
                          </button>
                        )}
                        {listing.state === "EXPIRED" && (
                          <button className={button} disabled={busy !== null} onClick={() => void run(`r-${listing.id}`, () => apiPatch(`/rental/listings/${listing.id}`, { isActive: true }), "Back up for 30 days.")}>
                            Still available
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
              {orphaned.length} older {orphaned.length === 1 ? "advert is" : "adverts are"} paused because {orphaned.length === 1 ? "its unit is" : "their units are"} now let. They return here if the unit falls vacant.
            </p>
          )}
        </>
      )}
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
