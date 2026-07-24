"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";

const LINKS = [
  { href: "/organizations", label: "Tenants" },
  { href: "/tenants/new", label: "+ New tenant" },
  { href: "/billing", label: "Billing" },
  { href: "/analytics", label: "Analytics" },
];

// Deliberately a different color scheme (zinc/amber) from apps/backoffice's
// slate/blue palette - a platform admin and a tenant owner logging into
// two different apps in adjacent browser tabs should be able to tell them
// apart at a glance, on top of the session storage itself already being
// namespaced separately (lib/auth.ts) and the tokens being structurally
// incompatible with each other's API. Uses packages/ui's structural
// primitives (Badge) but keeps its own amber accent rather than the shared
// primary-blue, to preserve that at-a-glance distinction.
export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <div className="flex items-center gap-6">
        <span className="whitespace-nowrap font-bold text-zinc-100">
          ZARODA <span className="text-amber-400">Platform Admin</span>
        </span>
        <nav className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                pathname === link.href || (link.href !== "/tenants/new" && pathname?.startsWith(link.href))
                  ? "font-medium text-amber-400"
                  : "text-zinc-400 hover:text-zinc-200"
              }
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-zinc-400">{session.email}</span>
        <button
          onClick={() => {
            clearSession();
            router.replace("/login");
          }}
          className="rounded-md bg-zinc-800 px-3 py-1.5 hover:bg-zinc-700"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
