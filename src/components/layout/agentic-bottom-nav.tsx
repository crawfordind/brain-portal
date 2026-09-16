"use client";

/**
 * Agentic Bottom Nav - 4-button mobile navigation with more menu
 *
 * Layout: Tasks | Brain (center) | Notes | More
 * The center Brain button is the primary stream/home entry point.
 *
 * "More" opens a bottom sheet holding everything the four buttons cannot:
 * Review, Contacts, Journal, Projects, Settings, and Sign Out. Two changes
 * matter here:
 *
 * - **Contacts is in it.** The CRM shipped with four screens and no mobile
 *   entry point whatsoever, so on a phone it was unreachable except by typing
 *   the URL.
 * - **"Notifications" is not.** It pointed at `/settings#notifications`, a
 *   second door onto the Settings row directly above it, while the actual
 *   notification bell sits in the header on mobile too.
 *
 * The sheet's items carry badges and the More button carries a dot, so work
 * waiting behind it is visible without opening it.
 */

import Link from "next/link";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActiveRoute } from "@/lib/navigation";
import {
  CheckSquare,
  FileText,
  Brain,
  Menu,
  Settings,
  BookOpen,
  FolderKanban,
  LogOut,
  X,
  Contact,
  Bot,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { useReviewCount } from "@/hooks/use-review-count";
import { useCrmAttentionCount } from "@/hooks/use-crm-attention";

export function AgenticBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [moreOpen, setMoreOpen] = useState(false);
  const reviewCount = useReviewCount();
  const crmCount = useCrmAttentionCount();

  useEffect(() => {
    if (!moreOpen) return;
    const handlePopState = () => setMoreOpen(false);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [moreOpen]);

  useEffect(() => {
    if (moreOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [moreOpen]);

  const isTasksActive = isActiveRoute(pathname, "/tasks");
  const isBrainActive = pathname === "/" || isActiveRoute(pathname, "/stream");
  const isNotesActive = isActiveRoute(pathname, "/notes");
  const isMoreContext =
    isActiveRoute(pathname, "/settings") ||
    isActiveRoute(pathname, "/journal") ||
    isActiveRoute(pathname, "/projects") ||
    isActiveRoute(pathname, "/crm") ||
    isActiveRoute(pathname, "/review");

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/auth/login");
      toast.success("Logged out");
    } catch {
      toast.error("Failed to logout");
    }
  };

  // Ordered so the two entries that can be *waiting on the user* come first.
  const moreItems = [
    { name: "Review", href: "/review", icon: Bot, description: "Agent output awaiting you", badge: reviewCount },
    { name: "Contacts", href: "/crm", icon: Contact, description: "People, orgs and ventures", badge: crmCount },
    { name: "Journal", href: "/journal", icon: BookOpen, description: "Daily journal", badge: 0 },
    { name: "Projects", href: "/projects", icon: FolderKanban, description: "Workspaces", badge: 0 },
    { name: "Settings", href: "/settings", icon: Settings, description: "Preferences & export", badge: 0 },
  ];

  // The dot only promises "something is behind this button", so it fires for
  // either queue; the sheet itself says which.
  const morePending = reviewCount + crmCount;

  return (
    <>
      {/* Bottom Sheet overlay */}
      {moreOpen && (
        <div className="fixed inset-0 z-[101]" onClick={() => setMoreOpen(false)}>
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
          {/* Sheet */}
          <div
            className="absolute bottom-0 left-0 right-0 bg-background rounded-t-2xl border-t shadow-2xl animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-2">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            {/* Header */}
            <div className="flex items-center justify-between px-5 pb-3">
              <h3 className="text-sm font-semibold">More</h3>
              <button
                onClick={() => setMoreOpen(false)}
                className="h-8 w-8 flex items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {/* Menu items */}
            <div className="px-3 pb-2 space-y-0.5">
              {moreItems.map((item) => {
                const Icon = item.icon;
                const isActive = isActiveRoute(pathname, item.href);
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-xl transition-colors min-h-[52px]",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted active:bg-muted text-foreground"
                    )}
                  >
                    <div className={cn(
                      "h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0",
                      isActive ? "bg-primary/15" : "bg-muted"
                    )}>
                      <Icon className="h-4.5 w-4.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{item.description}</p>
                    </div>
                    {item.badge > 0 && (
                      <Badge
                        className={cn(
                          "h-5 min-w-5 shrink-0 rounded-full px-1.5 text-[11px] text-white",
                          item.name === "Review" ? "bg-purple-500" : "bg-primary"
                        )}
                      >
                        {item.badge}
                      </Badge>
                    )}
                  </Link>
                );
              })}
            </div>
            {/* Sign out */}
            <div className="px-3 pt-1 pb-1 border-t mx-3">
              <button
                onClick={() => { setMoreOpen(false); handleLogout(); }}
                className="flex items-center gap-3 px-3 py-3 rounded-xl w-full text-left hover:bg-destructive/10 active:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors min-h-[52px]"
              >
                <div className="h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-muted">
                  <LogOut className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">Sign Out</p>
                  <p className="text-[11px] text-muted-foreground">Log out of your account</p>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom nav bar */}
      <nav className="fixed bottom-0 left-0 right-0 z-[100] border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div
          className="grid grid-cols-4 items-end h-18 px-2"
          style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
        >
          {/* Tasks */}
          <Link
            href="/tasks"
            className={cn(
              "col-span-1 flex flex-col items-center justify-center gap-1 py-2",
              "min-h-14 transition-colors",
              isTasksActive
                ? "text-primary"
                : "text-muted-foreground active:text-foreground"
            )}
          >
            <CheckSquare className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-tight">
              Tasks
            </span>
          </Link>

          {/* Brain Center - Stream / Home */}
          <div className="col-span-1 flex flex-col items-center justify-end pb-2">
            <Link
              href="/"
              className="flex flex-col items-center justify-center"
              aria-label="Stream"
            >
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all -translate-y-4 border-4 border-background",
                  "hover:shadow-xl active:scale-95",
                  isBrainActive
                    ? "bg-primary text-primary-foreground ring-2 ring-primary/20"
                    : "bg-primary text-primary-foreground"
                )}
              >
                <Brain className="h-6 w-6" />
              </div>
            </Link>
            <span
              className={cn(
                "text-[10px] font-medium",
                isBrainActive ? "text-primary" : "text-muted-foreground"
              )}
            >
              Stream
            </span>
          </div>

          {/* Notes */}
          <Link
            href="/notes"
            className={cn(
              "col-span-1 flex flex-col items-center justify-center gap-1 py-2",
              "min-h-14 transition-colors",
              isNotesActive
                ? "text-primary"
                : "text-muted-foreground active:text-foreground"
            )}
          >
            <FileText className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-tight">
              Notes
            </span>
          </Link>

          {/* More */}
          <button
            onClick={() => setMoreOpen(true)}
            className={cn(
              "col-span-1 relative flex flex-col items-center justify-center gap-1 py-2",
              "min-h-14 transition-colors",
              isMoreContext || moreOpen
                ? "text-primary"
                : "text-muted-foreground active:text-foreground"
            )}
          >
            <Menu className="h-5 w-5" />
            {morePending > 0 && (
              <span
                className="absolute right-[26%] top-1.5 h-2 w-2 rounded-full bg-purple-500"
                aria-label={`${morePending} item${morePending === 1 ? "" : "s"} need you`}
              />
            )}
            <span className="text-[10px] font-medium leading-tight">
              More
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
