"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSession } from "../lib/auth";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getSession() ? "/sales" : "/login");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <p>Loading...</p>
    </div>
  );
}
