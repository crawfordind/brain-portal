"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { offlineDb } from "@/lib/offline/db";
import { getSyncManager, SyncStatus } from "@/lib/offline/sync-manager";
import { getQueueLength } from "@/lib/offline/simple-queue";

export function useSyncStatus() {
  const [syncState, setSyncState] = useState<"idle" | "syncing">("idle");
  // Use navigator.onLine directly - it's reliable enough for initial state
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const syncManagerRef = useRef(
    getSyncManager((status) => {
      setSyncState(status.state === "syncing" ? "syncing" : "idle");
    })
  );

  // Live query for pending sync count from IndexedDB
  const dexiePendingCount = useLiveQuery(
    () => offlineDb.syncQueue.where("status").equals("pending").count(),
    [],
    0
  );

  // Also account for localStorage simple queue
  const [simplePendingCount, setSimplePendingCount] = useState(0);
  useEffect(() => {
    setSimplePendingCount(getQueueLength());
    const interval = setInterval(() => setSimplePendingCount(getQueueLength()), 10000);
    return () => clearInterval(interval);
  }, []);

  const pendingCount = dexiePendingCount + simplePendingCount;

  // Derive status from state (no effect needed)
  const status: SyncStatus = useMemo(() => {
    if (!isOnline) {
      return { state: "offline", pending: pendingCount };
    }
    if (syncState === "syncing") {
      return { state: "syncing", pending: pendingCount };
    }
    if (pendingCount > 0) {
      return { state: "pending", pending: pendingCount };
    }
    return { state: "synced", pending: 0 };
  }, [isOnline, syncState, pendingCount]);

  // Network status listeners
  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      // Auto-sync when coming back online
      syncManagerRef.current.sync();
    };

    const handleOffline = () => {
      setIsOnline(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Listen for service worker sync messages
    if ("serviceWorker" in navigator) {
      const handleMessage = (event: MessageEvent) => {
        if (event.data?.type === "SYNC_REQUESTED") {
          syncManagerRef.current.sync();
        }
        if (event.data?.type === "FULL_SYNC_REQUESTED") {
          syncManagerRef.current.pullLatestData();
        }
      };

      navigator.serviceWorker.addEventListener("message", handleMessage);

      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
        navigator.serviceWorker.removeEventListener("message", handleMessage);
      };
    }

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Trigger a sync
  const triggerSync = useCallback(() => {
    if (isOnline && !syncManagerRef.current.syncing) {
      syncManagerRef.current.sync();
    }
  }, [isOnline]);

  // Force a full data pull from server
  const forceFullSync = useCallback(async () => {
    if (isOnline) {
      await syncManagerRef.current.pullLatestData();
    }
  }, [isOnline]);

  return {
    status,
    isOnline,
    pendingCount,
    triggerSync,
    forceFullSync,
    isSyncing: status.state === "syncing",
  };
}
