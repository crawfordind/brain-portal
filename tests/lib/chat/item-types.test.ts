import { describe, it, expect } from "vitest";
import {
  encodeItemRef,
  parseItemRef,
  CHAT_ITEM_TYPES,
} from "@/lib/chat/item-types";

describe("encodeItemRef / parseItemRef", () => {
  it("round-trips every supported item type", () => {
    for (const type of CHAT_ITEM_TYPES) {
      const ref = { type, id: "abc123" };
      expect(parseItemRef(encodeItemRef(ref))).toEqual(ref);
    }
  });

  it("keeps ids that contain a colon intact", () => {
    // Only the FIRST colon separates type from id, so an id that contains one
    // survives instead of being silently truncated.
    const ref = { type: "note" as const, id: "urn:uuid:1234" };
    expect(parseItemRef(encodeItemRef(ref))).toEqual(ref);
  });

  it("rejects an unknown type rather than reaching the database", () => {
    expect(parseItemRef("users:1")).toBeNull();
    expect(parseItemRef("notes:1")).toBeNull();
  });

  it("rejects malformed values", () => {
    expect(parseItemRef(null)).toBeNull();
    expect(parseItemRef(undefined)).toBeNull();
    expect(parseItemRef("")).toBeNull();
    expect(parseItemRef("note")).toBeNull();
    expect(parseItemRef("note:")).toBeNull();
    expect(parseItemRef("note:   ")).toBeNull();
    expect(parseItemRef(":abc")).toBeNull();
  });

  it("treats a bare id from an older conversation as unrecognised", () => {
    // Pre-`item` conversations stored a plain note id in context_id. It must
    // not be mistaken for an item ref.
    expect(parseItemRef("9f8e7d6c5b4a")).toBeNull();
  });

  it("trims surrounding whitespace from the id", () => {
    expect(parseItemRef("task:  abc  ")).toEqual({ type: "task", id: "abc" });
  });
});
