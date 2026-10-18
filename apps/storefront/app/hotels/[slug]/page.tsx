import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin, Phone } from "lucide-react";
import RoomCard from "../../../components/room-card";
import StayPicker from "../../../components/stay-picker";
import { ApiError, getHotel } from "../../../lib/api";
import { locationLabel } from "../../../lib/format";

// Which rooms are free changes as guests book, so this page is never served from a cache.
export const dynamic = "force-dynamic";

interface Search {
  checkIn?: string;
  checkOut?: string;
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  try {
    const hotel = await getHotel(params.slug);
    return { title: hotel.name, description: hotel.description ?? `Book a room at ${hotel.name} with an M-Pesa deposit.` };
  } catch {
    return { title: "Hotel" };
  }
}

export default async function HotelPage({ params, searchParams }: { params: { slug: string }; searchParams: Search }) {
  let hotel;
  try {
    hotel = await getHotel(params.slug, searchParams.checkIn, searchParams.checkOut);
  } catch (err) {
    // A hotel that is offline, or has no rooms on offer, is simply "not found" to a guest.
    if (err instanceof ApiError && (err.status === 404 || err.status === 400)) notFound();
    throw err;
  }
  const where = hotel.location ? locationLabel(hotel.location.subCounty, hotel.location.county) : "";

  return (
    <div className="space-y-6">
      <div>
        <Link href="/hotels" className="text-sm text-primary-600 hover:underline">
          All hotels
        </Link>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{hotel.name}</h1>
        {hotel.description && <p className="mt-2 max-w-2xl text-secondary-600">{hotel.description}</p>}
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-secondary-500">
          {where && (
            <span className="flex items-center gap-1">
              <MapPin size={14} aria-hidden /> {hotel.location?.branchName}, {where}
            </span>
          )}
          {hotel.contactPhone && (
            <a href={`tel:${hotel.contactPhone}`} className="flex items-center gap-1 hover:text-primary-600">
              <Phone size={14} aria-hidden /> {hotel.contactPhone}
            </a>
          )}
        </div>
      </div>

      <StayPicker checkIn={searchParams.checkIn} checkOut={searchParams.checkOut} />
      {hotel.stay && (
        <p className="text-sm text-secondary-600">
          {hotel.stay.checkIn} to {hotel.stay.checkOut} - {hotel.stay.nights} night{hotel.stay.nights === 1 ? "" : "s"}
        </p>
      )}
      {!hotel.stay && searchParams.checkIn && <p className="rounded-md bg-warning-50 p-3 text-sm text-warning-700">Those dates are not valid - check-in cannot be in the past and check-out must be after check-in.</p>}

      <div className="space-y-4">
        {hotel.roomTypes.map((room) => (
          <RoomCard key={room.id} hotelSlug={hotel.slug} room={room} stay={hotel.stay} />
        ))}
      </div>
    </div>
  );
}
