"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "../lib/auth";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? "/organizations" : "/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 text-zinc-100">
      <p>Loading...</p>
    </div>
  );
}
