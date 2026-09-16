import { describe, it, expect } from "vitest";
import {
  readEntityMetadata,
  writeEntityMetadata,
  isVenture,
  getResolution,
  isUnresolved,
  getCompartments,
  isNameLocked,
  getMergeCandidate,
  getVentureConfig,
  getCrmFields,
  PUBLIC_COMPARTMENT,
} from "@/lib/crm/metadata";

describe("readEntityMetadata", () => {
  it("degrades to {} rather than throwing on bad JSON", () => {
    expect(readEntityMetadata("{not json")).toEqual({});
    expect(readEntityMetadata("null")).toEqual({});
    expect(readEntityMetadata("[1,2]")).toEqual({});
    expect(readEntityMetadata("")).toEqual({});
    expect(readEntityMetadata(null)).toEqual({});
    expect(readEntityMetadata(undefined)).toEqual({});
  });

  it("reads the metadata field off an entity-shaped object", () => {
    const entity = { metadata: '{"is_venture":true}' } as never;
    expect(readEntityMetadata(entity).is_venture).toBe(true);
  });
});

describe("writeEntityMetadata", () => {
  it("preserves keys owned by other subsystems", () => {
    const existing = '{"aliases":["Hep"],"someOtherSystem":{"x":1}}';
    const next = readEntityMetadata(
      writeEntityMetadata(existing, { is_venture: true })
    );
    expect(next.aliases).toEqual(["Hep"]);
    expect(next.someOtherSystem).toEqual({ x: 1 });
    expect(next.is_venture).toBe(true);
  });

  it("deletes a key when the patch value is null", () => {
    const existing = '{"merge_candidate":{"target_entity_id":"e2"}}';
    const next = readEntityMetadata(
      writeEntityMetadata(existing, { merge_candidate: null })
    );
    expect("merge_candidate" in next).toBe(false);
  });

  it("ignores undefined patch values rather than deleting", () => {
    const existing = '{"name_locked":true}';
    const next = readEntityMetadata(
      writeEntityMetadata(existing, { name_locked: undefined })
    );
    expect(next.name_locked).toBe(true);
  });

  it("round-trips through read and write without loss", () => {
    const original = writeEntityMetadata("{}", {
      is_venture: true,
      compartments: ["cannabis"],
      venture: { slug: "cedar-line", compliance_rules: ["No health claims."] },
    });
    const again = writeEntityMetadata(original, {});
    expect(readEntityMetadata(again)).toEqual(readEntityMetadata(original));
  });
});

describe("isVenture", () => {
  it("requires strict true so a stray string cannot promote an entity", () => {
    expect(isVenture('{"is_venture":true}')).toBe(true);
    expect(isVenture('{"is_venture":"yes"}')).toBe(false);
    expect(isVenture('{"is_venture":1}')).toBe(false);
    expect(isVenture("{}")).toBe(false);
  });
});

describe("getResolution", () => {
  it("treats an absent key as confirmed, so the existing graph is not flagged", () => {
    expect(getResolution("{}")).toBe("confirmed");
    expect(getResolution(null)).toBe("confirmed");
    expect(isUnresolved("{}")).toBe(false);
  });

  it("reads an explicit unresolved state", () => {
    expect(getResolution('{"resolution":"unresolved"}')).toBe("unresolved");
    expect(isUnresolved('{"resolution":"unresolved"}')).toBe(true);
  });

  it("treats an unrecognized value as confirmed", () => {
    expect(getResolution('{"resolution":"maybe"}')).toBe("confirmed");
  });
});

describe("getCompartments", () => {
  it("defaults to public, never to secret", () => {
    expect(getCompartments("{}")).toEqual([PUBLIC_COMPARTMENT]);
    expect(getCompartments('{"compartments":[]}')).toEqual([PUBLIC_COMPARTMENT]);
    expect(getCompartments('{"compartments":"cannabis"}')).toEqual([
      PUBLIC_COMPARTMENT,
    ]);
  });

  it("lowercases, trims and dedupes", () => {
    expect(getCompartments('{"compartments":[" Cannabis ","cannabis","ECM"]}')).toEqual(
      ["cannabis", "ecm"]
    );
  });

  it("drops non-string members", () => {
    expect(getCompartments('{"compartments":["cannabis",5,null]}')).toEqual([
      "cannabis",
    ]);
  });
});

describe("isNameLocked", () => {
  it("defaults to false and requires strict true", () => {
    expect(isNameLocked("{}")).toBe(false);
    expect(isNameLocked('{"name_locked":"true"}')).toBe(false);
    expect(isNameLocked('{"name_locked":true}')).toBe(true);
  });
});

describe("getMergeCandidate", () => {
  it("returns null when absent or malformed", () => {
    expect(getMergeCandidate("{}")).toBeNull();
    expect(getMergeCandidate('{"merge_candidate":{}}')).toBeNull();
    expect(getMergeCandidate('{"merge_candidate":"e2"}')).toBeNull();
  });

  it("returns the candidate when it names a target", () => {
    const c = getMergeCandidate(
      '{"merge_candidate":{"target_entity_id":"e2","confidence":0.8,"reason":"suffix"}}'
    );
    expect(c?.target_entity_id).toBe("e2");
    expect(c?.confidence).toBe(0.8);
  });
});

describe("getVentureConfig and getCrmFields", () => {
  it("default to empty objects", () => {
    expect(getVentureConfig("{}")).toEqual({});
    expect(getCrmFields("{}")).toEqual({});
    expect(getVentureConfig('{"venture":[]}')).toEqual({});
  });

  it("read nested config", () => {
    const meta =
      '{"venture":{"slug":"cedar-line","compliance_rules":["No health claims."]},"crm":{"relationship_stage":"prospect"}}';
    expect(getVentureConfig(meta).slug).toBe("cedar-line");
    expect(getVentureConfig(meta).compliance_rules).toEqual([
      "No health claims.",
    ]);
    expect(getCrmFields(meta).relationship_stage).toBe("prospect");
  });
});
