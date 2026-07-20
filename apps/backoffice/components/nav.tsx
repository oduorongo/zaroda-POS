"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";

const LINKS = [
  { href: "/sales", label: "Sales" },
  { href: "/products", label: "Products" },
  { href: "/reports", label: "Reports" },
  { href: "/shifts", label: "Shifts" },
];

export function Nav({ session }: { session: Session }) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900 px-4 py-3">
      <div className="flex items-center gap-6">
        <span className="font-bold">ZARODA Back Office</span>
        <nav className="flex gap-4 text-sm">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={pathname?.startsWith(link.href) ? "text-blue-400" : "text-slate-400 hover:text-slate-200"}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-slate-400">
          {session.email} · {session.role}
        </span>
        <button
          onClick={() => {
            clearSession();
            router.replace("/login");
          }}
          className="rounded-md bg-slate-800 px-3 py-1.5 hover:bg-slate-700"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
