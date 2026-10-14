"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, RibbonButton, ThemeToggle, TopRibbon } from "@zaroda/ui";
import { ApiError } from "../../lib/api";
import { clearTeamSession, getTeamSession } from "../../lib/team-auth";
import { teamChangePassword, teamMe, type TeamMe } from "../../lib/team-api";

const pct = (n: number) => `${Math.round(n * 10000) / 100}%`;

/**
 * A leader's or member's home. For now it shows who you are and your team's terms, and makes you replace
 * the temporary password you were given. Onboarding businesses and riders, and your earnings, come next.
 */
export default function TeamHomePage() {
  const router = useRouter();
  const [me, setMe] = useState<TeamMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function signOut() {
    clearTeamSession();
    router.replace("/team/login");
  }

  useEffect(() => {
    if (!getTeamSession()) {
      router.replace("/team/login");
      return;
    }
    teamMe()
      .then(setMe)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) {
          clearTeamSession();
          router.replace("/team/login");
        } else {
          setError(err instanceof ApiError ? err.message : "Could not load your account.");
        }
      });
  }, [router]);

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await teamChangePassword(current, next);
      setCurrent("");
      setNext("");
      setNote("Password changed.");
      setMe(await teamMe());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopRibbon appName="Team" homeHref="/team">
        {me && <span className="hidden text-xs text-white/70 md:inline">{me.agent.fullName}</span>}
        <ThemeToggle />
        <RibbonButton onClick={signOut}>Sign out</RibbonButton>
      </TopRibbon>
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!me && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {me && (
          <>
            <div>
              <h1 className="text-xl font-bold">Hello, {me.agent.fullName}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-secondary-500">
                <Badge variant="neutral">{me.agent.role === "LEADER" ? "Team leader" : "Team member"}</Badge>
                {me.team.name}
                {me.team.region ? ` · ${me.team.region}` : ""}
              </p>
            </div>

            {me.agent.mustChangePassword && (
              <p className="rounded-md border border-warning-600/40 bg-warning-50 p-3 text-sm">
                You are using a temporary password. Please choose your own below before you do anything else.
              </p>
            )}

            <section className="space-y-2 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Your team&apos;s earning terms</h2>
              <ul className="space-y-1 text-sm text-secondary-600">
                <li>Members earn {pct(me.team.memberShareRate)} of what Zaroda collects as online-order commission from the shops they onboard.</li>
                <li>The team leader also earns {pct(me.team.leaderOverrideRate)} of everything the team earns.</li>
                <li>A bonus of KES {me.team.onboardingBonusKes.toLocaleString("en-KE")} for each shop, once it pays its first monthly subscription.</li>
              </ul>
              <p className="text-xs text-secondary-500">Onboarding shops and riders, and your earnings statement, are coming next.</p>
            </section>

            <form onSubmit={changePassword} className="space-y-3 rounded-lg border border-border bg-surface p-4">
              <h2 className="font-semibold">Change your password</h2>
              <input
                type="password"
                required
                autoComplete="current-password"
                placeholder="Current password"
                className="w-full rounded-md border border-border bg-background p-2.5 text-sm"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                placeholder="New password (at least 8 characters)"
                className="w-full rounded-md border border-border bg-background p-2.5 text-sm"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <button type="submit" disabled={busy} className="rounded-md bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {busy ? "Saving..." : "Change password"}
              </button>
              {note && <p className="text-sm text-success-600">{note}</p>}
            </form>
          </>
        )}
      </main>
    </div>
  );
}
