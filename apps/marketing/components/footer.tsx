import Link from "next/link";

const PRODUCT_LINKS = [
  { href: "/features", label: "Features" },
  { href: "/industries", label: "Industries" },
  { href: "/pricing", label: "Pricing" },
];

const TOOLS_LINKS = [
  { href: "/tools", label: "All free tools" },
  { href: "/tools/barcode", label: "Barcode Generator" },
  { href: "/tools/qr", label: "QR Code Generator" },
  { href: "/tools/invoice", label: "Invoice Generator" },
];

const COMPANY_LINKS = [
  { href: "/signup", label: "Start Free Trial" },
  { href: "http://localhost:3003/login", label: "Sign In" },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface py-12 text-sm">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 sm:grid-cols-4">
        <div className="sm:col-span-1">
          <div className="font-bold text-foreground">
            Zaroda <span className="text-primary-600">POS</span>
          </div>
          <p className="mt-3 max-w-xs text-secondary-500">
            Built for Kenyan retail — M-Pesa, offline sales, and eTIMS-ready tax, running on whatever
            tablet or phone your shop already has.
          </p>
        </div>

        <div>
          <div className="font-semibold text-foreground">Product</div>
          <ul className="mt-3 space-y-2">
            {PRODUCT_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-secondary-500 hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="font-semibold text-foreground">Free tools</div>
          <ul className="mt-3 space-y-2">
            {TOOLS_LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-secondary-500 hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="font-semibold text-foreground">Company</div>
          <ul className="mt-3 space-y-2">
            {COMPANY_LINKS.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-secondary-500 hover:text-foreground">
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mx-auto mt-10 max-w-6xl border-t border-border px-6 pt-6 text-xs text-secondary-400">
        © {year} Zaroda POS. All rights reserved.
      </div>
    </footer>
  );
}
