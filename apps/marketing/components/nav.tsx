"use client";

import { useState } from "react";
import Link from "next/link";
import { ThemeToggle } from "@zaroda/ui";

const LINKS = [
  { href: "/features", label: "Features" },
  { href: "/industries", label: "Industries" },
  { href: "/tools", label: "Tools" },
  { href: "/pricing", label: "Pricing" },
];

const BACKOFFICE_URL = process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "http://localhost:3003";
const BACKOFFICE_LOGIN_URL = `${BACKOFFICE_URL}/login`;

export default function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="font-bold text-foreground" onClick={() => setOpen(false)}>
          Zaroda <span className="text-primary-600">POS</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm md:flex">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-secondary-600 hover:text-foreground">
              {link.label}
            </Link>
          ))}
          <a href={BACKOFFICE_LOGIN_URL} className="text-secondary-600 hover:text-foreground">
            Sign In
          </a>
          <Link
            href="/signup"
            className="rounded-md bg-primary-600 px-4 py-2 font-semibold text-white hover:bg-primary-700"
          >
            Start Free Trial
          </Link>
          <ThemeToggle />
        </nav>

        <div className="flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-foreground"
            aria-label="Toggle menu"
            aria-expanded={open}
          >
          <span className="sr-only">Toggle menu</span>
          {open ? (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 1l16 16M17 1L1 17" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M1 4h16M1 9h16M1 14h16" strokeLinecap="round" />
            </svg>
          )}
          </button>
        </div>
      </div>

      {open && (
        <nav className="flex flex-col gap-1 border-t border-border bg-surface px-6 py-4 md:hidden">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-2 py-2 text-sm text-secondary-600 hover:bg-secondary-50 hover:text-foreground"
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <a
            href={BACKOFFICE_LOGIN_URL}
            className="rounded-md px-2 py-2 text-sm text-secondary-600 hover:bg-secondary-50 hover:text-foreground"
          >
            Sign In
          </a>
          <Link
            href="/signup"
            className="mt-2 rounded-md bg-primary-600 px-4 py-2 text-center font-semibold text-white hover:bg-primary-700"
            onClick={() => setOpen(false)}
          >
            Start Free Trial
          </Link>
        </nav>
      )}
    </header>
  );
}
