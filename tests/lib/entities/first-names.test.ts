import { describe, it, expect } from "vitest";
import {
  firstNameKey,
  isScopedMentionKey,
  isSingleTokenName,
  matchFirstName,
  normalizeEntityKey,
  scopedMentionKey,
} from "@/lib/entities/resolve";

describe("isSingleTokenName / firstNameKey", () => {
  it("tells a first name from a full name", () => {
    expect(isSingleTokenName("Justin")).toBe(true);
    expect(isSingleTokenName("  Justin  ")).toBe(true);
    expect(isSingleTokenName("Justin Smith")).toBe(false);
    expect(firstNameKey("Justin Smith")).toBe("justin");
    expect(firstNameKey("José  Álvarez")).toBe("jose");
    expect(firstNameKey("Justin")).toBeNull();
  });
});

describe("scopedMentionKey", () => {
  it("never collides with a normalized key", () => {
    const key = scopedMentionKey("justin", "note", "n1");
    expect(key).toBe("justin@note:n1");
    expect(isScopedMentionKey(key)).toBe(true);
    expect(isScopedMentionKey(normalizeEntityKey("justin@note:n1"))).toBe(false);
  });
});

describe("matchFirstName", () => {
  const people = [
    { id: "s", name: "Justin Smith" },
    { id: "l", name: "Justin Lee" },
    { id: "d", name: "Dana Okonkwo", aliasKeys: ["dee"] },
    { id: "j", name: "Justina Park" },
  ];

  it("finds every person who goes by that first name", () => {
    expect(matchFirstName("Justin", people).map((p) => p.id)).toEqual(["s", "l"]);
  });

  it("does not match a longer name that merely starts the same", () => {
    expect(matchFirstName("Justin", [people[3]])).toEqual([]);
  });

  it("matches a person with that exact one-word name, and through aliases", () => {
    expect(matchFirstName("justin", [{ id: "b", name: "Justin" }])).toHaveLength(1);
    expect(matchFirstName("Dee", people).map((p) => p.id)).toEqual(["d"]);
  });

  it("only applies to one-word names", () => {
    expect(matchFirstName("Justin Smith", people)).toEqual([]);
  });

  it("lists each person once", () => {
    const dup = [{ id: "s", name: "Justin Smith", aliasKeys: ["justin"] }];
    expect(matchFirstName("Justin", dup)).toHaveLength(1);
  });
});
