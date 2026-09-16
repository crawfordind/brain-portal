"use client";

/**
 * Notification Panel - Slide-out panel showing all notifications
 *
 * Features:
 * - Grouped by time (Today, Yesterday, This Week, Older)
 * - Mark as read on click, mark all read, archive
 * - Type-based icons and priority badges
 * - Quick actions per notification
 * - Responsive: sheet on mobile, popover on desktop
 */

import { useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Archive,
  AlertTriangle,
  Clock,
  Bot,
  Sparkles,
  Flame,
  FolderKanban,
  Info,
  Zap,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { Notification, NotificationType } from "@/lib/db/schema";

// ─── Type config ─────────────────────────────────────

const typeConfig: Record<
  NotificationType,
  { icon: typeof Bell; color: string; label: string }
> = {
  reminder_due: { icon: Bell, color: "text-amber-500", label: "Reminder" },
  task_overdue: { icon: AlertTriangle, color: "text-red-500", label: "Overdue" },
  task_due_soon: { icon: Clock, color: "text-orange-500", label: "Due Soon" },
  daily_digest: { icon: Zap, color: "text-blue-500", label: "Digest" },
  weekly_report: { icon: Sparkles, color: "text-purple-500", label: "Report" },
  agent_complete: { icon: Bot, color: "text-green-500", label: "AI Done" },
  agent_failed: { icon: Bot, color: "text-red-500", label: "AI Failed" },
  insight_generated: { icon: Sparkles, color: "text-pink-500", label: "Insight" },
  streak_milestone: { icon: Flame, color: "text-orange-500", label: "Streak" },
  project_stalled: { icon: FolderKanban, color: "text-yellow-500", label: "Stalled" },
  system: { icon: Info, color: "text-zinc-400", label: "System" },
};

const priorityColors: Record<string, string> = {
  urgent: "bg-red-500/10 text-red-500 border-red-500/20",
  high: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  medium: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  low: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
};

// ─── Component ───────────────────────────────────────

interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationPanel({ isOpen, onClose }: NotificationPanelProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=50");
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json() as Promise<{
        notifications: Notification[];
        unreadCount: number;
      }>;
    },
    enabled: isOpen,
    staleTime: 10000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (params: { action: string; ids?: string[] }) => {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-count"] });
    },
  });

  const handleNotificationClick = useCallback(
    (notif: Notification) => {
      // Mark as read
      if (!notif.is_read) {
        markReadMutation.mutate({ action: "mark_read", ids: [notif.id] });
      }
      // Navigate if there's an action URL
      if (notif.action_url) {
        router.push(notif.action_url);
        onClose();
      }
    },
    [markReadMutation, router, onClose]
  );

  const notifications = data?.notifications || [];
  const unreadCount = data?.unreadCount || 0;

  // Group by time
  const groups = groupByTime(notifications);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent side="right" className="w-full sm:max-w-md p-0">
        <SheetHeader className="px-4 py-3 border-b">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-base font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4" />
              Notifications
              {unreadCount > 0 && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0">
                  {unreadCount}
                </Badge>
              )}
            </SheetTitle>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() =>
                    markReadMutation.mutate({ action: "mark_all_read" })
                  }
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1" />
                  Read all
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  markReadMutation.mutate({ action: "archive_all_read" })
                }
              >
                <Archive className="h-3.5 w-3.5 mr-1" />
                Clean up
              </Button>
            </div>
          </div>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-60px)]">
          {isLoading ? (
            <div className="p-8 text-center">
              <div className="animate-pulse space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg" />
                ))}
              </div>
            </div>
          ) : notifications.length === 0 ? (
            <div className="p-12 text-center">
              <BellOff className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">All caught up!</p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                No notifications right now
              </p>
            </div>
          ) : (
            <div className="py-1">
              {groups.map(({ label, items }) => (
                <div key={label}>
                  <div className="px-4 py-2 sticky top-0 bg-background/95 backdrop-blur z-10">
                    <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                      {label}
                    </span>
                  </div>
                  {items.map((notif) => (
                    <NotificationItem
                      key={notif.id}
                      notification={notif}
                      onClick={() => handleNotificationClick(notif)}
                      onArchive={() =>
                        markReadMutation.mutate({
                          action: "archive",
                          ids: [notif.id],
                        })
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

// ─── Notification Item ───────────────────────────────

function NotificationItem({
  notification,
  onClick,
  onArchive,
}: {
  notification: Notification;
  onClick: () => void;
  onArchive: () => void;
}) {
  const config = typeConfig[notification.type] || typeConfig.system;
  const Icon = config.icon;
  const timeAgo = getTimeAgo(notification.created_at);

  return (
    <div
      className={cn(
        "group flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-muted/50",
        !notification.is_read && "bg-primary/[0.03] border-l-2 border-primary"
      )}
      onClick={onClick}
    >
      {/* Icon */}
      <div
        className={cn(
          "flex-shrink-0 mt-0.5 h-8 w-8 rounded-full flex items-center justify-center",
          notification.is_read ? "bg-muted" : "bg-primary/10"
        )}
      >
        <Icon className={cn("h-4 w-4", config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              "text-sm leading-tight",
              notification.is_read
                ? "text-muted-foreground"
                : "text-foreground font-medium"
            )}
          >
            {notification.title}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onArchive();
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
            title="Archive"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
          {notification.body}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[10px] text-muted-foreground/60">
            {timeAgo}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "text-[9px] px-1 py-0 h-4",
              priorityColors[notification.priority]
            )}
          >
            {notification.priority}
          </Badge>
          <Badge
            variant="outline"
            className="text-[9px] px-1 py-0 h-4 border-muted-foreground/20"
          >
            {config.label}
          </Badge>
        </div>
      </div>

      {/* Unread dot */}
      {!notification.is_read && (
        <div className="flex-shrink-0 mt-2">
          <div className="h-2 w-2 rounded-full bg-primary" />
        </div>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────

function groupByTime(
  notifications: Notification[]
): { label: string; items: Notification[] }[] {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const yesterday = new Date(now.getTime() - 86400000)
    .toISOString()
    .split("T")[0];
  const weekAgo = new Date(now.getTime() - 7 * 86400000)
    .toISOString()
    .split("T")[0];

  const groups: Record<string, Notification[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: [],
  };

  for (const notif of notifications) {
    const date = notif.created_at.split("T")[0];
    if (date === today) {
      groups["Today"].push(notif);
    } else if (date === yesterday) {
      groups["Yesterday"].push(notif);
    } else if (date >= weekAgo) {
      groups["This Week"].push(notif);
    } else {
      groups["Older"].push(notif);
    }
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
