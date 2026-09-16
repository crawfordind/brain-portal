"use client";

import { useSyncStatus } from "@/hooks/use-sync-status";
import { Cloud, CloudOff, RefreshCw, AlertCircle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function SyncStatusIndicator() {
  const { status, isOnline, pendingCount, triggerSync, isSyncing } =
    useSyncStatus();

  const getIcon = () => {
    if (!isOnline) {
      return <CloudOff className="h-4 w-4" />;
    }
    if (isSyncing) {
      return <RefreshCw className="h-4 w-4 animate-spin" />;
    }
    if (status.state === "error") {
      return <AlertCircle className="h-4 w-4" />;
    }
    if (pendingCount > 0) {
      return <Cloud className="h-4 w-4" />;
    }
    return <Check className="h-4 w-4" />;
  };

  const getColor = () => {
    if (!isOnline) return "text-amber-500";
    if (status.state === "error") return "text-red-500";
    if (pendingCount > 0) return "text-blue-500";
    return "text-green-500";
  };

  const getTitle = () => {
    if (!isOnline) {
      return "You are offline. Changes will sync when connected.";
    }
    if (isSyncing) {
      return "Syncing changes...";
    }
    if (status.state === "error") {
      return "Sync error. Tap to retry.";
    }
    if (pendingCount > 0) {
      return `${pendingCount} change${pendingCount > 1 ? "s" : ""} pending sync`;
    }
    return "All changes synced";
  };

  return (
    <button
      onClick={() => triggerSync()}
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors",
        "hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        getColor()
      )}
      disabled={!isOnline || isSyncing}
      title={getTitle()}
    >
      {getIcon()}
      {pendingCount > 0 && (
        <span className="text-xs font-medium tabular-nums">{pendingCount}</span>
      )}
    </button>
  );
}
