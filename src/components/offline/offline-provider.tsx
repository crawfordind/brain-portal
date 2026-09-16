"use client";

import { useEffect, useCallback, useRef, createContext, useContext, useState } from "react";
import { toast } from "sonner";
import { offlineDb } from "@/lib/offline/db";
import { getSyncManager } from "@/lib/offline/sync-manager";
import { getPendingCount } from "@/lib/offline/sync-queue";
import { processQueue as processSimpleQueue, getQueueLength } from "@/lib/offline/simple-queue";

interface OfflineContextValue {
  isOnline: boolean;
  isHydrated: boolean;
}

const OfflineContext = createContext<OfflineContextValue>({
  isOnline: true,
  isHydrated: false,
});

export function useOfflineContext() {
  return useContext(OfflineContext);
}

interface OfflineProviderProps {
  children: React.ReactNode;
}

/**
 * OfflineProvider - Root provider for offline-first PWA support.
 *
 * Responsibilities:
 * 1. Hydrate IndexedDB with server data on first load (so offline has data)
 * 2. Listen for online/offline transitions
 * 3. Trigger sync (both Dexie queue and localStorage queue) on reconnection
 * 4. Register for Background Sync API
 * 5. Provide smooth transition feedback via toasts
 */
export function OfflineProvider({ children }: OfflineProviderProps) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [isHydrated, setIsHydrated] = useState(false);
  const wasOfflineRef = useRef(false);
  const syncManagerRef = useRef(getSyncManager());
  const hydrationAttemptedRef = useRef(false);

  // Hydrate IndexedDB with server data for offline use
  const hydrateOfflineData = useCallback(async () => {
    if (hydrationAttemptedRef.current) return;
    hydrationAttemptedRef.current = true;

    try {
      // Check if we've ever synced
      const meta = await offlineDb.syncMetadata.get("global");
      const hasData = meta?.lastFullSync;

      // If we have no data or it's been more than 15 minutes, pull fresh data
      const staleThreshold = 15 * 60 * 1000;
      const isStale = !hasData || (Date.now() - (hasData || 0)) > staleThreshold;

      if (isStale && navigator.onLine) {
        await syncManagerRef.current.pullLatestData();
      }

      setIsHydrated(true);
    } catch (error) {
      console.warn("Offline hydration failed (non-critical):", error);
      setIsHydrated(true);
    }
  }, []);

  // Process both queue systems
  const syncAllQueues = useCallback(async () => {
    const results = await Promise.allSettled([
      syncManagerRef.current.sync(),
      processSimpleQueue(),
    ]);

    let totalSynced = 0;
    let totalFailed = 0;

    for (const result of results) {
      if (result.status === "fulfilled") {
        const val = result.value;
        if (val && typeof val === "object") {
          if ("syncedCount" in val) {
            totalSynced += val.syncedCount;
            totalFailed += val.failedCount;
          } else if ("synced" in val) {
            totalSynced += val.synced;
            totalFailed += val.failed;
          }
        }
      }
    }

    return { synced: totalSynced, failed: totalFailed };
  }, []);

  // Register for Background Sync
  const registerBackgroundSync = useCallback(async () => {
    if (!("serviceWorker" in navigator)) return;

    try {
      const registration = await navigator.serviceWorker.ready;
      if ("sync" in registration) {
        await (registration as ServiceWorkerRegistration & {
          sync: { register: (tag: string) => Promise<void> };
        }).sync.register("sync-pending-changes");
      }
    } catch {
      // Background Sync not supported or failed - that's fine
    }
  }, []);

  // Request SW to pre-cache key pages for offline navigation
  const precacheAppShell = useCallback(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;

    navigator.serviceWorker.controller.postMessage({
      type: "CACHE_URLS",
      urls: ["/", "/offline"],
    });
  }, []);

  useEffect(() => {
    // --- Online/Offline event handlers ---
    const handleOnline = async () => {
      setIsOnline(true);

      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;

        // Check if there's pending data to sync
        const [dexiePending, simplePending] = await Promise.all([
          getPendingCount().catch(() => 0),
          Promise.resolve(getQueueLength()),
        ]);

        const totalPending = dexiePending + simplePending;

        if (totalPending > 0) {
          toast.info("Back online", {
            description: `Syncing ${totalPending} pending change${totalPending > 1 ? "s" : ""}...`,
            duration: 3000,
          });

          const { synced, failed } = await syncAllQueues();

          if (failed > 0) {
            toast.warning("Sync partially completed", {
              description: `${synced} synced, ${failed} failed. Will retry automatically.`,
              duration: 5000,
            });
          } else if (synced > 0) {
            toast.success("All changes synced", {
              description: `${synced} change${synced > 1 ? "s" : ""} saved to server.`,
              duration: 3000,
            });
          }
        } else {
          toast.success("Back online", { duration: 2000 });
        }

        // Re-hydrate to pick up any changes made on other devices
        hydrationAttemptedRef.current = false;
        hydrateOfflineData();
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      wasOfflineRef.current = true;

      toast.warning("You're offline", {
        description: "Changes will be saved locally and synced when you reconnect.",
        duration: 4000,
      });

      // Register background sync so the SW can sync when network is available
      registerBackgroundSync();
    };

    // --- Service Worker message handler ---
    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === "SYNC_REQUESTED") {
        syncAllQueues();
      }
      if (event.data?.type === "FULL_SYNC_REQUESTED") {
        syncManagerRef.current.pullLatestData();
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("message", handleSWMessage);
    }

    // --- Initial setup ---
    if (navigator.onLine) {
      hydrateOfflineData();
      precacheAppShell();

      // If there are pending changes from a previous session, sync them
      Promise.all([
        getPendingCount().catch(() => 0),
        Promise.resolve(getQueueLength()),
      ]).then(([dexiePending, simplePending]) => {
        if (dexiePending + simplePending > 0) {
          syncAllQueues();
        }
      });
    } else {
      wasOfflineRef.current = true;
      setIsHydrated(true);
    }

    // Periodic data freshness check (every 5 minutes when online)
    const refreshInterval = setInterval(() => {
      if (navigator.onLine) {
        hydrationAttemptedRef.current = false;
        hydrateOfflineData();
      }
    }, 5 * 60 * 1000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(refreshInterval);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("message", handleSWMessage);
      }
    };
  }, [hydrateOfflineData, syncAllQueues, registerBackgroundSync, precacheAppShell]);

  return (
    <OfflineContext.Provider value={{ isOnline, isHydrated }}>
      {children}
    </OfflineContext.Provider>
  );
}
