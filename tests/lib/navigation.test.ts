import { describe, it, expect } from "vitest";
import { isActiveRoute, contentWidthClass } from "@/lib/navigation";

describe("isActiveRoute", () => {
  it("matches the root only exactly", () => {
    expect(isActiveRoute("/", "/")).toBe(true);
    expect(isActiveRoute("/notes", "/")).toBe(false);
  });

  it("matches a section and everything under it", () => {
    expect(isActiveRoute("/notes", "/notes")).toBe(true);
    expect(isActiveRoute("/notes/my-note", "/notes")).toBe(true);
  });

  it("does not match a sibling that merely shares a prefix", () => {
    expect(isActiveRoute("/notebooks", "/notes")).toBe(false);
  });
});

describe("contentWidthClass", () => {
  it("gives the dashboard its own, wider measure", () => {
    // `max-w-4xl` is a reading measure. Applied to a list of short rows it
    // discarded ~41% of a 1920px display.
    expect(contentWidthClass("/")).toBe("max-w-6xl");
  });

  it("keeps the reading measure everywhere prose is read or written", () => {
    for (const route of [
      "/notes",
      "/notes/some-note",
      "/journal",
      "/settings",
      "/projects",
      "/crm",
      "/review",
      "/tasks",
    ]) {
      expect(contentWidthClass(route)).toBe("max-w-4xl");
    }
  });
});
