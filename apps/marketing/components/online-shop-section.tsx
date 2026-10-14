import Link from "next/link";
import { Store, CreditCard, Bike, ShieldCheck } from "lucide-react";

const POINTS = [
  {
    icon: Store,
    title: "Your own online shop",
    description: "Put the stock you already have in the till online. Shoppers find you on the Zaroda Marketplace or through your own shop link, and order for pickup or delivery.",
  },
  {
    icon: CreditCard,
    title: "Paid straight to you",
    description: "Shoppers pay with M-Pesa and the money goes straight to you, through Tuma or your own Paybill or Till. Zaroda never holds your money. A paid order shows up in your back office right away.",
  },
  {
    icon: Bike,
    title: "Delivery by riders",
    description: "Use your own riders or Zaroda's approved rider pool, on a boda, tuk tuk or vehicle. Riders send a price for each job, the shopper picks one, and pays the rider in cash on delivery.",
  },
  {
    icon: ShieldCheck,
    title: "Delivery confirmed by a code",
    description: "The shopper gets a 4-digit code and gives it to the rider only after receiving the goods. No code, no completed delivery.",
  },
];

/** The online shop add-on, as it works today. Shared by the home page and the features page. */
export default function OnlineShopSection({ heading = "Sell online, from the stock you already have" }: { heading?: string }) {
  return (
    <section id="online-shop" className="border-y border-border bg-surface py-16">
      <div className="mx-auto max-w-6xl px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#c99a2e]">New: Online Shop</span>
          <h2 className="mt-2 text-2xl font-bold text-foreground">{heading}</h2>
          <p className="mt-2 text-secondary-500">
            Your till, your stock and your sales reports stay in one place. Orders placed online are recorded as normal sales.
          </p>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {POINTS.map((p) => (
            <div key={p.title} className="rounded-xl border border-border bg-background p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0a1633] text-[#c99a2e]">
                <p.icon size={20} />
              </div>
              <h3 className="mt-3 font-semibold text-foreground">{p.title}</h3>
              <p className="mt-1.5 text-sm text-secondary-500">{p.description}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-secondary-500">
          The online shop is an add-on you switch on for your business. You pay 3% on completed online orders.{" "}
          <Link href="/pricing#online-shop" className="font-semibold text-primary-600 hover:underline">
            See how it is billed
          </Link>
        </p>
      </div>
    </section>
  );
}
