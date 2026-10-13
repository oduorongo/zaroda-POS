// The front door: one place to reach every Zaroda POS app, sorted by who is signing in.
const BACKOFFICE_URL = (process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "https://app.zarodashop.com").replace(/\/+$/, "");
const TILL_URL = (process.env.NEXT_PUBLIC_TERMINAL_URL ?? "https://pos.zarodashop.com").replace(/\/+$/, "");
const SHOP_URL = (process.env.NEXT_PUBLIC_STOREFRONT_URL ?? "https://shop.zarodashop.com").replace(/\/+$/, "");

const APPS = [
  {
    who: "Shop owner or manager",
    name: "Back Office",
    description: "Products, stock, sales, reports, staff and your online shop.",
    href: `${BACKOFFICE_URL}/login`,
    cta: "Sign in to Back Office",
  },
  {
    who: "Cashier",
    name: "Till",
    description: "Ring up sales on a tablet or phone, even without internet. Sign in with your PIN.",
    href: TILL_URL,
    cta: "Open the Till",
  },
  {
    who: "Shopper",
    name: "Marketplace",
    description: "Browse local shops, order, pay with M-Pesa and track your delivery.",
    href: SHOP_URL,
    cta: "Shop now",
  },
  {
    who: "Delivery rider",
    name: "Rider",
    description: "Quote on delivery jobs, collect, deliver and see your earnings.",
    href: `${SHOP_URL}/rider`,
    cta: "Rider sign in",
  },
];

export default function ChooseApp() {
  return (
    <section id="apps" className="mx-auto max-w-6xl px-6 py-12">
      <h2 className="text-center text-2xl font-bold text-foreground">Choose your app</h2>
      <p className="mx-auto mt-2 max-w-xl text-center text-secondary-500">One Zaroda POS, a door for everyone who uses it. Pick the one that matches you.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {APPS.map((app) => (
          <a
            key={app.name}
            href={app.href}
            className="group flex flex-col rounded-xl border border-border bg-surface p-5 no-underline transition-colors hover:border-[#c99a2e]"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-[#c99a2e]">{app.who}</span>
            <span className="mt-1 text-lg font-bold text-foreground">{app.name}</span>
            <span className="mt-2 flex-1 text-sm text-secondary-500">{app.description}</span>
            <span className="mt-4 text-sm font-semibold text-primary-600 group-hover:underline">{app.cta} →</span>
          </a>
        ))}
      </div>
    </section>
  );
}
