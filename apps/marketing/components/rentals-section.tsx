import { Badge } from "@zaroda/ui";

const BACKOFFICE_URL = (process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "https://app.zarodashop.com").replace(/\/+$/, "");
/** ZARODA RENTALS' own site (rentals.zarodasolutions.app); until it is set, its pages on the back office. */
export const RENTALS_URL = (process.env.NEXT_PUBLIC_RENTALS_URL ?? "").replace(/\/+$/, "");
export const rentalsLink = (path: "" | "/pricing" | "/signup") =>
  RENTALS_URL ? `${RENTALS_URL}${path}` : `${BACKOFFICE_URL}/rentals/${path ? path.slice(1) : "welcome"}`;

const NAVY = "#1a2e5a";
const GOLD = "#d4af37";
const GREEN = "#14866d";

const POINTS = [
  "Monthly rent invoices made for every tenant on their own",
  "M-Pesa rent to your own Paybill or Till, matched to the right tenant",
  "Receipts, statements and SMS / email reminders",
  "A tenant portal, caretaker logins and houses-to-let adverts",
];

/** The ZARODA RENTALS advert on the POS marketing pages: a separate product on its own site, sold alongside the POS. */
export function RentalsSection() {
  return (
    <section className="py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="overflow-hidden rounded-2xl text-white shadow-lg" style={{ background: `linear-gradient(135deg, ${NAVY}, #0f1c3a)` }}>
          <div className="grid gap-8 p-8 sm:p-12 md:grid-cols-2">
            <div>
              <Badge variant="success">New from Zaroda</Badge>
              <p className="mt-4 text-sm font-extrabold uppercase tracking-widest" style={{ color: GOLD }}>ZARODA RENTALS</p>
              <h2 className="mt-2 text-3xl font-bold leading-tight">Own rental houses? Collect rent without the chasing.</h2>
              <p className="mt-3 text-white/80">Property management for Kenyan landlords and agents - free for up to 5 units.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <a href={rentalsLink("/signup")} className="rounded-md px-5 py-3 font-semibold text-white no-underline" style={{ background: GREEN }}>Start free</a>
                <a href={rentalsLink("")} className="rounded-md border border-white/40 px-5 py-3 font-semibold text-white no-underline">Visit ZARODA RENTALS</a>
              </div>
            </div>
            <ul className="space-y-3 self-center">
              {POINTS.map((p) => (
                <li key={p} className="flex gap-3 text-white/90">
                  <span className="mt-0.5 font-bold" style={{ color: GOLD }}>✓</span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
