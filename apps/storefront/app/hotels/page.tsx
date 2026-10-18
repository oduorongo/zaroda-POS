import type { Metadata } from "next";
import Link from "next/link";
import { ImageOff, MapPin } from "lucide-react";
import StayPicker from "../../components/stay-picker";
import { listHotels } from "../../lib/api";
import { kes, locationLabel } from "../../lib/format";
import type { HotelSummary } from "../../lib/types";

// Availability changes as guests book, so this page is never served from a cache.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Hotels",
  description: "Find a hotel room, see photos and prices, and book with an M-Pesa deposit.",
};

interface Search {
  area?: string;
  checkIn?: string;
  checkOut?: string;
}

export default async function HotelsPage({ searchParams }: { searchParams: Search }) {
  let hotels: HotelSummary[] = [];
  let failed = false;
  try {
    hotels = await listHotels({ area: searchParams.area?.trim() || undefined, checkIn: searchParams.checkIn, checkOut: searchParams.checkOut });
  } catch {
    failed = true;
  }
  const dated = Boolean(searchParams.checkIn && searchParams.checkOut);
  const link = (slug: string) => `/hotels/${slug}${dated ? `?checkIn=${searchParams.checkIn}&checkOut=${searchParams.checkOut}` : ""}`;

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-primary-600 px-6 py-8 text-white">
        <h1 className="text-3xl font-bold">Hotels</h1>
        <p className="mt-2 max-w-xl text-primary-50">Pick your dates, choose a room, and secure it with a small M-Pesa deposit. You pay the rest at the hotel.</p>
      </section>

      <StayPicker withArea area={searchParams.area} checkIn={searchParams.checkIn} checkOut={searchParams.checkOut} />

      {failed ? (
        <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">We couldn&apos;t load the hotels just now. Please refresh in a moment.</p>
      ) : hotels.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">
          {dated || searchParams.area ? "No hotel has a room free for that search. Try other dates or a wider area." : "No hotels are taking bookings here yet - check back soon."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {hotels.map((hotel) => (
            <Link key={hotel.slug} href={link(hotel.slug)} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--card-shadow)] transition hover:-translate-y-0.5">
              <div className="aspect-[4/3] bg-secondary-500/10">
                {hotel.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={hotel.coverImage} alt={hotel.name} loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-secondary-400">
                    <ImageOff size={32} aria-hidden />
                  </div>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <h2 className="text-lg font-semibold">{hotel.name}</h2>
                {locationLabel(hotel.subCounty, hotel.county) && (
                  <p className="flex items-center gap-1 text-sm text-secondary-500">
                    <MapPin size={14} aria-hidden /> {locationLabel(hotel.subCounty, hotel.county)}
                  </p>
                )}
                {hotel.description && <p className="line-clamp-2 text-sm text-secondary-600">{hotel.description}</p>}
                <p className="mt-auto pt-2 font-bold">
                  From {kes(hotel.fromPrice)} <span className="text-sm font-normal text-secondary-500">/ night</span>
                </p>
                <p className="text-xs text-secondary-500">
                  {hotel.roomTypeCount} room type{hotel.roomTypeCount === 1 ? "" : "s"}
                  {dated ? " free for your dates" : ""}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
