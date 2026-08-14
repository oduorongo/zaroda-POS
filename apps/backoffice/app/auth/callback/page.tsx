"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getOrganization } from "../../../lib/api";
import { setSession, clearSession, decodeRole, isBackofficeRole } from "../../../lib/auth";

const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

/**
 * Landing point for the marketing signup handoff - the token travels in the
 * URL hash (never sent to a server, never logged) so a freshly-registered
 * owner arrives here already authenticated instead of re-entering their
 * password at /login.
 */
export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    async function handle() {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
      const params = new URLSearchParams(hash);
      const token = params.get("token");
      const email = params.get("email");

      if (!token || !email) {
        router.replace("/login");
        return;
      }

      try {
        const role = decodeRole(token) ?? "OWNER";

        // Same guard as /login - in practice signup always creates an
        // OWNER, but a cashier arriving via any path must be blocked the
        // same way, never handed a back-office session.
        if (!isBackofficeRole(role)) {
          clearSession();
          history.replaceState(null, "", window.location.pathname);
          router.replace("/login");
          return;
        }

        const { industryType } = await getOrganization(apiBaseUrl, token);
        setSession({ apiBaseUrl, accessToken: token, role, email, industryType });
        history.replaceState(null, "", window.location.pathname);
        router.replace("/dashboard");
      } catch {
        router.replace("/login");
      }
    }

    void handle();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-900 text-slate-100">
      <p className="text-sm text-slate-400">Signing you in...</p>
    </div>
  );
}
