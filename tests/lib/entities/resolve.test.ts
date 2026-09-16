import { describe, it, expect } from "vitest";
import {
  normalizeEntityKey,
  resolveEntity,
  pickCanonicalName,
  dedupeExtractedEntities,
  normalizeEntityType,
  buildCoOccurrencePairs,
  cleanEntityName,
} from "@/lib/entities/resolve";

describe("normalizeEntityKey", () => {
  it("collapses the Northwind variants onto one key", () => {
    const k = normalizeEntityKey("Northwind");
    expect(normalizeEntityKey("Northwind Farms")).toBe(k);
    expect(normalizeEntityKey("northwind farms")).toBe(k);
    expect(normalizeEntityKey("Northwind Farms Co")).toBe(k);
    expect(normalizeEntityKey("The Northwind Farms")).toBe(k);
  });

  it("collapses whitespace/case variants (FieldTechAI == Field tech ai)", () => {
    expect(normalizeEntityKey("FieldTechAI")).toBe(
      normalizeEntityKey("Field tech ai")
    );
    expect(normalizeEntityKey("Field Tech AI")).toBe("fieldtechai");
  });

  it("strips diacritics", () => {
    expect(normalizeEntityKey("Beyoncé")).toBe(normalizeEntityKey("Beyonce"));
  });

  it("expands ampersands", () => {
    expect(normalizeEntityKey("Ben & Jerry")).toBe(normalizeEntityKey("Ben and Jerry"));
  });

  it("returns empty for junk input", () => {
    expect(normalizeEntityKey("")).toBe("");
    expect(normalizeEntityKey("   ")).toBe("");
    expect(normalizeEntityKey("!!!")).toBe("");
  });

  it("keeps distinct entities distinct", () => {
    expect(normalizeEntityKey("Northwind")).not.toBe(normalizeEntityKey("Whitmore"));
  });
});

describe("resolveEntity", () => {
  const existing = [
    { id: "e-hep", normalized_key: normalizeEntityKey("Northwind Farms") },
    { id: "e-dana", normalized_key: normalizeEntityKey("Dana Okonkwo") },
  ];

  it("matches a variant to the existing entity by key", () => {
    expect(resolveEntity("Northwind", existing).entityId).toBe("e-hep");
    expect(resolveEntity("northwind farms co", existing).entityId).toBe("e-hep");
  });

  it("does not confuse a person with the org", () => {
    expect(resolveEntity("Dana Okonkwo", existing).entityId).toBe("e-dana");
  });

  it("matches via alias keys", () => {
    const withAlias = [
      {
        id: "e-ft",
        normalized_key: "fieldtechai",
        alias_keys: [normalizeEntityKey("FTAI")],
      },
    ];
    expect(resolveEntity("FTAI", withAlias).entityId).toBe("e-ft");
  });

  it("returns null for an unseen entity", () => {
    const r = resolveEntity("Brand New Co", existing);
    expect(r.entityId).toBeNull();
    expect(r.key).toBe(normalizeEntityKey("Brand New Co"));
  });

  it("returns null key for junk", () => {
    expect(resolveEntity("!!!", existing).entityId).toBeNull();
  });
});

describe("pickCanonicalName", () => {
  it("prefers the more descriptive (more tokens) name", () => {
    expect(pickCanonicalName("Northwind", "Northwind Farms")).toBe("Northwind Farms");
    expect(pickCanonicalName("Northwind Farms", "Northwind")).toBe("Northwind Farms");
  });

  it("falls back to length then to the existing name", () => {
    expect(pickCanonicalName("IBM", "Ibmm")).toBe("Ibmm");
    expect(pickCanonicalName("Acme", "Acme")).toBe("Acme");
  });
});

describe("dedupeExtractedEntities", () => {
  it("merges surface variants and records aliases", () => {
    const result = dedupeExtractedEntities([
      { name: "Northwind", type: "org" },
      { name: "Northwind Farms", type: "org" },
      { name: "Dana Okonkwo", type: "person" },
    ]);

    expect(result).toHaveLength(2);
    const hep = result.find((e) => e.key === normalizeEntityKey("Northwind"));
    expect(hep?.name).toBe("Northwind Farms"); // most descriptive wins
    expect(hep?.aliases).toContain("Northwind");
  });

  it("filters stopwords, bare numbers, and single chars", () => {
    const result = dedupeExtractedEntities([
      { name: "meeting" },
      { name: "2026" },
      { name: "x" },
      { name: "Real Entity" },
    ]);
    expect(result.map((e) => e.name)).toEqual(["Real Entity"]);
  });

  it("upgrades an 'other' type when a later mention is specific", () => {
    const result = dedupeExtractedEntities([
      { name: "William", type: "other" },
      { name: "William", type: "person" },
    ]);
    expect(result[0].type).toBe("person");
  });
});

describe("normalizeEntityType", () => {
  it("passes through known types and defaults unknowns to other", () => {
    expect(normalizeEntityType("person")).toBe("person");
    expect(normalizeEntityType("PERSON")).toBe("person");
    expect(normalizeEntityType("alien")).toBe("other");
    expect(normalizeEntityType(undefined)).toBe("other");
  });
});

describe("buildCoOccurrencePairs", () => {
  it("returns unique unordered pairs", () => {
    const pairs = buildCoOccurrencePairs(["b", "a", "c"]);
    expect(pairs).toHaveLength(3);
    // sorted within each pair
    expect(pairs).toContainEqual(["a", "b"]);
    expect(pairs).toContainEqual(["a", "c"]);
    expect(pairs).toContainEqual(["b", "c"]);
  });

  it("dedupes repeated ids and ignores self-pairs", () => {
    expect(buildCoOccurrencePairs(["a", "a"])).toEqual([]);
    expect(buildCoOccurrencePairs(["a"])).toEqual([]);
    expect(buildCoOccurrencePairs([])).toEqual([]);
  });
});

describe("cleanEntityName", () => {
  it("trims and collapses whitespace", () => {
    expect(cleanEntityName("  Northwind   Farms  ")).toBe("Northwind Farms");
  });
});
