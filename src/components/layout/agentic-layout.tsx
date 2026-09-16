"use client";

/**
 * Agentic Layout - The new consciousness-first layout
 *
 * Key differences from the old ResponsiveLayout:
 * - Agent Dock on the right side (desktop)
 * - Brain Bar replaces the old search bar in the header
 * - Streamlined navigation focused on Stream, Spaces, Notes, Work
 * - Bottom nav includes Brain Bar input on mobile
 */

import { AgenticSidebar } from "./agentic-sidebar";
import { AgenticBottomNav } from "./agentic-bottom-nav";
import { SyncStatusIndicator, OfflineBanner } from "@/components/offline";
import { UnifiedSearch } from "./unified-search";
import { ThemeToggle } from "@/components/theme-toggle";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { SystemHealthIndicator } from "@/components/system/system-health-indicator";
import { Brain } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { appBranding, contentWidthClass } from "@/lib/navigation";
interface AgenticLayoutProps {
  children: React.ReactNode;
}

export function AgenticLayout({ children }: AgenticLayoutProps) {
  // The content measure is a property of the route, not of the layout: a note
  // wants a reading width, the dashboard wants the screen. See
  // `contentWidthClass`.
  const pathname = usePathname();

  return (
    <div className="flex h-screen">
      {/* Desktop sidebar - streamlined */}
      <div className="hidden lg:block">
        <AgenticSidebar />
      </div>

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-h-0 min-w-0">
        {/* Offline banner */}
        <OfflineBanner />

        {/* Header - simplified */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
          <div className="flex h-14 items-center px-4 gap-3">
            {/* Mobile: Brand */}
            <div className="flex items-center gap-2 lg:hidden">
              <Brain className="h-5 w-5 text-primary" />
              <span className="font-semibold text-sm">{appBranding.shortName}</span>
            </div>

            {/* Desktop: Search (keeping as fallback for finding existing items) */}
            <div className="hidden lg:block flex-1">
              <UnifiedSearch variant="desktop" />
            </div>

            {/* Right side actions */}
            <div className="ml-auto flex items-center gap-2">
              <div className="lg:hidden">
                <UnifiedSearch variant="mobile" />
              </div>

              {/* Background-failure alert — renders nothing when healthy */}
              <SystemHealthIndicator />

              {/* Notification bell */}
              <NotificationBell />

              <ThemeToggle />
              <SyncStatusIndicator />
            </div>
          </div>
        </header>

        {/* Content area with Agent Dock */}
        <div className="flex flex-1 overflow-hidden">
          {/* Scrollable main content */}
          <main className="flex-1 overflow-auto">
            <div
              className={cn(
                "container py-4 px-4 md:py-5 md:px-6 lg:px-8 pb-28 lg:pb-6",
                contentWidthClass(pathname)
              )}
            >
              {children}
            </div>
          </main>

          {/* Agent Dock - right sidebar (desktop only) */}
        </div>

        {/* Mobile bottom nav */}
        <div className="lg:hidden">
          <AgenticBottomNav />
        </div>
      </div>
    </div>
  );
}
