"use client";

/**
 * Phone and tablet navigation (below 1024px): a floating glass dock.
 *
 *   Tasks | Ops | ( Stream ) | Notes | Menu
 *
 * Stream is the glowing orb in the centre, the same "one thing at the centre"
 * idea as the Mind map. The active destination gets a pill that glides between
 * buttons. On a tablet the dock stays a centred pill instead of stretching
 * edge to edge.
 *
 * **Menu** opens a sheet with everything the dock has no button for, as large
 * tiles grouped like the desktop sidebar (Today, Library), with search,
 * appearance and sign out. It is a Radix dialog, so it traps focus, closes on
 * Escape and returns focus to the Menu button; the hand-built sheet it
 * replaced did none of that. The Menu button carries a pulsing dot when a
 * queue behind it (Review, Contacts) has something waiting, and says so in
 * its label.
 *
 * Every label is 12px or larger and every target at least 44px.
 */

import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { LayoutGrid, LogOut, Moon, Search, Sun, ChevronRight } from "lucide-react";
import { motion, MotionConfig } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  MOBILE_DOCK,
  NAV_GROUP_LABELS,
  accessibleNavLabel,
  activeDestinationId,
  getDestination,
  isInMenu,
  menuDestinations,
  type NavDestination,
  type NavGroup,
} from "@/lib/nav-destinations";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { NAV_ICONS, NavCount, openSearch, signOut, useNavBadges } from "./nav-shared";

const MENU_GROUPS: NavGroup[] = ["today", "library"];

export function AgenticBottomNav() {
  const pathname = usePathname();
  const activeId = activeDestinationId(pathname);
  const badgeFor = useNavBadges();
  const [menuOpen, setMenuOpen] = useState(false);

  const inMenu = menuDestinations();
  const menuPending = inMenu.reduce((sum, d) => sum + badgeFor(d), 0);
  const menuLit = menuOpen || isInMenu(pathname);

  const dockItem = (destination: NavDestination) => {
    const Icon = NAV_ICONS[destination.id];
    const isActive = destination.id === activeId;
    const count = badgeFor(destination);

    if (destination.id === "stream") {
      return (
        <Link
          key={destination.id}
          href={destination.href}
          aria-current={isActive ? "page" : undefined}
          aria-label={accessibleNavLabel(destination, count)}
          className="group flex min-h-11 flex-col items-center justify-end gap-1 rounded-2xl pb-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            data-active={isActive}
            className="nav-orb -mt-6 flex h-[3.25rem] w-[3.25rem] items-center justify-center rounded-full transition-transform group-active:scale-95"
          >
            <Icon className="h-6 w-6" aria-hidden="true" />
          </span>
          <span
            className={cn(
              "text-xs font-medium leading-none",
              isActive ? "text-primary" : "text-muted-foreground"
            )}
          >
            {destination.label}
          </span>
        </Link>
      );
    }

    return (
      <Link
        key={destination.id}
        href={destination.href}
        aria-current={isActive ? "page" : undefined}
        aria-label={accessibleNavLabel(destination, count)}
        className={cn(
          "relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl outline-none transition-colors",
          "focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
          isActive ? "text-primary" : "text-muted-foreground active:text-foreground"
        )}
      >
        <span className="relative flex h-8 w-12 items-center justify-center">
          {isActive && (
            <motion.span
              layoutId="dock-active"
              className="nav-active-fill absolute inset-0 rounded-full"
              transition={{ type: "spring", stiffness: 480, damping: 38 }}
              aria-hidden="true"
            />
          )}
          <Icon className={cn("relative h-5 w-5", isActive && "nav-active-icon")} aria-hidden="true" />
          <NavCount count={count} className="absolute -right-0.5 -top-1.5" />
        </span>
        <span className="text-xs font-medium leading-none">
          {destination.shortLabel ?? destination.label}
        </span>
      </Link>
    );
  };

  return (
    <MotionConfig reducedMotion="user">
      <nav
        data-bottom-nav
        aria-label="Primary"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="nav-glass nav-float pointer-events-auto mx-auto grid h-[3.75rem] max-w-lg grid-cols-5 items-center rounded-[1.75rem] px-1">
          {MOBILE_DOCK.map((id) => dockItem(getDestination(id)))}

          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-label={
              menuPending > 0
                ? `Menu, ${menuPending} item${menuPending === 1 ? "" : "s"} waiting`
                : "Menu"
            }
            className={cn(
              "relative flex min-h-11 flex-col items-center justify-center gap-1 rounded-2xl outline-none transition-colors",
              "focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]",
              menuLit ? "text-primary" : "text-muted-foreground active:text-foreground"
            )}
          >
            <span className="relative flex h-8 w-12 items-center justify-center">
              {isInMenu(pathname) && (
                <motion.span
                  layoutId="dock-active"
                  className="nav-active-fill absolute inset-0 rounded-full"
                  aria-hidden="true"
                />
              )}
              <LayoutGrid className={cn("relative h-5 w-5", menuLit && "nav-active-icon")} aria-hidden="true" />
              {menuPending > 0 && (
                <span className="nav-synapse absolute right-2 top-0.5 h-2.5 w-2.5 rounded-full" aria-hidden="true" />
              )}
            </span>
            <span className="text-xs font-medium leading-none">Menu</span>
          </button>
        </div>
      </nav>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="bottom"
          overlayClassName="bg-black/40 backdrop-blur-sm"
          className="nav-glass nav-float max-h-[85dvh] gap-0 overflow-y-auto rounded-t-[1.75rem] border-x-0 border-b-0 px-4 pt-3"
        >
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden="true" />
          <SheetTitle className="text-base">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Every part of the app the dock has no button for.
          </SheetDescription>

          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              // Let the sheet hand focus back before the search overlay takes it.
              window.setTimeout(openSearch, 50);
            }}
            className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-[var(--nav-edge)] bg-background/60 px-4 text-left text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">Search or create…</span>
          </button>

          {MENU_GROUPS.map((group) => {
            const items = inMenu.filter((d) => d.group === group);
            if (items.length === 0) return null;
            const headingId = `menu-group-${group}`;
            return (
              <section key={group} aria-labelledby={headingId} className="mt-5">
                <h3
                  id={headingId}
                  className="mb-2 px-1 text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {NAV_GROUP_LABELS[group]}
                </h3>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {items.map((d, i) => {
                    const Icon = NAV_ICONS[d.id];
                    const isActive = d.id === activeId;
                    const count = badgeFor(d);
                    return (
                      <motion.li
                        key={d.id}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.03 * i, duration: 0.22 }}
                      >
                        <Link
                          href={d.href}
                          onClick={() => setMenuOpen(false)}
                          aria-current={isActive ? "page" : undefined}
                          aria-label={accessibleNavLabel(d, count)}
                          className={cn(
                            "relative flex h-full min-h-[5.5rem] flex-col gap-2 rounded-2xl border p-3 outline-none transition-colors",
                            "focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]",
                            isActive
                              ? "nav-active-fill border-transparent"
                              : "border-[var(--nav-edge)] bg-background/50 hover:bg-muted/60"
                          )}
                        >
                          <span className="flex items-center justify-between">
                            <span
                              className={cn(
                                "flex h-9 w-9 items-center justify-center rounded-xl",
                                isActive ? "bg-primary/15" : "bg-muted"
                              )}
                            >
                              <Icon className={cn("h-[18px] w-[18px]", isActive && "nav-active-icon")} aria-hidden="true" />
                            </span>
                            <NavCount count={count} />
                          </span>
                          <span>
                            <span className="block text-sm font-medium">{d.label}</span>
                            <span className="block text-xs leading-snug text-muted-foreground">
                              {d.description}
                            </span>
                          </span>
                        </Link>
                      </motion.li>
                    );
                  })}
                </ul>
              </section>
            );
          })}

          <section aria-label={NAV_GROUP_LABELS.system} className="mt-5 mb-2 overflow-hidden rounded-2xl border border-[var(--nav-edge)] bg-background/50">
            {inMenu
              .filter((d) => d.group === "system")
              .map((d) => {
                const Icon = NAV_ICONS[d.id];
                const isActive = d.id === activeId;
                return (
                  <Link
                    key={d.id}
                    href={d.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 px-4 text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted",
                      isActive && "text-primary"
                    )}
                  >
                    <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
                    <span className="flex-1">{d.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </Link>
                );
              })}
            <div className="nav-divider mx-4" aria-hidden="true" />
            <AppearanceRow />
            <div className="nav-divider mx-4" aria-hidden="true" />
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void signOut();
              }}
              className="flex min-h-12 w-full items-center gap-3 px-4 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-muted"
            >
              <LogOut className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
              <span className="flex-1">Sign out</span>
            </button>
          </section>
        </SheetContent>
      </Sheet>
    </MotionConfig>
  );
}

/**
 * Light / dark as a two-option switch. On a phone the header has no room for
 * the theme button, so it lives here.
 */
function AppearanceRow() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const options = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
  ] as const;

  return (
    <div className="flex min-h-12 items-center gap-3 px-4 text-sm">
      <span id="menu-appearance" className="flex-1">
        Appearance
      </span>
      <div role="radiogroup" aria-labelledby="menu-appearance" className="flex rounded-full bg-muted p-0.5">
        {options.map((o) => {
          const checked = o.value === "dark" ? isDark : !isDark;
          const Icon = o.icon;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => setTheme(o.value)}
              className={cn(
                "flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                checked ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
