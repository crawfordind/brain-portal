import { describe, it, expect } from "vitest";
import {
  assessMerge,
  normalizeEntityKeyStrict,
  normalizeEntityKey,
  type MergeSubject,
} from "@/lib/entities/resolve";

function subject(over: Partial<MergeSubject> & { name: string }): MergeSubject {
  return { entityType: "org", ...over };
}

describe("normalizeEntityKeyStrict", () => {
  it("keeps business suffixes that normalizeEntityKey drops", () => {
    expect(normalizeEntityKeyStrict("Northwind Farms")).toBe("northwindfarms");
    expect(normalizeEntityKeyStrict("Northwind Holdings")).toBe(
      "northwindholdings"
    );
    expect(normalizeEntityKey("Northwind Farms")).toBe(
      normalizeEntityKey("Northwind Holdings")
    );
    expect(normalizeEntityKeyStrict("Northwind Farms")).not.toBe(
      normalizeEntityKeyStrict("Northwind Holdings")
    );
  });

  it("still ignores punctuation, case, diacritics and a leading article", () => {
    expect(normalizeEntityKeyStrict("The Northwind Farms")).toBe(
      normalizeEntityKeyStrict("northwind-farms")
    );
    expect(normalizeEntityKeyStrict("Beyoncé Farms")).toBe(
      normalizeEntityKeyStrict("Beyonce Farms")
    );
  });

  it("expands & to and, matching the loose key", () => {
    expect(normalizeEntityKeyStrict("Northwind & Sons")).toBe(
      normalizeEntityKeyStrict("Northwind and Sons")
    );
  });

  it("returns empty for unusable input", () => {
    expect(normalizeEntityKeyStrict("")).toBe("");
    expect(normalizeEntityKeyStrict("!!!")).toBe("");
  });
});

describe("assessMerge rule 1 - unresolved never merges", () => {
  it("separates when the existing side is unresolved", () => {
    const v = assessMerge(
      subject({ name: "Rascal", entityType: "person", resolution: "unresolved" }),
      subject({ name: "Rascal", entityType: "person" })
    );
    expect(v.action).toBe("separate");
  });

  it("separates when the incoming side is unresolved", () => {
    const v = assessMerge(
      subject({ name: "Matt", entityType: "person" }),
      subject({ name: "Matt", entityType: "person", resolution: "unresolved" })
    );
    expect(v.action).toBe("separate");
  });

  it("outranks an exact name match", () => {
    const v = assessMerge(
      subject({ name: "Northwind Farms", resolution: "unresolved" }),
      subject({ name: "Northwind Farms" })
    );
    expect(v.action).toBe("separate");
  });
});

describe("assessMerge rule 2 - conflicting verified channels", () => {
  it("separates two parties with different verified emails", () => {
    const v = assessMerge(
      subject({ name: "Dana Smith", entityType: "person", verifiedEmails: ["dana@a.com"] }),
      subject({ name: "Dana Smith", entityType: "person", verifiedEmails: ["dana@b.com"] })
    );
    expect(v.action).toBe("separate");
    expect(v.reason).toContain("conflict");
  });

  it("merges when the verified emails overlap", () => {
    const v = assessMerge(
      subject({ name: "Dana Smith", entityType: "person", verifiedEmails: ["dana@a.com"] }),
      subject({ name: "Dana Smith", entityType: "person", verifiedEmails: ["dana@a.com"] })
    );
    expect(v.action).toBe("merge");
  });

  it("does not block when only one side has a verified email", () => {
    const v = assessMerge(
      subject({ name: "Dana Smith", entityType: "person", verifiedEmails: ["dana@a.com"] }),
      subject({ name: "Dana Smith", entityType: "person" })
    );
    expect(v.action).toBe("merge");
  });
});

describe("assessMerge rule 3 - type mismatch", () => {
  it("flags a person against an org rather than merging", () => {
    const v = assessMerge(
      subject({ name: "Northwind", entityType: "person" }),
      subject({ name: "Northwind", entityType: "org" })
    );
    expect(v.action).toBe("flag");
    expect(v.reason).toContain("Type mismatch");
  });
});

describe("assessMerge rule 0 - name-locked entities", () => {
  it("flags a non-exact match against a locked venture", () => {
    const v = assessMerge(
      subject({ name: "Cedar Line", nameLocked: true }),
      subject({ name: "Cedar Line Farms" })
    );
    expect(v.action).toBe("flag");
    expect(v.reason).toContain("name-locked");
  });

  it("still merges an exact match, so venture mentions resolve normally", () => {
    const v = assessMerge(
      subject({ name: "Cedar Line", nameLocked: true }),
      subject({ name: "cedar line" })
    );
    expect(v.action).toBe("merge");
  });
});

describe("assessMerge rule 4 - exact match preserves existing behavior", () => {
  it("merges names differing only by case and punctuation", () => {
    const v = assessMerge(
      subject({ name: "Northwind Farms" }),
      subject({ name: "northwind-farms" })
    );
    expect(v.action).toBe("merge");
    expect(v.confidence).toBe(1);
  });

  it("merges across a leading article", () => {
    expect(
      assessMerge(
        subject({ name: "The Northwind Farms" }),
        subject({ name: "Northwind Farms" })
      ).action
    ).toBe("merge");
  });

  it("merges the FieldTechAI spacing case", () => {
    expect(
      assessMerge(
        subject({ name: "FieldTechAI" }),
        subject({ name: "Field Tech AI" })
      ).action
    ).toBe("merge");
  });
});

describe("assessMerge rule 5 - suffix-manufactured collisions", () => {
  it("flags Northwind Farms against Northwind Holdings", () => {
    const v = assessMerge(
      subject({ name: "Northwind Farms" }),
      subject({ name: "Northwind Holdings" })
    );
    expect(v.action).toBe("flag");
    expect(v.reason).toContain("business suffix");
  });

  it("flags Northwind Farms against Northwind & Sons", () => {
    expect(
      assessMerge(
        subject({ name: "Northwind Farms" }),
        subject({ name: "Northwind & Sons" })
      ).action
    ).toBe("flag");
  });

  it("flags the bare stem against a suffixed form", () => {
    expect(
      assessMerge(subject({ name: "Northwind" }), subject({ name: "Northwind Farms" }))
        .action
    ).toBe("flag");
  });

  it("never returns merge for any pair sharing only the loose key", () => {
    const names = [
      "Northwind",
      "Northwind Farms",
      "Northwind Holdings",
      "Northwind Co",
      "Northwind Partners",
    ];
    for (const a of names) {
      for (const b of names) {
        const verdict = assessMerge(subject({ name: a }), subject({ name: b }));
        if (normalizeEntityKeyStrict(a) === normalizeEntityKeyStrict(b)) {
          expect(verdict.action).toBe("merge");
        } else {
          expect(verdict.action).toBe("flag");
        }
      }
    }
  });
});
