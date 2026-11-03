"use client";

/**
 * What the sidebar, the mobile dock and the mobile menu share: one icon per
 * destination, one set of badge counts, one sign-out, the sidebar width
 * preference and the brand mark. The destinations themselves are in
 * `src/lib/nav-destinations.ts`.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  BookOpen,
  Bot,
  CheckSquare,
  Contact,
  FileText,
  FolderKanban,
  Gauge,
  LayoutDashboard,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useInboxCount } from "@/hooks/use-inbox-count";
import { useReviewCount } from "@/hooks/use-review-count";
import { useCrmAttentionCount } from "@/hooks/use-crm-attention";
import { cn } from "@/lib/utils";
import {
  SIDEBAR_STORAGE_KEY,
  formatBadgeCount,
  parseSidebarMode,
  type NavBadgeKind,
  type NavDestination,
  type NavDestinationId,
  type SidebarMode,
} from "@/lib/nav-destinations";

export const NAV_ICONS: Record<NavDestinationId, LucideIcon> = {
  stream: Sparkles,
  operations: Gauge,
  tasks: CheckSquare,
  review: Bot,
  contacts: Contact,
  notes: FileText,
  journal: BookOpen,
  projects: FolderKanban,
  whiteboards: LayoutDashboard,
  settings: Settings,
};

/**
 * Badge counts, read from the same hooks every surface uses, so the sidebar,
 * the dock and the menu can never disagree about how much is waiting.
 */
export function useNavBadges(): (destination: NavDestination) => number {
  const { counts } = useInboxCount();
  const review = useReviewCount();
  const crm = useCrmAttentionCount();
  const byKind: Record<NavBadgeKind, number> = {
    review,
    tasks: counts.recommendations,
    crm,
  };
  return (destination) => (destination.badge ? byKind[destination.badge] ?? 0 : 0);
}

export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    // A full page load, not a router push, so no cached account data
    // survives in memory after signing out.
    window.location.assign(new URL("/auth/login", window.location.origin).href);
  }
}

/** Ask whichever search box is on screen to open (see `UnifiedSearch`). */
export function openSearch(): void {
  window.dispatchEvent(new CustomEvent("brain:open-search"));
}

// ---------------------------------------------------------------------------
// Sidebar width, per device (useSyncExternalStore, like stream density)
// ---------------------------------------------------------------------------

const modeListeners = new Set<() => void>();
let modeSnapshot: SidebarMode | null = null;

function readMode(): SidebarMode {
  try {
    return parseSidebarMode(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
  } catch {
    return "auto";
  }
}

function subscribeMode(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_STORAGE_KEY) {
      modeSnapshot = readMode();
      listener();
    }
  };
  modeListeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    modeListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSidebarMode(): [SidebarMode, (next: SidebarMode) => void] {
  const mode = useSyncExternalStore(
    subscribeMode,
    () => (modeSnapshot ??= readMode()),
    () => "auto" as SidebarMode
  );
  const setMode = useCallback((next: SidebarMode) => {
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice holds for this page load.
    }
    modeSnapshot = next;
    for (const l of modeListeners) l();
  }, []);
  return [mode, setMode];
}

const WIDE_QUERY = "(min-width: 1280px)";

function subscribeWide(listener: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}

/** Whether the screen is wide enough for `auto` to show the full sidebar. */
export function useIsWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => typeof window.matchMedia === "function" && window.matchMedia(WIDE_QUERY).matches,
    () => true
  );
}

// ---------------------------------------------------------------------------
// Brand mark
// ---------------------------------------------------------------------------

/**
 * A small neural network: the same idea as the stream's Mind map, drawn in
 * SVG. A pulse travels the pathways every few seconds and the centre node
 * breathes; both stop under `prefers-reduced-motion` (see `nav.css`).
 */
export function NeuralMark({ className, active = true }: { className?: string; active?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      focusable="false"
      className={cn("nav-neural", active && "nav-neural-live", className)}
    >
      <g className="nav-neural-links" fill="none" strokeLinecap="round">
        <path d="M16 16 L7 8" />
        <path d="M16 16 L26 9" />
        <path d="M16 16 L25 24" />
        <path d="M16 16 L8 24" />
        <path d="M7 8 L16 4 L26 9" />
        <path d="M8 24 L16 28 L25 24" />
      </g>
      <g className="nav-neural-pulses" fill="none" strokeLinecap="round">
        <path pathLength={100} d="M7 8 L16 16 L25 24" />
        <path pathLength={100} d="M26 9 L16 16 L8 24" />
      </g>
      <g className="nav-neural-nodes">
        <circle cx="7" cy="8" r="2" />
        <circle cx="26" cy="9" r="2" />
        <circle cx="25" cy="24" r="2" />
        <circle cx="8" cy="24" r="2" />
        <circle cx="16" cy="4" r="1.4" />
        <circle cx="16" cy="28" r="1.4" />
      </g>
      <circle className="nav-neural-core" cx="16" cy="16" r="3.6" />
    </svg>
  );
}

/** A count bubble. Decorative: the link's own label says what it counts. */
export function NavCount({ count, className }: { count: number; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5",
        "bg-primary text-xs font-semibold leading-none text-primary-foreground tabular-nums",
        "shadow-[0_0_0_2px_var(--background)]",
        className
      )}
    >
      {formatBadgeCount(count)}
    </span>
  );
}
