import ShopCard from "../components/shop-card";
import { listShops } from "../lib/api";
import type { ShopSummary } from "../lib/types";

// Re-fetched at most every 30s (see lib/api.ts) - a shop that goes live or
// sells out shows up quickly without hitting the API on every visit.
export const revalidate = 30;

export default async function HomePage({ searchParams }: { searchParams: { q?: string } }) {
  const q = searchParams.q?.trim() || undefined;
  let shops: ShopSummary[] = [];
  let failed = false;
  try {
    shops = await listShops(q);
  } catch {
    failed = true;
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl bg-primary-600 px-6 py-10 text-white">
        <h1 className="text-3xl font-bold sm:text-4xl">Shop local. Pay with M-Pesa.</h1>
        <p className="mt-2 max-w-xl text-primary-50">
          Order from shops near you, pay straight from your phone, then pick up in store or have it delivered.
        </p>
        <form action="/" className="mt-6 flex max-w-xl gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search shops by name or county"
            aria-label="Search shops"
            className="min-w-0 flex-1 rounded-md px-4 py-3 text-base text-slate-900"
          />
          <button type="submit" className="rounded-md bg-slate-900 px-5 py-3 font-semibold hover:bg-slate-800">
            Search
          </button>
        </form>
      </section>

      <section aria-labelledby="shops-heading">
        <h2 id="shops-heading" className="mb-4 text-xl font-semibold">
          {q ? `Shops matching "${q}"` : "Shops"}
        </h2>
        {failed ? (
          <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">
            We couldn&apos;t load the shops just now. Please refresh in a moment.
          </p>
        ) : shops.length === 0 ? (
          <p className="rounded-md border border-border bg-surface p-6 text-center text-secondary-500">
            {q ? "No shops match your search." : "No shops are open yet - check back soon."}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((shop) => (
              <ShopCard key={shop.slug} shop={shop} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
