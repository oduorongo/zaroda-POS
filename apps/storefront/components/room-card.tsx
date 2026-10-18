"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Users } from "lucide-react";
import { ApiError, createBooking } from "../lib/api";
import { kes } from "../lib/format";
import type { RoomOffer } from "../lib/types";
import HouseGallery from "./house-gallery";

const BOOKINGS_KEY = "zaroda_room_bookings";
const PHONE_KEY = "zaroda_booking_phone";

function rememberBooking(id: string, token: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(BOOKINGS_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(BOOKINGS_KEY, JSON.stringify({ ...saved, [id]: token }));
  } catch {
    /* the link the guest is sent to carries the secret anyway */
  }
}

/** One kind of room: photos, price, what is free for the chosen dates, and the booking form. */
export default function RoomCard({ hotelSlug, room, stay }: { hotelSlug: string; room: RoomOffer; stay: { checkIn: string; checkOut: string; nights: number } | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState(1);
  const [guests, setGuests] = useState(Math.min(2, room.maxGuests));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(() => {
    try {
      return localStorage.getItem(PHONE_KEY) ?? "";
    } catch {
      return "";
    }
  });
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const left = room.roomsLeft;
  const soldOut = stay !== null && left !== null && left <= 0;
  const maxRooms = Math.max(1, Math.min(5, left ?? 5));
  // The price for what the guest has chosen, worked out the same way the hotel will charge it.
  const total = stay ? Math.round(room.pricePerNight * stay.nights * rooms * 100) / 100 : null;
  const deposit = total === null ? null : Math.max(1, Math.min(Math.ceil((total * room.depositPercent) / 100 - 1e-9), Math.ceil(total)));

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setBusy(true);
    setError(null);
    try {
      const booking = await createBooking(hotelSlug, {
        roomTypeId: room.id,
        checkIn: stay.checkIn,
        checkOut: stay.checkOut,
        rooms,
        guests,
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      try {
        localStorage.setItem(PHONE_KEY, phone.trim());
      } catch {
        /* only a convenience */
      }
      rememberBooking(booking.id, booking.guestToken);
      router.push(`/b/${booking.id}?k=${encodeURIComponent(booking.guestToken)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not make the booking. Please try again.");
      setBusy(false);
    }
  }

  const field = "mt-1 w-full rounded-md border border-border bg-surface p-3 text-base";
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--card-shadow)]">
      <div className="grid gap-0 md:grid-cols-[1fr_1.1fr]">
        <HouseGallery images={room.images} alt={room.name} />
        <div className="space-y-3 p-4">
          <div>
            <h3 className="text-lg font-semibold">{room.name}</h3>
            <p className="flex items-center gap-1 text-sm text-secondary-500">
              <Users size={14} aria-hidden /> Sleeps {room.maxGuests}
            </p>
          </div>
          {room.description && <p className="text-sm text-secondary-600">{room.description}</p>}
          {room.amenities.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-secondary-600">
              {room.amenities.map((a) => (
                <li key={a} className="flex items-center gap-1">
                  <Check size={14} className="text-success-600" aria-hidden /> {a}
                </li>
              ))}
            </ul>
          )}
          <div>
            <p className="text-xl font-bold">
              {kes(room.pricePerNight)} <span className="text-sm font-normal text-secondary-500">/ night</span>
            </p>
            {stay && left !== null && !soldOut && left <= 3 && <p className="text-xs text-warning-700">Only {left} left for your dates</p>}
            {soldOut && <p className="text-sm font-medium text-error-600">Fully booked for those dates</p>}
          </div>

          {!stay ? (
            <p className="rounded-md bg-secondary-500/10 p-3 text-sm text-secondary-600">Choose your check-in and check-out dates above to see if this room is free and to book it.</p>
          ) : soldOut ? null : !open ? (
            <button onClick={() => setOpen(true)} className="w-full rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700">
              Book - {kes(room.quote?.total ?? 0)} for {stay.nights} night{stay.nights === 1 ? "" : "s"}
            </button>
          ) : (
            <form onSubmit={book} className="space-y-3 rounded-md border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm font-medium">
                  Rooms
                  <select value={rooms} onChange={(e) => setRooms(Number(e.target.value))} className={field}>
                    {Array.from({ length: maxRooms }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium">
                  Guests
                  <input type="number" min={1} max={room.maxGuests * rooms} value={guests} onChange={(e) => setGuests(Number(e.target.value))} className={field} />
                </label>
              </div>
              <label className="block text-sm font-medium">
                Your name
                <input required value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoComplete="name" className={field} />
              </label>
              <label className="block text-sm font-medium">
                M-Pesa number (for the deposit)
                <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" className={field} />
              </label>
              <label className="block text-sm font-medium">
                Email <span className="font-normal text-secondary-500">(optional)</span>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="email" className={field} />
              </label>
              <label className="block text-sm font-medium">
                Anything the hotel should know <span className="font-normal text-secondary-500">(optional)</span>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} placeholder="e.g. arriving late" className={field} />
              </label>
              <div className="rounded-md bg-secondary-500/10 p-3 text-sm">
                <p className="flex justify-between">
                  <span>
                    {rooms} room{rooms === 1 ? "" : "s"} x {stay.nights} night{stay.nights === 1 ? "" : "s"}
                  </span>
                  <strong>{kes(total ?? 0)}</strong>
                </p>
                <p className="mt-1 flex justify-between">
                  <span>Deposit to pay now ({room.depositPercent}%)</span>
                  <strong>{kes(deposit ?? 0)}</strong>
                </p>
                <p className="mt-1 flex justify-between text-secondary-600">
                  <span>Balance to pay at the hotel</span>
                  <span>{kes(Math.max(0, (total ?? 0) - (deposit ?? 0)))}</span>
                </p>
              </div>
              {error && <p className="text-sm text-error-600">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button type="submit" disabled={busy || name.trim().length < 2 || phone.trim().length < 9} className="flex-1 rounded-md bg-primary-600 px-4 py-3 font-semibold text-white hover:bg-primary-700 disabled:opacity-50">
                  {busy ? "Booking..." : `Pay ${kes(deposit ?? 0)} deposit with M-Pesa`}
                </button>
                <button type="button" onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-3">
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </article>
  );
}
