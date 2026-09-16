import { describe, it, expect } from "vitest";
import { themes, getThemeById } from "@/lib/themes";

describe("themes config", () => {
  it("has exactly 2 themes", () => {
    expect(themes).toHaveLength(2);
  });

  it("each theme has required fields", () => {
    for (const t of themes) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(["light", "dark"]).toContain(t.mode);
      expect(t.preview.bg).toBeTruthy();
      expect(t.preview.surface).toBeTruthy();
      expect(t.preview.accent).toBeTruthy();
      expect(t.preview.text).toBeTruthy();
    }
  });

  it("first theme is light mode (Canvas)", () => {
    expect(themes[0].id).toBe("light");
    expect(themes[0].mode).toBe("light");
    expect(themes[0].label).toBe("Canvas");
  });

  it("second theme is dark mode (Slate)", () => {
    expect(themes[1].id).toBe("dark");
    expect(themes[1].mode).toBe("dark");
    expect(themes[1].label).toBe("Slate");
  });

  it("getThemeById returns correct theme", () => {
    expect(getThemeById("light")?.label).toBe("Canvas");
    expect(getThemeById("dark")?.label).toBe("Slate");
    expect(getThemeById("nonexistent")).toBeUndefined();
  });
});
