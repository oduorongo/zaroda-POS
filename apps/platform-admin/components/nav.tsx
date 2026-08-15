"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";
import { useIdleLogout } from "../hooks/use-idle-logout";

const LINKS = [
  { href: "/organizations", label: "Tenants" },
  { href: "/tenants/new", label: "+ New tenant" },
  { href: "/billing", label: "Billing" },
  { href: "/analytics", label: "Analytics" },
];

// Shares the same navy background as apps/backoffice (both ride the same
// primary-* token), but deliberately keeps its own amber accent rather
// than backoffice's accent usage - a platform admin and a tenant owner
// logging into two different apps in adjacent browser tabs should still
// be able to tell them apart at a glance, on top of the session storage
// itself already being namespaced separately (lib/auth.ts) and the tokens
// being structurally incompatible with each other's API.
export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();
  useIdleLogout();

  return (
    <header className="flex items-center justify-between border-b border-primary-700 bg-primary-900 px-4 py-3">
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
          className="rounded-md bg-primary-700 px-3 py-1.5 hover:bg-primary-600"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
