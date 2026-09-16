"use client";

import { useState, useEffect } from "react";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OfflineBanner() {
  const { isOnline, pendingCount, triggerSync, isSyncing } = useSyncStatus();
  const [visible, setVisible] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);
  const [showReconnected, setShowReconnected] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      setVisible(true);
      setWasOffline(true);
      setShowReconnected(false);
    } else if (wasOffline) {
      // Just came back online - show brief "reconnected" state
      setShowReconnected(true);
      setWasOffline(false);
      const timer = setTimeout(() => {
        setShowReconnected(false);
        if (pendingCount === 0) {
          setVisible(false);
        }
      }, 2500);
      return () => clearTimeout(timer);
    } else if (pendingCount > 0) {
      setVisible(true);
    } else {
      setVisible(false);
    }
  }, [isOnline, wasOffline, pendingCount]);

  if (!visible) return null;

  return (
    <div
      className={cn(
        "w-full px-4 py-2 text-center text-sm font-medium transition-all duration-300 ease-in-out",
        !isOnline
          ? "bg-amber-500/90 text-amber-950 dark:bg-amber-600/90 dark:text-amber-50"
          : showReconnected
            ? "bg-green-500/90 text-white"
            : "bg-blue-500/90 text-white"
      )}
    >
      <div className="flex items-center justify-center gap-2">
        {!isOnline ? (
          <>
            <WifiOff className="h-4 w-4 shrink-0" />
            <span>You&apos;re offline. Changes are saved locally.</span>
          </>
        ) : showReconnected ? (
          <>
            <Wifi className="h-4 w-4 shrink-0" />
            <span>Back online{pendingCount > 0 ? " - syncing..." : "!"}</span>
          </>
        ) : (
          <>
            <span>
              {pendingCount} change{pendingCount > 1 ? "s" : ""} pending
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={triggerSync}
              disabled={isSyncing}
              className="h-7 px-2 text-xs"
            >
              {isSyncing ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                "Sync Now"
              )}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
