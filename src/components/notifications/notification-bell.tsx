"use client";

/**
 * Notification Bell - Header icon with unread count badge
 *
 * Features:
 * - Animated bell icon with unread count
 * - Polls for new notifications every 30 seconds
 * - Triggers notification scan on mount and every 5 minutes
 * - Opens the notification panel on click
 */

import { useState, useEffect, useRef } from "react";
import { Bell } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { NotificationPanel } from "./notification-panel";

/** Interval between notification scans (5 minutes) */
const SCAN_INTERVAL = 5 * 60 * 1000;

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const queryClient = useQueryClient();
  const scanTimerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    const handleOpen = () => setIsOpen(true);
    window.addEventListener("open-notifications", handleOpen);
    return () => window.removeEventListener("open-notifications", handleOpen);
  }, []);

  // Run notification scan on mount and every 5 minutes
  useEffect(() => {
    const runScan = async () => {
      try {
        const res = await fetch("/api/notifications/scan", { method: "POST" });
        if (res.ok) {
          const data = await res.json();
          if (data.notificationsCreated > 0) {
            // Refresh count immediately when new notifications are created
            queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
          }
        }
      } catch {
        // Silent fail — scan is best-effort
      }
    };

    // Initial scan after a short delay (let the page load first)
    const initTimer = setTimeout(runScan, 2000);
    // Periodic scan
    scanTimerRef.current = setInterval(runScan, SCAN_INTERVAL);

    return () => {
      clearTimeout(initTimer);
      if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    };
  }, [queryClient]);

  const { data } = useQuery({
    queryKey: ["notifications-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?countOnly=true");
      if (!res.ok) return { unreadCount: 0 };
      return res.json() as Promise<{ unreadCount: number }>;
    },
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const unreadCount = data?.unreadCount || 0;

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "relative flex items-center justify-center h-9 w-9 rounded-lg transition-colors",
          "hover:bg-muted text-muted-foreground hover:text-foreground",
          unreadCount > 0 && "text-foreground"
        )}
        title={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}
      >
        <Bell className={cn("h-[18px] w-[18px]", unreadCount > 0 && "animate-[wiggle_1s_ease-in-out]")} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-red-500 rounded-full leading-none">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
