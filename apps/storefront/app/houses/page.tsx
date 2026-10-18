import type { Metadata } from "next";
import Link from "next/link";
import { ImageOff, MapPin } from "lucide-react";
import { listHouses } from "../../lib/api";
import { HOUSE_TYPES, houseTypeLabel, kes } from "../../lib/format";
import type { HouseSummary } from "../../lib/types";

export const revalidate = 30;

export const metadata: Metadata = {
  title: "Houses to let",
  description: "Find bedsitters, rooms, apartments and shops to rent from landlords across Kenya, with photos and the landlord's phone number.",
};

interface Search {
  area?: string;
  type?: string;
  minRent?: string;
  maxRent?: string;
  page?: string;
}

function pageHref(search: Search, page: number) {
  const query = new URLSearchParams();
  for (const key of ["area", "type", "minRent", "maxRent"] as const) if (search[key]) query.set(key, search[key] as string);
  if (page > 0) query.set("page", String(page));
  const qs = query.toString();
  return `/houses${qs ? `?${qs}` : ""}`;
}

function HouseCard({ house }: { house: HouseSummary }) {
  return (
    <Link href={`/houses/${house.id}`} className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--card-shadow)] transition hover:-translate-y-0.5">
      <div className="relative aspect-[4/3] bg-secondary-500/10">
        {house.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={house.coverImage} alt={house.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-secondary-400">
            <ImageOff size={32} aria-hidden />
          </div>
        )}
        {house.photoCount > 1 && <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-xs font-medium text-white">{house.photoCount} photos</span>}
        <span className="absolute left-2 top-2 rounded-full bg-primary-600 px-2 py-0.5 text-xs font-medium text-white">{houseTypeLabel(house.unitType)}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1 p-4">
        <p className="text-lg font-bold">
          {kes(house.monthlyRent)} <span className="text-sm font-normal text-secondary-500">/ month</span>
        </p>
        <h3 className="font-semibold leading-snug">{house.title}</h3>
        <p className="flex items-center gap-1 text-sm text-secondary-500">
          <MapPin size={14} aria-hidden /> {house.area}
        </p>
      </div>
    </Link>
  );
}

export default async function HousesPage({ searchParams }: { searchParams: Search }) {
  const page = Math.max(0, Number.parseInt(searchParams.page ?? "0", 10) || 0);
  let result: { houses: HouseSummary[]; hasMore: boolean } = { houses: [], hasMore: false };
  let failed = false;
  try {
    result = await listHouses({
      area: searchParams.area?.trim() || undefined,
      type: searchParams.type || undefined,
      minRent: searchParams.minRent || undefined,
      maxRent: searchParams.maxRent || undefined,
      page,
    });
  } catch {
    failed = true;
  }
  const filtered = !!(searchParams.area || searchParams.type || searchParams.minRent || searchParams.maxRent);
  const field = "min-w-0 rounded-md border border-border bg-surface p-2.5 text-sm text-foreground";

  return (
    <div className="space-y-6">
      <section className="rounded-xl bg-primary-600 px-6 py-8 text-white">
        <h1 className="text-3xl font-bold">Houses to let</h1>
        <p className="mt-2 max-w-xl text-primary-50">Browse rooms, bedsitters, apartments and shops to rent. Call or WhatsApp the landlord directly.</p>
      </section>

      <form action="/houses" className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-surface p-3 sm:grid-cols-5">
        <input name="area" defaultValue={searchParams.area} placeholder="Area or town" aria-label="Area or town" className={`${field} col-span-2 sm:col-span-2`} />
        <select name="type" defaultValue={searchParams.type ?? ""} aria-label="Type of house" className={field}>
          <option value="">Any type</option>
          {HOUSE_TYPES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input name="minRent" type="number" min={0} inputMode="numeric" defaultValue={searchParams.minRent} placeholder="Min rent" aria-label="Minimum rent" className={field} />
        <input name="maxRent" type="number" min={0} inputMode="numeric" defaultValue={searchParams.maxRent} placeholder="Max rent" aria-label="Maximum rent" className={field} />
        <button type="submit" className="col-span-2 rounded-md bg-primary-600 px-4 py-2.5 font-semibold text-white hover:bg-primary-700 sm:col-span-5">
          Search
        </button>
      </form>

      {failed ? (
        <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">We couldn&apos;t load the houses just now. Please refresh in a moment.</p>
      ) : result.houses.length === 0 ? (
        <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">
          {filtered ? "No houses match your search. Try a wider area or price." : "No houses are listed right now - check back soon."}
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {result.houses.map((house) => (
            <HouseCard key={house.id} house={house} />
          ))}
        </div>
      )}

      {(page > 0 || result.hasMore) && (
        <div className="flex justify-center gap-3">
          {page > 0 && (
            <Link href={pageHref(searchParams, page - 1)} className="rounded-md border border-border bg-surface px-4 py-2 text-sm">
              Previous
            </Link>
          )}
          {result.hasMore && (
            <Link href={pageHref(searchParams, page + 1)} className="rounded-md border border-border bg-surface px-4 py-2 text-sm">
              Next
            </Link>
          )}
        </div>
      )}

      <p className="text-center text-xs text-secondary-500">Are you a landlord? List your empty units from the Zaroda back office.</p>
    </div>
  );
}
