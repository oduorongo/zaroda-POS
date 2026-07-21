"use client";

import { useRouter } from "next/navigation";
import { clearSession, type Session } from "../lib/auth";

export function Nav({ session }: { session: Session }) {
  const router = useRouter();

  return (
    <header className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      <span className="font-bold">
        ZARODA <span className="text-amber-400">Platform Admin</span>
      </span>
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
