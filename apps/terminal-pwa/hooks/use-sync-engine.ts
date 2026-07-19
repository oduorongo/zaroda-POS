"use client";

import { useCallback, useEffect, useState } from "react";
import { syncOutbox } from "../lib/sync";
import { pendingOutboxCount } from "../lib/sync";

/**
 * Runs on mount, on the browser's `online` event, and on a 30s fallback
 * poll (the `online` event isn't always reliable on flaky connections -
 * "online" per navigator.onLine doesn't guarantee requests actually
 * succeed, which is exactly why syncOutbox() treats a failed request as
 * "still offline, try again later" rather than trusting this event alone).
 */
export function useSyncEngine() {
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  const refreshCount = useCallback(async () => {
    setPendingCount(await pendingOutboxCount());
  }, []);

  const runSync = useCallback(async () => {
    setIsSyncing(true);
    try {
      const result = await syncOutbox();
      if (result.synced > 0) setLastSyncedAt(new Date());
      await refreshCount();
      return result;
    } finally {
      setIsSyncing(false);
    }
  }, [refreshCount]);

  useEffect(() => {
    void refreshCount();
    void runSync();

    const onOnline = () => void runSync();
    window.addEventListener("online", onOnline);
    const interval = setInterval(() => void runSync(), 30_000);

    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { pendingCount, isSyncing, lastSyncedAt, runSync };
}
