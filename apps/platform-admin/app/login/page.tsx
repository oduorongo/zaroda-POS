"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { login, ApiError } from "../../lib/api";
import { setSession } from "../../lib/auth";

/**
 * No "new here?" registration link, unlike apps/backoffice's /login -
 * there is deliberately no self-registration path for a platform admin
 * (PlatformAdminAuthService's own comment on why: a public "become a
 * platform admin" endpoint would be a severe vulnerability). The only
 * way an account exists is `pnpm --filter api seed:platform-admin`, run
 * manually against the database.
 */
export default function LoginPage() {
  const router = useRouter();
  const [apiBaseUrl, setApiBaseUrl] = useState("http://localhost:3001");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { accessToken } = await login(apiBaseUrl.trim(), email.trim(), password);
      setSession({ apiBaseUrl: apiBaseUrl.trim(), accessToken, email: email.trim() });
      router.replace("/organizations");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed - check the API URL and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4 text-zinc-100">
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-xl border border-zinc-800 bg-zinc-900 p-6 shadow-xl">
        <h1 className="text-2xl font-bold">
          ZARODA <span className="text-amber-400">Platform Admin</span>
        </h1>
        <p className="text-sm text-zinc-400">
          Cross-tenant access - this is not a tenant login. Every action here is logged.
        </p>
        <div>
          <label className="block text-sm font-medium text-zinc-300">API base URL</label>
          <input
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2.5"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300">Email</label>
          <input
            type="email"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2.5"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-zinc-300">Password</label>
          <input
            type="password"
            className="mt-1 w-full rounded-md border border-zinc-700 bg-zinc-950 p-2.5"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <p className="rounded-md bg-red-950 p-2.5 text-sm text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-amber-600 p-3 font-semibold hover:bg-amber-500 disabled:opacity-50"
        >
          {busy ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}
