import { describe, it, expect } from "vitest";
import { getItemSuggestions } from "@/lib/chat/item-suggestions";
import { CHAT_ITEM_TYPES } from "@/lib/chat/item-types";

describe("getItemSuggestions", () => {
  it("offers suggestions for every item type", () => {
    for (const type of CHAT_ITEM_TYPES) {
      const suggestions = getItemSuggestions(type);
      expect(suggestions.length).toBeGreaterThan(1);
      for (const s of suggestions) {
        expect(s.label.trim()).not.toBe("");
        expect(s.prompt.trim().length).toBeGreaterThan(s.label.length);
      }
    }
  });

  it("keeps labels short enough to read as a chip", () => {
    for (const type of CHAT_ITEM_TYPES) {
      for (const s of getItemSuggestions(type)) {
        expect(s.label.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it("gives distinct labels within a type", () => {
    for (const type of CHAT_ITEM_TYPES) {
      const labels = getItemSuggestions(type).map((s) => s.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("still returns something for an unknown or missing type", () => {
    expect(getItemSuggestions(null).length).toBeGreaterThan(0);
    expect(getItemSuggestions(undefined).length).toBeGreaterThan(0);
  });
});
