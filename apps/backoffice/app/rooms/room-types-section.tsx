"use client";

import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPut, apiUploadFile, ApiError } from "../../lib/api";
import { shrinkPhoto } from "../../lib/resize-image";

interface Photo {
  id: string;
  url: string;
  sortOrder: number;
}
interface RoomType {
  id: string;
  name: string;
  description: string | null;
  amenities: string | null;
  pricePerNight: number;
  maxGuests: number;
  quantity: number;
  depositPercent: number;
  isListed: boolean;
  isActive: boolean;
  photos: Photo[];
}
interface Draft {
  name: string;
  description: string;
  amenities: string;
  pricePerNight: string;
  maxGuests: string;
  quantity: string;
  depositPercent: string;
  isListed: boolean;
}

const MAX_PHOTOS = 8;
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const input = "w-full rounded-md border border-border bg-surface p-2 text-sm";
const button = "rounded-md bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50";
const ghost = "rounded-md border border-border bg-surface px-3 py-2 text-sm hover:bg-secondary-500/10 disabled:opacity-50";
const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const empty: Draft = { name: "", description: "", amenities: "", pricePerNight: "", maxGuests: "2", quantity: "1", depositPercent: "30", isListed: true };

const draftOf = (r: RoomType): Draft => ({
  name: r.name,
  description: r.description ?? "",
  amenities: r.amenities ?? "",
  pricePerNight: String(r.pricePerNight),
  maxGuests: String(r.maxGuests),
  quantity: String(r.quantity),
  depositPercent: String(r.depositPercent),
  isListed: r.isListed,
});

/**
 * The kinds of room a hotel offers. Switch "Show on the marketplace" on and guests can find the room, see its photos and
 * book it with a deposit. Availability is worked out from how many rooms of the type you have and the bookings.
 */
export function RoomTypesSection() {
  const [types, setTypes] = useState<RoomType[] | null>(null);
  const [editing, setEditing] = useState<{ id: string | null; draft: Draft } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = (err: unknown, fallback: string) => setError(err instanceof ApiError ? err.message : fallback);
  async function load() {
    try {
      const rows = await apiGet<RoomType[]>("/hotel/room-types");
      setTypes(rows);
      setEditing((cur) => (cur?.id && !rows.some((r) => r.id === cur.id) ? null : cur));
    } catch (err) {
      fail(err, "Could not load your rooms.");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const { draft } = editing;
    setBusy(true);
    setError(null);
    setNotice(null);
    const body = {
      name: draft.name.trim(),
      description: draft.description.trim() || undefined,
      amenities: draft.amenities.trim() || undefined,
      pricePerNight: Number(draft.pricePerNight),
      maxGuests: Number(draft.maxGuests),
      quantity: Number(draft.quantity),
      depositPercent: Number(draft.depositPercent),
      isListed: draft.isListed,
    };
    try {
      const saved = editing.id ? await apiPut<RoomType>(`/hotel/room-types/${editing.id}`, body) : await apiPost<RoomType>("/hotel/room-types", body);
      setNotice(editing.id ? "Saved." : "Room type added. Add photos below - rooms with photos get far more bookings.");
      setEditing({ id: saved.id, draft: draftOf(saved) });
      await load();
    } catch (err) {
      fail(err, "Could not save the room type.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(room: RoomType) {
    if (!window.confirm(`Remove ${room.name}? If it has bookings it is hidden instead, so the history is kept.`)) return;
    setError(null);
    try {
      const result = await apiDelete<{ archived: boolean }>(`/hotel/room-types/${room.id}`);
      setNotice(result.archived ? `${room.name} has bookings, so it was hidden instead of erased.` : `${room.name} removed.`);
      setEditing(null);
      await load();
    } catch (err) {
      fail(err, "Could not remove it.");
    }
  }

  if (types === null) return <p className="text-sm text-secondary-500">{error ?? "Loading..."}</p>;
  const current = editing?.id ? types.find((t) => t.id === editing.id) : undefined;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-md bg-red-950 p-3 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-md bg-green-950 p-3 text-sm text-green-300">{notice}</p>}

      {editing ? (
        <div className="space-y-4 rounded-lg border border-border bg-surface p-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{editing.id ? "Edit room type" : "New room type"}</h2>
            <button className={ghost} onClick={() => setEditing(null)}>
              Back to list
            </button>
          </div>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              Name
              <input className={input} required minLength={2} maxLength={80} placeholder="e.g. Deluxe double, Family suite" value={editing.draft.name} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })} />
            </label>
            <label className="text-sm">
              Price per night (KES)
              <input className={input} required type="number" min={1} value={editing.draft.pricePerNight} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, pricePerNight: e.target.value } })} />
            </label>
            <label className="text-sm">
              How many of these rooms you have
              <input className={input} required type="number" min={1} max={500} value={editing.draft.quantity} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, quantity: e.target.value } })} />
            </label>
            <label className="text-sm">
              Sleeps (guests per room)
              <input className={input} required type="number" min={1} max={20} value={editing.draft.maxGuests} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, maxGuests: e.target.value } })} />
            </label>
            <label className="text-sm">
              Deposit paid online (% of the stay)
              <input className={input} required type="number" min={0} max={100} value={editing.draft.depositPercent} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, depositPercent: e.target.value } })} />
            </label>
            <label className="text-sm sm:col-span-2">
              What&apos;s included <span className="text-secondary-500">(separate with commas)</span>
              <input className={input} maxLength={400} placeholder="WiFi, Breakfast included, Hot shower, Parking" value={editing.draft.amenities} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, amenities: e.target.value } })} />
            </label>
            <label className="text-sm sm:col-span-2">
              Description
              <textarea className={input} rows={3} maxLength={1500} value={editing.draft.description} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, description: e.target.value } })} />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={editing.draft.isListed} onChange={(e) => setEditing({ ...editing, draft: { ...editing.draft, isListed: e.target.checked } })} />
              Show on the marketplace&apos;s Hotels page (guests can find and book it)
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button className={button} disabled={busy}>
                {editing.id ? "Save changes" : "Add room type"}
              </button>
              {current && (
                <button type="button" className={ghost} onClick={() => void remove(current)}>
                  Remove
                </button>
              )}
            </div>
            <p className="text-xs text-secondary-500 sm:col-span-2">Guests only see this once your online shop is live (Settings → Online Shop). The deposit is paid straight into your own M-Pesa account; you collect the rest at the hotel.</p>
          </form>
          {current && <PhotoManager room={current} onChanged={() => void load()} onError={(m) => setError(m)} />}
        </div>
      ) : (
        <>
          <button className={button} onClick={() => { setEditing({ id: null, draft: empty }); setError(null); setNotice(null); }}>
            Add a room type
          </button>
          {types.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-4 text-sm text-secondary-500">No rooms yet. Add the kinds of room you have, with a price, how many there are and photos.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {types.map((t) => (
                <div key={t.id} className={`flex gap-3 rounded-lg border border-border bg-surface p-3 ${t.isActive ? "" : "opacity-60"}`}>
                  {t.photos[0] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t.photos[0].url} alt="" className="h-20 w-20 shrink-0 rounded-md object-cover" />
                  ) : (
                    <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-md bg-secondary-500/10 text-center text-[10px] text-secondary-500">No photo</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{t.name}</p>
                    <p className="text-sm text-secondary-600">
                      {kes(t.pricePerNight)} a night · {t.quantity} room{t.quantity === 1 ? "" : "s"} · sleeps {t.maxGuests}
                    </p>
                    <p className="text-xs text-secondary-500">{!t.isActive ? "Hidden (has bookings)" : t.isListed ? "Shown on the marketplace" : "Not shown on the marketplace"}</p>
                    <button className={`${ghost} mt-2`} onClick={() => { setEditing({ id: t.id, draft: draftOf(t) }); setError(null); setNotice(null); }}>
                      Edit / photos
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function PhotoManager({ room, onChanged, onError }: { room: RoomType; onChanged: () => void; onError: (message: string) => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const photos = [...room.photos].sort((a, b) => a.sortOrder - b.sortOrder);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const chosen = Array.from(files).slice(0, MAX_PHOTOS - photos.length);
    for (const file of chosen) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return onError(`${file.name}: photos must be JPEG, PNG or WebP.`);
      if (file.size > MAX_ORIGINAL_BYTES) return onError(`${file.name}: that photo is too large.`);
    }
    setUploading(true);
    try {
      for (const original of chosen) {
        await apiUploadFile<Photo>(`/hotel/room-types/${room.id}/photos`, await shrinkPhoto(original));
      }
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    try {
      await action();
      onChanged();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : fallback);
    }
  };

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">Photos</h3>
      <p className="text-sm text-secondary-500">Up to {MAX_PHOTOS}. The first is the cover guests see in the list. Photos are made small automatically so they load fast on any network.</p>
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
                  <button className="rounded border border-border px-1.5 py-0.5" onClick={() => void run(() => apiPost(`/hotel/room-types/${room.id}/photos/${photo.id}/cover`, {}), "Could not change the cover photo.")}>
                    Make cover
                  </button>
                )}
                <button className="rounded border border-border px-1.5 py-0.5" onClick={() => void run(() => apiDelete(`/hotel/room-types/${room.id}/photos/${photo.id}`), "Could not remove the photo.")}>
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
