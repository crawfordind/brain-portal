"use client";

/**
 * "Needs you" — the dashboard's single attention row.
 *
 * Before this there were three competing places to learn that something was
 * waiting: a full-width notification banner inside the feed, the bell in the
 * header, and a count in the sidebar. None of them knew about overdue tasks or
 * about the CRM at all, and the banner's "awaiting review" number was derived
 * from the 30 items the feed happened to have loaded, so it disagreed with the
 * sidebar's.
 *
 * One row, one number per thing, sourced from the server. It renders **nothing**
 * when nothing is waiting — the reward for an empty queue is an empty space, not
 * a row of zeroes.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Bell, Bot, CalendarClock, UserSearch } from "lucide-react";
import { cn } from "@/lib/utils";

export interface NeedsYouCounts {
  overdueTasks: number;
  dueTodayTasks: number;
  awaitingReview: number;
  crmNeedsReview: number;
  crmFollowUpsDue: number;
}

type Tone = "urgent" | "active" | "neutral";

const TONE_CLASSES: Record<Tone, string> = {
  urgent:
    "border-destructive/30 bg-destructive/5 text-destructive hover:bg-destructive/10",
  active:
    "border-primary/25 bg-primary/5 text-primary hover:bg-primary/10",
  neutral:
    "border-border bg-muted/40 text-foreground hover:bg-muted",
};

interface Pill {
  key: string;
  count: number;
  label: string;
  icon: typeof Bell;
  tone: Tone;
  href?: string;
  onClick?: () => void;
}

export function NeedsYou({ counts }: { counts: NeedsYouCounts }) {
  // The bell's unread count is the one number with no server-rendered source,
  // because it changes while the page is open.
  const { data } = useQuery({
    queryKey: ["notifications-count"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?countOnly=true");
      if (!res.ok) return { unreadCount: 0 };
      return res.json() as Promise<{ unreadCount: number }>;
    },
    staleTime: 15000,
  });
  const unread = data?.unreadCount ?? 0;

  const pills: Pill[] = ([
    {
      key: "overdue",
      count: counts.overdueTasks,
      label: "overdue",
      icon: AlertTriangle,
      tone: "urgent",
      href: "/tasks",
    },
    {
      key: "review",
      count: counts.awaitingReview,
      label: "to review",
      icon: Bot,
      tone: "active",
      href: "/review",
    },
    {
      key: "crm-review",
      count: counts.crmNeedsReview,
      label: "contacts to sort",
      icon: UserSearch,
      tone: "active",
      href: "/crm?tab=unresolved",
    },
    {
      key: "crm-followup",
      count: counts.crmFollowUpsDue,
      label: "follow-ups due",
      icon: CalendarClock,
      tone: "active",
      href: "/crm",
    },
    {
      key: "due-today",
      count: counts.dueTodayTasks,
      label: "due today",
      icon: CalendarClock,
      tone: "neutral",
      href: "/tasks",
    },
    {
      key: "notifications",
      count: unread,
      label: unread === 1 ? "notification" : "notifications",
      icon: Bell,
      tone: "neutral",
      onClick: () =>
        window.dispatchEvent(new CustomEvent("open-notifications")),
    },
  ] satisfies Pill[]).filter((pill) => pill.count > 0);

  if (pills.length === 0) return null;

  return (
    <div
      className="flex gap-2 overflow-x-auto scrollbar-none pb-0.5"
      aria-label="Needs your attention"
    >
      {pills.map(({ key, count, label, icon: Icon, tone, href, onClick }) => {
        const className = cn(
          "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5",
          "text-xs font-medium whitespace-nowrap transition-colors",
          TONE_CLASSES[tone]
        );
        const body = (
          <>
            <Icon className="h-3.5 w-3.5" />
            <span className="tabular-nums">{count}</span>
            <span className="font-normal opacity-80">{label}</span>
          </>
        );

        return href ? (
          <Link key={key} href={href} className={className}>
            {body}
          </Link>
        ) : (
          <button key={key} type="button" onClick={onClick} className={className}>
            {body}
          </button>
        );
      })}
    </div>
  );
}
