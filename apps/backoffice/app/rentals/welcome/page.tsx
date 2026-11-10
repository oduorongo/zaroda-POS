"use client";

import Link from "next/link";
import { RentalsFrame } from "../../../components/rentals/public-frame";
import { RENTALS_BRAND } from "../../../lib/rentals";

const POINTS = [
  { title: "Properties, units and tenants", text: "Add a block of units in one go (A1-A20), give a tenant a unit, and keep every lease with its rent, deposit and dates." },
  { title: "Rent invoices on their own", text: "Each month's rent invoice is made for every tenant on the due day, with arrears carried forward." },
  { title: "M-Pesa rent, matched for you", text: "Tenants pay to your own Paybill or Till; each payment is matched to the right tenant and a receipt goes out." },
  { title: "Reminders and a tenant portal", text: "SMS and email reminders before and after the due day, and a portal where tenants see their statement and pay." },
  { title: "Caretakers", text: "Give a caretaker a login for the properties you choose, without showing them the rest of your business." },
  { title: "Short stays (Airbnb)", text: "Let furnished units by the night: one calendar with Airbnb and Booking.com, payments, cleaning after each guest, door codes sent the day before, and owner statements." },
  { title: "Houses to let", text: "Advertise a vacant unit on Zaroda's houses-to-let listings for KES 100 for 30 days, and take it down when it is let." },
  { title: "Deposits and moving out", text: "Hold deposits, and at the end of a lease refund them or keep part for damage, with it all on the tenant's statement." },
  { title: "Expenses and accounts", text: "Repairs and running costs per property, and books that keep themselves: rent owed, collected, deposits held and profit." },
];

/** The ZARODA RENTALS landing page (RENTALS_DOMAIN "/"). */
export default function RentalsWelcome() {
  return (
    <RentalsFrame>
      <section
        className="bg-cover text-white"
        style={{
          backgroundImage: `linear-gradient(90deg, ${RENTALS_BRAND.navy} 0%, ${RENTALS_BRAND.navy}cc 40%, ${RENTALS_BRAND.navy}40 75%, ${RENTALS_BRAND.navy}10 100%), url(/rentals-hero.jpg)`,
          backgroundPosition: "center, 70% center",
          backgroundColor: RENTALS_BRAND.navy,
        }}
      >
        <div className="mx-auto max-w-5xl px-4 py-16 sm:py-28">
          <p className="text-sm font-semibold uppercase tracking-widest" style={{ color: RENTALS_BRAND.gold }}>For Kenyan landlords and agents</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold leading-tight sm:text-4xl">Collect rent, track tenants and stay on top of arrears - from your phone.</h1>
          <p className="mt-4 max-w-xl text-white/80">ZARODA RENTALS does the monthly invoices, M-Pesa matching, receipts and reminders, so you only deal with the exceptions.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/rentals/signup" className="rounded-lg px-5 py-3 font-semibold text-white no-underline" style={{ background: RENTALS_BRAND.orange }}>Start free (up to 5 units)</Link>
            <Link href="/rentals/pricing" className="rounded-lg border border-white/40 px-5 py-3 font-semibold text-white no-underline">See pricing</Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-5xl gap-4 px-4 py-10 sm:grid-cols-2">
        {POINTS.map((p) => (
          <div key={p.title} className="rounded-xl border border-border bg-surface p-5">
            <h2 className="font-bold" style={{ color: "var(--con-ink)" }}>{p.title}</h2>
            <p className="mt-1 text-sm text-secondary-600">{p.text}</p>
          </div>
        ))}
      </section>
      <p className="mx-auto max-w-5xl px-4 pb-12 text-sm">
        <Link href="/rentals/guide" className="font-semibold" style={{ color: "var(--con-ink)" }}>Read the user guide</Link>
        <span className="text-secondary-500"> - setting up, collecting rent, M-Pesa, caretakers, adverts and the tenant portal, step by step.</span>
      </p>
    </RentalsFrame>
  );
}
