"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getActiveSession, getDeviceConfig } from "../lib/db";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    void (async () => {
      const config = await getDeviceConfig();
      if (!config) {
        router.replace("/setup");
        return;
      }
      const session = await getActiveSession();
      router.replace(session ? "/pos" : "/login");
    })();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <p className="text-lg">Loading ZARODA POS...</p>
    </div>
  );
}
