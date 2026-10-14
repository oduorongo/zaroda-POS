"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RibbonButton, RibbonLink, ThemeToggle, TopRibbon } from "@zaroda/ui";
import Link from "next/link";
import { ApiError } from "../lib/api";
import { clearTeamSession, getTeamSession } from "../lib/team-auth";
import { teamMe, type TeamMe } from "../lib/team-api";

type Page = "home" | "shops" | "riders" | "members";

/**
 * The frame for every marketing-team screen: the navy ribbon, the sign-in check, and a hold on everything but the
 * home page until a temporary password has been replaced. Children get the signed-in person's details.
 */
export function TeamShell({ active, children }: { active: Page; children: (me: TeamMe, reload: () => Promise<void>) => ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<TeamMe | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      setMe(await teamMe());
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearTeamSession();
        router.replace("/team/login");
      } else {
        setError(err instanceof ApiError ? err.message : "Could not load your account.");
      }
    }
  }

  useEffect(() => {
    if (!getTeamSession()) {
      router.replace("/team/login");
      return;
    }
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me?.agent.mustChangePassword && active !== "home") router.replace("/team");
  }, [me, active, router]);

  function signOut() {
    clearTeamSession();
    router.replace("/team/login");
  }

  const isLeader = me?.agent.role === "LEADER";
  const unlocked = me && !me.agent.mustChangePassword;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopRibbon appName="Team" homeHref="/team" LinkComponent={Link}>
        <RibbonLink href="/team" LinkComponent={Link} active={active === "home"}>
          Home
        </RibbonLink>
        {unlocked && (
          <>
            <RibbonLink href="/team/shops" LinkComponent={Link} active={active === "shops"}>
              Shops
            </RibbonLink>
            <RibbonLink href="/team/riders" LinkComponent={Link} active={active === "riders"}>
              Riders
            </RibbonLink>
            {isLeader && (
              <RibbonLink href="/team/members" LinkComponent={Link} active={active === "members"}>
                Members
              </RibbonLink>
            )}
          </>
        )}
        {me && <span className="hidden text-xs text-white/70 lg:inline">{me.agent.fullName}</span>}
        <ThemeToggle />
        <RibbonButton onClick={signOut}>Sign out</RibbonButton>
      </TopRibbon>
      <main className="mx-auto max-w-5xl space-y-6 p-6">
        {error && <p className="text-sm text-error-600">{error}</p>}
        {!me && !error && <p className="text-sm text-secondary-500">Loading...</p>}
        {me && children(me, reload)}
      </main>
    </div>
  );
}
