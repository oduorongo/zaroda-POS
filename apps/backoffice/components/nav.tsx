"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "../lib/api";
import { clearSession, homePath, setSession, type Session } from "../lib/auth";
import { menuFor } from "../lib/menu";
import { useIdleLogout } from "../hooks/use-idle-logout";
import { SideNav } from "./side-nav";
import { ConHeader, useConMeFetch } from "./construction/con-shell";

const ROLE_NAMES: Record<string, string> = { OWNER: "Owner", MANAGER: "Manager", AUDITOR: "Auditor", SUPERVISOR: "Supervisor", CASHIER: "Cashier", CARETAKER: "Caretaker" };

// The left sidebar for every signed-in back-office screen: only the screens this person's role and business type allow (lib/menu.ts).
export function Nav({ session }: { session: Session }) {
  const router = useRouter();
  useIdleLogout();

  // The shop's name goes in the sidebar. Sessions made before this existed do not have it yet, so fetch it once and keep it.
  const [orgName, setOrgName] = useState(session.orgName);
  useEffect(() => {
    if (session.orgName) return;
    apiGet<{ name?: string }>("/organizations/me")
      .then((org) => {
        if (!org.name) return;
        setOrgName(org.name);
        setSession({ ...session, orgName: org.name });
      })
      .catch(() => {});
  }, [session]);
  const conMe = useConMeFetch(session);

  // A contractor on a shared screen (Suppliers, Materials) keeps the construction menu.
  if (session.industryType === "CONSTRUCTION") return <ConHeader session={{ ...session, orgName: orgName ?? session.orgName }} me={conMe} />;

  return (
    <SideNav
      title={session.industryType === "RENTAL" ? "ZARODA RENTALS" : session.industryType === "FARM" ? "ZARODA SHAMBA" : "ZARODA POS"}
      subtitle={orgName}
      homeHref={homePath(session.role, session.industryType)}
      items={menuFor(session)}
      user={`${session.email} · ${ROLE_NAMES[session.role] ?? session.role}`}
      onSignOut={() => {
        clearSession();
        router.replace("/login");
      }}
    />
  );
}
