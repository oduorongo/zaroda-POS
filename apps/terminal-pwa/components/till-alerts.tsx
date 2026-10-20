"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActivityAlerts, type AlertItem } from "@zaroda/ui";
import { apiGet } from "../lib/api";
import { getActiveSession } from "../lib/db";

/** A paid online order or a table request is waiting: the till pops up and rings, while a cashier is signed in. */
export default function TillAlerts() {
  const [who, setWho] = useState<string | null>(null);

  useEffect(() => {
    const look = () => void getActiveSession().then((s) => setWho(s ? s.orgUserId : null)).catch(() => setWho(null));
    look();
    const timer = setInterval(look, 5000);
    return () => clearInterval(timer);
  }, []);

  if (!who) return null;
  return (
    <ActivityAlerts
      key={who}
      storageKey={`zaroda-till-alerts:${who}`}
      LinkComponent={Link}
      fetchItems={async () => {
        const session = await getActiveSession();
        if (!session) return [];
        return (await apiGet<{ items: AlertItem[] }>("/alerts/staff", session.accessToken)).items;
      }}
    />
  );
}
