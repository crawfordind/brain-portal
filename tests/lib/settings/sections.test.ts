import { describe, it, expect } from "vitest";
import {
  SETTINGS_GROUPS,
  SETTINGS_SECTIONS,
  groupSections,
  resolveSectionId,
  searchSections,
} from "@/lib/settings/sections";

describe("settings sections", () => {
  it("gives every section a unique id and a known group", () => {
    const ids = SETTINGS_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set(SETTINGS_GROUPS.map((g) => g.id));
    for (const section of SETTINGS_SECTIONS) expect(groups.has(section.group)).toBe(true);
  });

  it("still resolves every hash the rest of the app links to", () => {
    // Email footers, the share dialog and the OpenRouter callback.
    expect(resolveSectionId("#notifications")).toBe("notifications");
    expect(resolveSectionId("#sharing")).toBe("sharing");
    expect(resolveSectionId("#ai-provider")).toBe("ai-provider");
    expect(resolveSectionId("#ai-usage")).toBe("ai-usage");
  });

  it("maps old names onto their new sections", () => {
    expect(resolveSectionId("mcp-keys")).toBe("api-access");
    expect(resolveSectionId("#guardrails")).toBe("ai-guardrails");
  });

  it("ignores case and rejects what it does not know rather than guessing", () => {
    expect(resolveSectionId("#Appearance")).toBe("appearance");
    expect(resolveSectionId("#nope")).toBeNull();
    expect(resolveSectionId("")).toBeNull();
    expect(resolveSectionId("#")).toBeNull();
    expect(resolveSectionId("#%E0")).toBeNull();
  });

  it("searches labels, descriptions and keywords, requiring every word", () => {
    expect(searchSections("dark").map((s) => s.id)).toEqual(["appearance"]);
    expect(searchSections("email digest").map((s) => s.id)).toEqual(["notifications"]);
    expect(searchSections("MCP").map((s) => s.id)).toEqual(["api-access"]);
    expect(searchSections("email theme")).toEqual([]);
    expect(searchSections("  ")).toHaveLength(SETTINGS_SECTIONS.length);
  });

  it("drops groups a search leaves empty", () => {
    const groups = groupSections(searchSections("dark"));
    expect(groups.map((g) => g.id)).toEqual(["preferences"]);
  });
});
