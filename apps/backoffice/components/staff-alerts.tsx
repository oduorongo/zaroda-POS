"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityAlerts, type AlertItem } from "@zaroda/ui";
import { apiGet } from "../lib/api";
import { getSession } from "../lib/auth";

// Only the people who can act on an order get the pop-up and ring (the API refuses the others anyway).
const ALERT_ROLES = ["OWNER", "MANAGER"];

/** A paid online order or a table request is waiting: pop up and ring on every back office page, for as long as it is open. */
export default function StaffAlerts() {
  const [who, setWho] = useState<string | null>(null);

  // Signing in or out happens without a page change, so look again now and then.
  useEffect(() => {
    const look = () => {
      const session = getSession();
      setWho(session && ALERT_ROLES.includes(session.role) ? session.email : null);
    };
    look();
    const timer = setInterval(look, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!who) return null;
  return (
    <ActivityAlerts
      key={who}
      storageKey={`zaroda-staff-alerts:${who}`}
      LinkComponent={Link}
      fetchItems={async () => (await apiGet<{ items: AlertItem[] }>("/alerts/staff")).items}
    />
  );
}
