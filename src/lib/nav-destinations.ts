/**
 * Where the app can take you, in one table.
 *
 * The desktop sidebar and the mobile dock used to declare their own arrays, and
 * they drifted: the docs listed four "Today" entries while the sidebar showed
 * five, the dock badged nothing while the sidebar badged Tasks, and "is this
 * page active?" was decided three different ways (exact match for Settings,
 * prefix for the rest, a hand-kept list for the More button). Every surface now
 * reads this table and asks `activeDestinationId` which single entry is "you
 * are here".
 *
 * Pure and imports nothing (icons are mapped in the component), so it is
 * unit-tested and safe to import anywhere.
 *
 * @module nav-destinations
 */

export type NavGroup = "today" | "library" | "system";

/** Which shared queue count a destination shows. */
export type NavBadgeKind = "review" | "tasks" | "crm";

export type NavDestinationId =
  | "stream"
  | "operations"
  | "tasks"
  | "review"
  | "contacts"
  | "notes"
  | "journal"
  | "projects"
  | "whiteboards"
  | "settings";

export interface NavDestination {
  id: NavDestinationId;
  /** The name used everywhere: sidebar, dock, menu, page title on a phone. */
  label: string;
  /** Only where space is tight (the mobile dock). */
  shortLabel?: string;
  href: string;
  group: NavGroup;
  /** One plain sentence, shown in the mobile menu and as the rail tooltip. */
  description: string;
  badge?: NavBadgeKind;
  /** Other path prefixes that belong to this destination. */
  alsoMatches?: string[];
  /**
   * A route shape that belongs here even though its prefix says otherwise.
   * Wins over prefixes: `/projects/launch/whiteboard` is a whiteboard, not the
   * project page.
   */
  pattern?: RegExp;
}

export const NAV_GROUP_LABELS: Record<NavGroup, string> = {
  today: "Today",
  library: "Library",
  system: "System",
};

export const NAV_DESTINATIONS: readonly NavDestination[] = [
  {
    id: "stream",
    label: "Stream",
    href: "/",
    group: "today",
    description: "What needs you now",
    alsoMatches: ["/stream"],
  },
  {
    id: "operations",
    label: "Operations",
    shortLabel: "Ops",
    href: "/operations",
    group: "today",
    description: "Decisions, follow-ups and who owes what",
  },
  {
    id: "tasks",
    label: "Tasks",
    href: "/tasks",
    group: "today",
    description: "Your to-do list, calendar and board",
    badge: "tasks",
  },
  {
    id: "review",
    label: "Review",
    href: "/review",
    group: "today",
    description: "Agent work waiting for your decision",
    badge: "review",
  },
  {
    id: "contacts",
    label: "Contacts",
    href: "/crm",
    group: "today",
    description: "People, organisations and ventures",
    badge: "crm",
  },
  {
    id: "notes",
    label: "Notes",
    href: "/notes",
    group: "library",
    description: "Everything you have written",
    alsoMatches: ["/templates"],
  },
  {
    id: "journal",
    label: "Journal",
    href: "/journal",
    group: "library",
    description: "One page per day",
  },
  {
    id: "projects",
    label: "Projects",
    href: "/projects",
    group: "library",
    description: "Workspaces, timelines and health",
  },
  {
    id: "whiteboards",
    label: "Whiteboards",
    href: "/whiteboards",
    group: "library",
    description: "Boards for every project and note",
    pattern: /^\/(projects|notes)\/[^/]+\/whiteboard$/,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/settings",
    group: "system",
    description: "Account, appearance, AI and sharing",
  },
];

/**
 * The phone's dock, left to right. Stream is the centre orb, so it sits third
 * of four with "Menu" as the fifth slot.
 */
export const MOBILE_DOCK: readonly NavDestinationId[] = ["tasks", "operations", "stream", "notes"];

/** Routes that are reachable but not navigation entries, for the page title. */
const OTHER_TITLES: ReadonlyArray<[string, string]> = [
  ["/search", "Search"],
  ["/agents", "Agents"],
  ["/admin", "Admin"],
];

function matchesPrefix(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

/** Strip a trailing slash and any query or hash, so `/notes/` is `/notes`. */
export function normalizePath(pathname: string | null | undefined): string {
  if (!pathname) return "/";
  const bare = pathname.split(/[?#]/, 1)[0] || "/";
  return bare.length > 1 && bare.endsWith("/") ? bare.slice(0, -1) : bare;
}

/**
 * The one destination that is "you are here", or `null` for a page that is not
 * a navigation entry. Exactly one entry is ever active: a pattern match wins,
 * then the longest matching prefix.
 */
export function activeDestinationId(pathname: string | null | undefined): NavDestinationId | null {
  const path = normalizePath(pathname);

  for (const d of NAV_DESTINATIONS) {
    if (d.pattern?.test(path)) return d.id;
  }

  let best: { id: NavDestinationId; length: number } | null = null;
  for (const d of NAV_DESTINATIONS) {
    for (const href of [d.href, ...(d.alsoMatches ?? [])]) {
      if (matchesPrefix(path, href) && (!best || href.length > best.length)) {
        best = { id: d.id, length: href.length };
      }
    }
  }
  return best?.id ?? null;
}

export function getDestination(id: NavDestinationId): NavDestination {
  const found = NAV_DESTINATIONS.find((d) => d.id === id);
  if (!found) throw new Error(`Unknown destination: ${id}`);
  return found;
}

export function destinationsInGroup(group: NavGroup): NavDestination[] {
  return NAV_DESTINATIONS.filter((d) => d.group === group);
}

/** Everything the dock has no button for, which is what the phone menu lists. */
export function menuDestinations(): NavDestination[] {
  return NAV_DESTINATIONS.filter((d) => !MOBILE_DOCK.includes(d.id));
}

/** Whether the current page lives behind the phone's Menu button. */
export function isInMenu(pathname: string | null | undefined): boolean {
  const id = activeDestinationId(pathname);
  return id !== null && !MOBILE_DOCK.includes(id);
}

/** The heading a phone shows so the user always knows where they are. */
export function sectionTitle(pathname: string | null | undefined): string | null {
  const id = activeDestinationId(pathname);
  if (id) return getDestination(id).label;
  const path = normalizePath(pathname);
  for (const [prefix, title] of OTHER_TITLES) {
    if (matchesPrefix(path, prefix)) return title;
  }
  return null;
}

/** What a badge prints: never wider than three characters. */
export function formatBadgeCount(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return "";
  return count > 99 ? "99+" : String(Math.floor(count));
}

const BADGE_NOUNS: Record<NavBadgeKind, [string, string]> = {
  review: ["item to review", "items to review"],
  tasks: ["suggested task", "suggested tasks"],
  crm: ["contact to sort", "contacts to sort"],
};

/**
 * What a screen reader hears for a destination, e.g. "Review, 3 items to
 * review". A bare number after a link name says nothing about what it counts.
 */
export function accessibleNavLabel(destination: NavDestination, count: number): string {
  if (!destination.badge || !Number.isFinite(count) || count <= 0) return destination.label;
  const [one, many] = BADGE_NOUNS[destination.badge];
  const n = Math.floor(count);
  return `${destination.label}, ${n} ${n === 1 ? one : many}`;
}

// ---------------------------------------------------------------------------
// Desktop sidebar width
// ---------------------------------------------------------------------------

/**
 * `auto` is a rail (icons) on a laptop-width screen and the full sidebar from
 * 1280px; `rail` and `full` are the user's explicit choice. Stored per device,
 * like stream density: it is a property of the screen.
 */
export type SidebarMode = "auto" | "rail" | "full";

export const SIDEBAR_STORAGE_KEY = "brain-portal:sidebar-mode";

export function parseSidebarMode(value: string | null | undefined): SidebarMode {
  return value === "rail" || value === "full" ? value : "auto";
}

/**
 * What the toggle button switches to. From `auto` it moves away from what the
 * user is currently seeing, so one click always visibly does something.
 */
export function nextSidebarMode(mode: SidebarMode, showingFull: boolean): SidebarMode {
  if (mode === "auto") return showingFull ? "rail" : "full";
  return mode === "full" ? "rail" : "full";
}

/** Whether a given mode shows the full sidebar at a given viewport width. */
export function sidebarShowsFull(mode: SidebarMode, viewportWidth: number): boolean {
  if (mode === "auto") return viewportWidth >= 1280;
  return mode === "full";
}
