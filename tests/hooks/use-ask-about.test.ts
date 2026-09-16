import { describe, it, expect } from "vitest";
import { toChatItemType } from "@/hooks/use-ask-about";
import { CHAT_ITEM_TYPES } from "@/lib/chat/item-types";

/**
 * The stream labels items by what they look like, not by which table they came
 * from: a link is a `reference`, an open question is a `question`, but both are
 * rows in `captures`. Anything the mapping misses loses its "Ask about this"
 * action, so every stream type is pinned down here.
 */
describe("toChatItemType", () => {
  it("passes chat item types through unchanged", () => {
    for (const type of CHAT_ITEM_TYPES) {
      expect(toChatItemType(type)).toBe(type);
    }
  });

  it("maps every stream item type to something askable", () => {
    // Mirrors StreamItemType in src/lib/stream/types.ts.
    const STREAM_TYPES = [
      "thought",
      "task",
      "note",
      "journal",
      "question",
      "decision",
      "reference",
      "insight",
      "agent_output",
      "reminder",
      "capture",
    ];

    for (const type of STREAM_TYPES) {
      expect(toChatItemType(type), `stream type "${type}" is unmapped`).not.toBeNull();
    }
  });

  it("resolves capture-shaped stream types to captures", () => {
    expect(toChatItemType("question")).toBe("capture");
    expect(toChatItemType("decision")).toBe("capture");
    expect(toChatItemType("reference")).toBe("capture");
  });

  it("returns null for unknown or missing types", () => {
    expect(toChatItemType("project")).toBeNull();
    expect(toChatItemType("contact")).toBeNull();
    expect(toChatItemType("")).toBeNull();
    expect(toChatItemType(null)).toBeNull();
    expect(toChatItemType(undefined)).toBeNull();
  });
});
