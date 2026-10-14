"use client";

import { FloatingThemeToggle } from "@zaroda/ui";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError } from "../../../lib/api";
import { setTeamSession } from "../../../lib/team-auth";
import { teamApiBase, teamLogin } from "../../../lib/team-api";

/** Sign-in for marketing team leaders and members. Accounts are created by Zaroda (a leader's by the platform owner); there is no sign-up here. */
export default function TeamLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await teamLogin(email.trim(), password);
      setTeamSession({ apiBaseUrl: teamApiBase, accessToken: result.accessToken });
      router.replace("/team");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign in - check your connection and try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <FloatingThemeToggle />
      <form onSubmit={handleSubmit} className="w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-6 shadow-xl">
        <h1 className="text-2xl font-bold">
          Zaroda <span className="text-[#c99a2e]">Team</span>
        </h1>
        <p className="text-sm text-secondary-500">Sign in to your marketing team account.</p>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-secondary-600">Email</label>
          <input
            type="email"
            required
            autoCapitalize="none"
            autoComplete="username"
            className="w-full rounded-lg border border-border bg-background p-3 text-sm"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-sm font-medium text-secondary-600">Password</label>
          <input
            type="password"
            required
            autoComplete="current-password"
            className="w-full rounded-lg border border-border bg-background p-3 text-sm"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && <p className="rounded-lg border border-error-600/40 bg-error-50 px-3 py-2 text-sm">{error}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary-600 p-3 font-semibold text-white hover:bg-primary-500 disabled:opacity-50">
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <p className="text-xs text-secondary-500">Forgotten your password? Ask your team leader, or Zaroda, to issue you a new one.</p>
      </form>
    </div>
  );
}
