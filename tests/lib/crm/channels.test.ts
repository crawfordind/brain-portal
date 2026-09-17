import { describe, it, expect } from "vitest";
import {
  normalizeChannelValue,
  isChannelKind,
  CHANNEL_KINDS,
} from "@/lib/crm/channels";

describe("normalizeChannelValue - email", () => {
  it("lowercases and trims", () => {
    expect(normalizeChannelValue("email", "  Dana@Northwind.COM ")).toBe(
      "dana@northwind.com"
    );
  });

  it("preserves plus-tags", () => {
    // Collapsing these would merge two contacts the owner kept apart.
    expect(normalizeChannelValue("email", "dana+wholesale@farm.com")).toBe(
      "dana+wholesale@farm.com"
    );
    expect(normalizeChannelValue("email", "dana+wholesale@farm.com")).not.toBe(
      normalizeChannelValue("email", "dana@farm.com")
    );
  });

  it("strips a mailto: prefix", () => {
    expect(normalizeChannelValue("email", "mailto:Dana@Farm.com")).toBe(
      "dana@farm.com"
    );
  });

  it("rejects malformed addresses", () => {
    expect(normalizeChannelValue("email", "not-an-email")).toBe("");
    expect(normalizeChannelValue("email", "two@@at.com")).toBe("");
    expect(normalizeChannelValue("email", "no@domain")).toBe("");
    expect(normalizeChannelValue("email", "has space@domain.com")).toBe("");
    expect(normalizeChannelValue("email", "@domain.com")).toBe("");
  });
});

describe("normalizeChannelValue - phone", () => {
  it("reduces formatting to E.164-ish digits", () => {
    const expected = "+15551234567";
    expect(normalizeChannelValue("phone", "(555) 123-4567")).toBe(expected);
    expect(normalizeChannelValue("phone", "555.123.4567")).toBe(expected);
    expect(normalizeChannelValue("phone", "1-555-123-4567")).toBe(expected);
    expect(normalizeChannelValue("phone", "+1 555 123 4567")).toBe(expected);
  });

  it("keeps a non-US country code as given", () => {
    expect(normalizeChannelValue("phone", "+44 20 7946 0958")).toBe(
      "+442079460958"
    );
  });

  it("rejects anything too short to be a number", () => {
    expect(normalizeChannelValue("phone", "12345")).toBe("");
    expect(normalizeChannelValue("phone", "ext. 12")).toBe("");
  });
});

describe("normalizeChannelValue - handle", () => {
  it("drops a leading @ and lowercases", () => {
    expect(normalizeChannelValue("handle", "@CedarLine")).toBe("cedarline");
  });

  it("extracts the handle from a pasted profile URL", () => {
    expect(
      normalizeChannelValue("handle", "https://instagram.com/cedarline")
    ).toBe("cedarline");
    expect(normalizeChannelValue("handle", "www.threads.net/@cedarline/")).toBe(
      "cedarline"
    );
  });

  it("rejects a handle with illegal characters", () => {
    expect(normalizeChannelValue("handle", "not a handle")).toBe("");
  });
});

describe("normalizeChannelValue - url", () => {
  it("drops scheme, www and trailing slash", () => {
    const expected = "northwindfarms.com";
    expect(normalizeChannelValue("url", "https://www.northwindfarms.com/")).toBe(
      expected
    );
    expect(normalizeChannelValue("url", "HTTP://Northwindfarms.com")).toBe(
      expected
    );
  });

  it("keeps the path but drops the fragment", () => {
    expect(
      normalizeChannelValue("url", "https://example.com/contact#form")
    ).toBe("example.com/contact");
  });

  it("rejects a value with no dot in the host", () => {
    expect(normalizeChannelValue("url", "localhost/thing")).toBe("");
  });
});

describe("normalizeChannelValue - address", () => {
  it("collapses whitespace and lowercases", () => {
    expect(normalizeChannelValue("address", "  12  Main   St\nMilton NY ")).toBe(
      "12 main st milton ny"
    );
  });
});

describe("normalizeChannelValue - general", () => {
  it("returns empty for blank input on every kind", () => {
    for (const kind of CHANNEL_KINDS) {
      expect(normalizeChannelValue(kind, "   ")).toBe("");
      expect(normalizeChannelValue(kind, "")).toBe("");
    }
  });

  it("is idempotent: normalizing a normalized value is a no-op", () => {
    const cases: [(typeof CHANNEL_KINDS)[number], string][] = [
      ["email", "Dana@Northwind.com"],
      ["phone", "(555) 123-4567"],
      ["handle", "@CedarLine"],
      ["url", "https://www.northwindfarms.com/"],
      ["address", " 12 Main St "],
    ];
    for (const [kind, raw] of cases) {
      const once = normalizeChannelValue(kind, raw);
      expect(normalizeChannelValue(kind, once)).toBe(once);
    }
  });
});

describe("isChannelKind", () => {
  it("accepts known kinds and rejects others", () => {
    expect(isChannelKind("email")).toBe(true);
    expect(isChannelKind("fax")).toBe(false);
  });
});
