import { describe, it, expect } from "vitest";
import {
  MOBILE_DOCK,
  NAV_DESTINATIONS,
  accessibleNavLabel,
  activeDestinationId,
  formatBadgeCount,
  getDestination,
  isInMenu,
  menuDestinations,
  nextSidebarMode,
  normalizePath,
  parseSidebarMode,
  sectionTitle,
  sidebarShowsFull,
} from "@/lib/nav-destinations";

describe("NAV_DESTINATIONS", () => {
  it("has unique ids and hrefs", () => {
    const ids = NAV_DESTINATIONS.map((d) => d.id);
    const hrefs = NAV_DESTINATIONS.map((d) => d.href);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("describes every destination in plain words", () => {
    for (const d of NAV_DESTINATIONS) {
      expect(d.description.length).toBeGreaterThan(5);
    }
  });

  it("puts every destination either in the dock or in the menu, never both", () => {
    const menu = menuDestinations().map((d) => d.id);
    for (const d of NAV_DESTINATIONS) {
      const inDock = MOBILE_DOCK.includes(d.id);
      expect(inDock !== menu.includes(d.id)).toBe(true);
    }
  });

  it("keeps Stream at the centre of the dock's five slots", () => {
    // Four destinations plus the Menu button: index 2 is the middle.
    expect(MOBILE_DOCK).toHaveLength(4);
    expect(MOBILE_DOCK[2]).toBe("stream");
  });
});

describe("activeDestinationId", () => {
  it("matches the root only exactly", () => {
    expect(activeDestinationId("/")).toBe("stream");
    expect(activeDestinationId("/stream")).toBe("stream");
  });

  it("matches a section and everything under it", () => {
    expect(activeDestinationId("/notes")).toBe("notes");
    expect(activeDestinationId("/notes/my-note")).toBe("notes");
    expect(activeDestinationId("/crm/abc")).toBe("contacts");
    expect(activeDestinationId("/settings")).toBe("settings");
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(activeDestinationId("/notebooks")).toBeNull();
    expect(activeDestinationId("/operationsx")).toBeNull();
  });

  it("treats a project's or note's board as Whiteboards, not the parent", () => {
    expect(activeDestinationId("/projects/launch/whiteboard")).toBe("whiteboards");
    expect(activeDestinationId("/notes/plan/whiteboard")).toBe("whiteboards");
    expect(activeDestinationId("/projects/launch")).toBe("projects");
  });

  it("ignores trailing slashes, queries and hashes", () => {
    expect(activeDestinationId("/tasks/")).toBe("tasks");
    expect(activeDestinationId("/settings#notifications")).toBe("settings");
    expect(activeDestinationId("/tasks?task=1")).toBe("tasks");
    expect(normalizePath(null)).toBe("/");
  });

  it("returns null for pages that are not navigation entries", () => {
    expect(activeDestinationId("/search")).toBeNull();
    expect(activeDestinationId("/agents")).toBeNull();
  });
});

describe("isInMenu", () => {
  it("lights the Menu button only for pages behind it", () => {
    expect(isInMenu("/review")).toBe(true);
    expect(isInMenu("/projects/x/whiteboard")).toBe(true);
    expect(isInMenu("/tasks")).toBe(false);
    expect(isInMenu("/")).toBe(false);
    expect(isInMenu("/search")).toBe(false);
  });
});

describe("sectionTitle", () => {
  it("names the section, including pages outside the menus", () => {
    expect(sectionTitle("/")).toBe("Stream");
    expect(sectionTitle("/crm")).toBe("Contacts");
    expect(sectionTitle("/search")).toBe("Search");
    expect(sectionTitle("/nowhere")).toBeNull();
  });
});

describe("badges", () => {
  it("never prints more than three characters", () => {
    expect(formatBadgeCount(0)).toBe("");
    expect(formatBadgeCount(-1)).toBe("");
    expect(formatBadgeCount(7)).toBe("7");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
  });

  it("says what a count counts", () => {
    expect(accessibleNavLabel(getDestination("review"), 0)).toBe("Review");
    expect(accessibleNavLabel(getDestination("review"), 1)).toBe("Review, 1 item to review");
    expect(accessibleNavLabel(getDestination("contacts"), 3)).toBe("Contacts, 3 contacts to sort");
    // A destination without a badge ignores the count.
    expect(accessibleNavLabel(getDestination("notes"), 5)).toBe("Notes");
  });
});

describe("sidebar mode", () => {
  it("parses only known values, defaulting to auto", () => {
    expect(parseSidebarMode("rail")).toBe("rail");
    expect(parseSidebarMode("full")).toBe("full");
    expect(parseSidebarMode("wide")).toBe("auto");
    expect(parseSidebarMode(null)).toBe("auto");
  });

  it("auto is a rail on a laptop and full from 1280px", () => {
    expect(sidebarShowsFull("auto", 1024)).toBe(false);
    expect(sidebarShowsFull("auto", 1280)).toBe(true);
    expect(sidebarShowsFull("rail", 1920)).toBe(false);
    expect(sidebarShowsFull("full", 1024)).toBe(true);
  });

  it("the toggle always changes what is on screen", () => {
    expect(nextSidebarMode("auto", true)).toBe("rail");
    expect(nextSidebarMode("auto", false)).toBe("full");
    expect(nextSidebarMode("full", true)).toBe("rail");
    expect(nextSidebarMode("rail", false)).toBe("full");
  });
});
