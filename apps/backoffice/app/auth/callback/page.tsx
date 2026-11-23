"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getOrganization } from "../../../lib/api";
import { setSession, clearSession, decodeRole, homePath, canSignIn } from "../../../lib/auth";

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
        const { industryType, name } = (await getOrganization(apiBaseUrl, token)) as { industryType: string; name?: string };
        // Same rule as /login.
        if (!canSignIn(role, industryType)) {
          clearSession();
          history.replaceState(null, "", window.location.pathname);
          router.replace("/login");
          return;
        }
        setSession({ apiBaseUrl, accessToken: token, role, email, industryType, orgName: name });
        history.replaceState(null, "", window.location.pathname);
        router.replace(homePath(role, industryType));
      } catch {
        router.replace("/login");
      }
    }

    void handle();
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <p className="text-sm text-secondary-500">Signing you in...</p>
    </div>
  );
}
