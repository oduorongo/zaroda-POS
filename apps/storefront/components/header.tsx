"use client";

import Link from "next/link";
import { ShoppingBag, UserRound } from "lucide-react";
import { displayPhone } from "../lib/format";
import { useStore } from "./store-provider";

export default function Header() {
  const { buyer, ready, signOut } = useStore();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold">
          <ShoppingBag size={22} className="text-primary-600" aria-hidden />
          <span>Zaroda Marketplace</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm">
          {ready && buyer ? (
            <>
              <Link href="/orders" className="hover:text-primary-600">
                My orders
              </Link>
              <span className="hidden items-center gap-1 text-secondary-500 sm:flex">
                <UserRound size={14} aria-hidden /> {buyer.name ?? displayPhone(buyer.phone)}
              </span>
              <button onClick={signOut} className="text-secondary-500 hover:text-foreground">
                Sign out
              </button>
            </>
          ) : (
            ready && (
              <Link href="/orders" className="rounded-md border border-border px-3 py-1.5 hover:bg-secondary-50">
                Sign in
              </Link>
            )
          )}
        </nav>
      </div>
    </header>
  );
}
