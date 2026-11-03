"use client";

/**
 * The signed-in app shell.
 *
 * - **1024px and up**: the sidebar (full or rail, see `AgenticSidebar`) beside
 *   a header carrying search and status.
 * - **Below 1024px**: a header that names the current section, so the user
 *   always knows where they are, and the floating dock (`AgenticBottomNav`).
 *
 * Both menus read one destination table (`src/lib/nav-destinations.ts`). A
 * "Skip to content" link is the first thing a keyboard reaches.
 */

import { AgenticSidebar } from "./agentic-sidebar";
import { AgenticBottomNav } from "./agentic-bottom-nav";
import { SyncStatusIndicator, OfflineBanner } from "@/components/offline";
import { UnifiedSearch } from "./unified-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SystemHealthIndicator } from "@/components/system/system-health-indicator";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { appBranding, contentWidthClass } from "@/lib/navigation";
import { sectionTitle } from "@/lib/nav-destinations";
import { NeuralMark } from "./nav-shared";

interface AgenticLayoutProps {
  children: React.ReactNode;
}

export function AgenticLayout({ children }: AgenticLayoutProps) {
  // The content measure is a property of the route, not of the layout: a note
  // wants a reading width, the dashboard wants the screen. See
  // `contentWidthClass`.
  const pathname = usePathname();
  const title = sectionTitle(pathname);
  // Home is the brain, full screen: no content column, no padding, and the
  // header floats over it as glass so the brain runs to the top edge.
  const isHome = pathname === "/";

  return (
    <div className="flex h-dvh">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-xl focus:bg-primary focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <AgenticSidebar />
      </div>

      {/* Main content area */}
      <div className="relative flex flex-1 flex-col min-h-0 min-w-0">
        <OfflineBanner />

        <header
          className={cn(
            "nav-glass top-0 z-40 border-b border-[var(--nav-edge)]",
            isHome ? "absolute inset-x-0" : "sticky"
          )}
        >
          <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
            {/* Phone and tablet: brand mark + where you are */}
            <Link
              href="/"
              aria-label={`${appBranding.name}, go to Stream`}
              className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                <NeuralMark className="h-6 w-6" />
              </span>
              <span className="truncate text-base font-semibold tracking-tight">
                {title ?? appBranding.shortName}
              </span>
            </Link>

            {/* Desktop: search */}
            <div className="hidden lg:block flex-1">
              <UnifiedSearch variant="desktop" />
            </div>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <div className="lg:hidden">
                <UnifiedSearch variant="mobile" />
              </div>

              {/* Background-failure alert — renders nothing when healthy */}
              <SystemHealthIndicator />

              <NotificationBell />

              {/* On a phone, appearance lives in the dock's Menu. */}
              <div className="hidden sm:block">
                <ThemeToggle />
              </div>
              <SyncStatusIndicator />
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          <main
            id="main-content"
            tabIndex={-1}
            className={cn("flex-1 outline-none", isHome ? "relative overflow-hidden" : "overflow-auto")}
          >
            {isHome ? (
              children
            ) : (
              <div
                className={cn(
                  "container py-4 px-4 md:py-5 md:px-6 lg:px-8 pb-[calc(var(--mobile-nav-height)+2.5rem)] lg:pb-6",
                  contentWidthClass(pathname)
                )}
              >
                {children}
              </div>
            )}
          </main>
        </div>

        {/* Phone and tablet dock */}
        <div className="lg:hidden">
          <AgenticBottomNav />
        </div>
      </div>
    </div>
  );
}
