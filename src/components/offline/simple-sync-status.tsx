"use client";

import { useState, useEffect } from "react";
import { Cloud, CloudOff, Check, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getQueueLength,
  processQueue,
  setupAutoSync,
} from "@/lib/offline/simple-queue";

export function SimpleSyncStatus() {
  const [isMounted, setIsMounted] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    // Prevent hydration mismatch
    setIsMounted(true);

    // Initial state
    setIsOnline(navigator.onLine);
    setPendingCount(getQueueLength());

    // Listen for online/offline
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Set up auto sync
    const cleanup = setupAutoSync((result) => {
      setPendingCount(getQueueLength());
      if (result.synced > 0) {
        // Silently synced
      }
    });

    // Check queue periodically
    const interval = setInterval(() => {
      setPendingCount(getQueueLength());
    }, 2000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      cleanup();
      clearInterval(interval);
    };
  }, []);

  const handleSync = async () => {
    if (!isOnline || isSyncing) return;

    setIsSyncing(true);
    await processQueue();
    setPendingCount(getQueueLength());
    setIsSyncing(false);
  };

  // Don't render until mounted to prevent hydration mismatch
  if (!isMounted) {
    return null;
  }

  // Don't show anything if online and no pending items
  if (isOnline && pendingCount === 0 && !isSyncing) {
    return null;
  }

  return (
    <button
      onClick={handleSync}
      disabled={!isOnline || isSyncing}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors",
        "hover:bg-muted focus:outline-none",
        !isOnline
          ? "text-amber-500"
          : isSyncing
            ? "text-blue-500"
            : pendingCount > 0
              ? "text-blue-500"
              : "text-green-500"
      )}
      title={
        !isOnline
          ? "Offline - changes saved locally"
          : isSyncing
            ? "Syncing..."
            : pendingCount > 0
              ? `${pendingCount} pending - tap to sync`
              : "All synced"
      }
    >
      {!isOnline ? (
        <CloudOff className="h-3.5 w-3.5" />
      ) : isSyncing ? (
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
      ) : pendingCount > 0 ? (
        <>
          <Cloud className="h-3.5 w-3.5" />
          <span>{pendingCount}</span>
        </>
      ) : (
        <Check className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
