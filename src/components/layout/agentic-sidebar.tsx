"use client";

/**
 * Desktop sidebar (1024px and up).
 *
 * Two widths, one set of destinations (`src/lib/nav-destinations.ts`):
 *
 * - **Full** (256px): icon, name and count for every destination, grouped
 *   Today / Library / System, plus pinned notes.
 * - **Rail** (72px): icons with counts, each named in a tooltip and in its
 *   accessible label.
 *
 * `auto` (the default) is the rail on a laptop-width screen and the full
 * sidebar from 1280px. The toggle at the bottom picks one explicitly, per
 * device. Width is decided in CSS from `data-mode`, so the server render and
 * the first paint already have the right width; JavaScript is only needed for
 * the tooltips, which matter only after hydration anyway.
 *
 * Exactly one entry is "you are here" (`activeDestinationId`), marked with
 * `aria-current="page"` and a glowing bar that glides between entries.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { motion, MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";
import { appBranding } from "@/lib/navigation";
import {
  NAV_GROUP_LABELS,
  accessibleNavLabel,
  activeDestinationId,
  destinationsInGroup,
  nextSidebarMode,
  sidebarShowsFull,
  type NavDestination,
  type NavGroup,
} from "@/lib/nav-destinations";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PinnedNotesStrip } from "./pinned-notes-strip";
import {
  NAV_ICONS,
  NavCount,
  NeuralMark,
  signOut,
  useIsWideScreen,
  useNavBadges,
  useSidebarMode,
} from "./nav-shared";

/*
 * Visibility by width. The aside carries `data-mode` and is the `sidebar`
 * group; `auto` switches at xl.
 */
const FULL_ONLY_BLOCK =
  "hidden group-data-[mode=full]/sidebar:block xl:group-data-[mode=auto]/sidebar:block";
const FULL_ONLY_FLEX =
  "hidden group-data-[mode=full]/sidebar:flex xl:group-data-[mode=auto]/sidebar:flex";
const RAIL_ONLY =
  "block group-data-[mode=full]/sidebar:hidden xl:group-data-[mode=auto]/sidebar:hidden";

const GROUPS: NavGroup[] = ["today", "library", "system"];

export function AgenticSidebar() {
  const pathname = usePathname();
  const activeId = activeDestinationId(pathname);
  const badgeFor = useNavBadges();
  const [mode, setMode] = useSidebarMode();
  const wide = useIsWideScreen();
  const showingFull = sidebarShowsFull(mode, wide ? 1280 : 1024);

  const renderItem = (destination: NavDestination) => {
    const Icon = NAV_ICONS[destination.id];
    const isActive = destination.id === activeId;
    const count = badgeFor(destination);

    const link = (
      <Link
        href={destination.href}
        aria-current={isActive ? "page" : undefined}
        aria-label={accessibleNavLabel(destination, count)}
        className={cn(
          "group/item relative flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm outline-none transition-colors",
          "justify-center group-data-[mode=full]/sidebar:justify-start xl:group-data-[mode=auto]/sidebar:justify-start",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          isActive
            ? "font-medium text-foreground"
            : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        )}
      >
        {isActive && (
          <motion.span
            layoutId="sidebar-active"
            className="nav-active-fill absolute inset-0 rounded-xl"
            transition={{ type: "spring", stiffness: 420, damping: 36 }}
            aria-hidden="true"
          >
            <span className="nav-active-bar absolute -left-3 top-2 bottom-2 w-[3px] rounded-full" />
          </motion.span>
        )}

        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon
            className={cn(
              "h-[18px] w-[18px] transition-transform group-hover/item:scale-110",
              isActive && "nav-active-icon"
            )}
            aria-hidden="true"
          />
          {/* Rail: the count rides on the icon. */}
          <NavCount count={count} className={cn("absolute -right-3 -top-2.5", RAIL_ONLY)} />
        </span>

        <span className={cn("relative flex-1 truncate", FULL_ONLY_BLOCK)}>{destination.label}</span>
        <NavCount count={count} className={cn("relative", FULL_ONLY_FLEX)} />
      </Link>
    );

    return (
      <li key={destination.id}>
        {showingFull ? (
          link
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={10} className="max-w-56">
              <p className="font-medium">{destination.label}</p>
              <p className="text-xs text-muted-foreground">{destination.description}</p>
            </TooltipContent>
          </Tooltip>
        )}
      </li>
    );
  };

  const toggleLabel = showingFull ? "Collapse sidebar to icons" : "Expand sidebar";

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider delayDuration={150} skipDelayDuration={300}>
        <aside
          data-sidebar
          data-mode={mode}
          aria-label="Sidebar"
          className={cn(
            "group/sidebar nav-glass relative flex h-full flex-col border-r border-[var(--nav-edge)]",
            "w-[4.5rem] data-[mode=full]:w-64 xl:data-[mode=auto]:w-64",
            "motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out"
          )}
        >
          {/* Brand */}
          <div className="flex h-14 shrink-0 items-center gap-2.5 px-4 justify-center group-data-[mode=full]/sidebar:justify-start xl:group-data-[mode=auto]/sidebar:justify-start">
            <Link
              href="/"
              aria-label={`${appBranding.name}, go to Stream`}
              className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <NeuralMark className="h-7 w-7" />
              </span>
              <span className={cn("text-[15px] font-semibold tracking-tight", FULL_ONLY_BLOCK)}>
                {appBranding.name}
              </span>
            </Link>
          </div>

          <div className="nav-divider mx-3" />

          {/* Destinations */}
          <nav aria-label="Primary" className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
            {GROUPS.map((group, i) => {
              const items = destinationsInGroup(group);
              const headingId = `sidebar-group-${group}`;
              return (
                <div key={group} className={cn(i > 0 && "mt-4")}>
                  <p
                    id={headingId}
                    className={cn(
                      "mb-1 px-3 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground/80",
                      FULL_ONLY_BLOCK
                    )}
                  >
                    {NAV_GROUP_LABELS[group]}
                  </p>
                  {i > 0 && <div className={cn("nav-divider mx-2 mb-3", RAIL_ONLY)} aria-hidden="true" />}
                  <ul aria-labelledby={headingId} className="space-y-0.5">
                    {items.map(renderItem)}
                  </ul>
                </div>
              );
            })}

            <div className={cn("mt-5", FULL_ONLY_BLOCK)}>
              <PinnedNotesStrip variant="desktop" />
            </div>
          </nav>

          <div className="nav-divider mx-3" />

          {/* Footer: width toggle and sign out */}
          <div className="flex shrink-0 flex-col gap-1 p-3 group-data-[mode=full]/sidebar:flex-row xl:group-data-[mode=auto]/sidebar:flex-row">
            <button
              type="button"
              onClick={() => setMode(nextSidebarMode(mode, showingFull))}
              aria-label={toggleLabel}
              title={toggleLabel}
              className="flex h-10 w-full items-center justify-center rounded-xl text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring group-data-[mode=full]/sidebar:w-10 xl:group-data-[mode=auto]/sidebar:w-10"
            >
              {showingFull ? (
                <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              onClick={() => void signOut()}
              aria-label="Sign out"
              title="Sign out"
              className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring group-data-[mode=full]/sidebar:justify-start xl:group-data-[mode=auto]/sidebar:justify-start"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className={FULL_ONLY_BLOCK}>Sign out</span>
            </button>
          </div>
        </aside>
      </TooltipProvider>
    </MotionConfig>
  );
}
