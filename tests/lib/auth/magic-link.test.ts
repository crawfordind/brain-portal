import { describe, it, expect } from "vitest";
import {
  assessMagicLink,
  describeMinutes,
  magicLinkTtlMinutes,
  normalizeEmail,
  parseStoredTimestamp,
  DEFAULT_MAGIC_LINK_MINUTES,
  MAX_LINK_USES,
} from "@/lib/auth/magic-link";

const NOW = new Date("2026-10-13T12:00:00.000Z");
const link = (
  overrides: Partial<{ email: string; expires_at: string; used: number | boolean; link_uses: number }> = {}
) => ({
  email: "owner@example.com",
  expires_at: "2026-10-13T12:10:00.000Z",
  used: 0,
  ...overrides,
});

describe("magicLinkTtlMinutes", () => {
  it("defaults when unset, blank or nonsense", () => {
    expect(magicLinkTtlMinutes({})).toBe(DEFAULT_MAGIC_LINK_MINUTES);
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "  " })).toBe(DEFAULT_MAGIC_LINK_MINUTES);
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "soon" })).toBe(DEFAULT_MAGIC_LINK_MINUTES);
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "-4" })).toBe(DEFAULT_MAGIC_LINK_MINUTES);
  });

  it("clamps so a typo cannot make links dead on arrival or month-long", () => {
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "1" })).toBe(5);
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "60" })).toBe(60);
    expect(magicLinkTtlMinutes({ MAGIC_LINK_EXPIRY_MINUTES: "99999" })).toBe(1440);
  });
});

describe("describeMinutes", () => {
  it("reads naturally in the email", () => {
    expect(describeMinutes(30)).toBe("30 minutes");
    expect(describeMinutes(60)).toBe("1 hour");
    expect(describeMinutes(120)).toBe("2 hours");
    expect(describeMinutes(90)).toBe("90 minutes");
  });
});

describe("normalizeEmail", () => {
  it("folds a phone keyboard's capital and stray spaces", () => {
    expect(normalizeEmail("  Owner@Example.COM ")).toBe("owner@example.com");
  });
});

describe("parseStoredTimestamp", () => {
  it("reads both ISO rows and SQLite's zone-less UTC shape", () => {
    expect(parseStoredTimestamp("2026-10-13T12:10:00.000Z")?.toISOString()).toBe("2026-10-13T12:10:00.000Z");
    expect(parseStoredTimestamp("2026-10-13 12:10:00")?.toISOString()).toBe("2026-10-13T12:10:00.000Z");
    expect(parseStoredTimestamp("garbage")).toBeNull();
    expect(parseStoredTimestamp(null)).toBeNull();
  });
});

describe("assessMagicLink", () => {
  it("accepts a fresh, unused link for the same address, whatever its case", () => {
    expect(assessMagicLink(link(), "Owner@Example.com", NOW)).toEqual({ ok: true });
  });

  it("calls a missing link or another address's link invalid", () => {
    expect(assessMagicLink(null, "owner@example.com", NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(assessMagicLink(link({ used: 1 }), "someone@example.com", NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("names a spent link as used", () => {
    expect(assessMagicLink(link({ used: 1 }), "owner@example.com", NOW)).toEqual({ ok: false, reason: "used" });
    expect(assessMagicLink(link({ used: true }), "owner@example.com", NOW)).toEqual({ ok: false, reason: "used" });
  });

  it("tolerates a few opens from other browsers, so a scanner cannot use a link up alone", () => {
    expect(assessMagicLink(link({ link_uses: MAX_LINK_USES - 1 }), "owner@example.com", NOW)).toEqual({ ok: true });
    expect(assessMagicLink(link({ link_uses: MAX_LINK_USES }), "owner@example.com", NOW)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("always lets in the browser that asked for the link, while it lives", () => {
    const spent = link({ used: 1, link_uses: MAX_LINK_USES });
    expect(assessMagicLink(spent, "owner@example.com", NOW, { sameBrowser: true })).toEqual({ ok: true });
    // …but never past its lifetime, and never for another address.
    expect(
      assessMagicLink(link({ expires_at: "2026-10-13T11:00:00.000Z" }), "owner@example.com", NOW, { sameBrowser: true })
    ).toEqual({ ok: false, reason: "expired" });
    expect(assessMagicLink(spent, "someone@example.com", NOW, { sameBrowser: true })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("expires by time, not by text comparison", () => {
    // Same UTC day, one hour past expiry. The old `expires_at > datetime('now')`
    // compared "2026-10-13T11:00…" with "2026-10-13 12:00…" as text, and the
    // "T" sorts after the space, so this link was still accepted.
    expect(assessMagicLink(link({ expires_at: "2026-10-13T11:00:00.000Z" }), "owner@example.com", NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(assessMagicLink(link({ expires_at: "2026-10-13T12:00:00.000Z" }), "owner@example.com", NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
