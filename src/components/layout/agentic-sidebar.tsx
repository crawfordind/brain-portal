"use client";

/**
 * Agentic Sidebar - Streamlined navigation
 *
 * Two groups, ordered by how often a destination has something waiting in it
 * rather than by when it was built:
 *
 *   Today   Stream, Tasks, Review, Contacts — the four that carry badges
 *   Library Notes, Journal, Projects — where things are kept, not pending
 *
 * Every entry resolves to a distinct destination. "Brain" used to sit here
 * pointing at `/tasks?view=queue` — a view value the Work page did not accept —
 * so it silently landed on the same screen as Work. It is now "Review", which
 * is a real route. "Spaces" was likewise renamed "Projects": the route, the
 * page heading and the mobile menu all already called it that, so the sidebar
 * was the only surface using a word that appeared nowhere else.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Brain, Zap, FileText, FolderKanban, CheckSquare, Settings, BookOpen, Bot, Contact } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { SyncStatusIndicator } from "@/components/offline";
import { useInboxCount } from "@/hooks/use-inbox-count";
import { PinnedNotesStrip } from "./pinned-notes-strip";
import { isActiveRoute, appBranding } from "@/lib/navigation";
import { useReviewCount } from "@/hooks/use-review-count";
import { useCrmAttentionCount } from "@/hooks/use-crm-attention";

type BadgeKind = "review" | "tasks" | "crm" | null;

interface SidebarItem {
  name: string;
  href: string;
  icon: typeof Zap;
  badge?: BadgeKind;
}

const todayNav: SidebarItem[] = [
  { name: "Stream", href: "/", icon: Zap },
  { name: "Tasks", href: "/tasks", icon: CheckSquare, badge: "tasks" },
  { name: "Review", href: "/review", icon: Bot, badge: "review" },
  { name: "Contacts", href: "/crm", icon: Contact, badge: "crm" },
];

const libraryNav: SidebarItem[] = [
  { name: "Notes", href: "/notes", icon: FileText },
  { name: "Journal", href: "/journal", icon: BookOpen },
  { name: "Projects", href: "/projects", icon: FolderKanban },
];

const secondaryNav = [
  { name: "Settings", href: "/settings", icon: Settings },
];

export function AgenticSidebar() {
  const pathname = usePathname();
  const { counts } = useInboxCount();
  const reviewCount = useReviewCount();
  const crmCount = useCrmAttentionCount();

  const badgeFor = (kind: BadgeKind): number => {
    if (kind === "review") return reviewCount;
    if (kind === "tasks") return counts.recommendations;
    if (kind === "crm") return crmCount;
    return 0;
  };

  const renderItem = (item: SidebarItem) => {
    const Icon = item.icon;
    const isActive = isActiveRoute(pathname, item.href);
    const badgeCount = badgeFor(item.badge ?? null);

    return (
      <Link
        key={item.name}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
          isActive
            ? "bg-primary/10 text-primary font-medium"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
        <span className="flex-1">{item.name}</span>
        {badgeCount > 0 && (
          <Badge
            variant="default"
            className={cn(
              "text-[10px] h-4 px-1.5",
              item.badge === "review" && "bg-purple-500 text-white hover:bg-purple-500"
            )}
          >
            {badgeCount}
          </Badge>
        )}
      </Link>
    );
  };

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/auth/login";
  };

  return (
    <div className="flex h-full w-60 flex-col border-r bg-background">
      {/* Brand */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
            <Brain className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <span className="font-semibold text-sm">{appBranding.name}</span>
          </div>
        </div>
        <SyncStatusIndicator />
      </div>

      {/* Navigation */}
      <ScrollArea className="flex-1 px-3 py-3">
        <nav className="space-y-0.5">{todayNav.map(renderItem)}</nav>

        <Separator className="my-3" />

        <nav className="space-y-0.5">{libraryNav.map(renderItem)}</nav>

        <Separator className="my-3" />

        {/* Secondary nav */}
        <nav className="space-y-0.5">
          {secondaryNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        <Separator className="my-3" />

        {/* Pinned notes */}
        <PinnedNotesStrip variant="desktop" />
      </ScrollArea>

      {/* User section */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground text-xs"
          onClick={handleLogout}
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
