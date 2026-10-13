import { describe, it, expect } from "vitest";
import {
  parseSavedRecipients,
  resolveSavedRecipient,
  strongestRole,
  validateSavedRecipients,
  MAX_SAVED_RECIPIENTS,
} from "@/lib/sharing/types";

const saved = [
  { label: "Work", email: "work@example.com" },
  { label: "Partner", email: "partner@example.com" },
];

describe("resolveSavedRecipient", () => {
  it("matches a label case-insensitively", () => {
    expect(resolveSavedRecipient(saved, "work")).toEqual({ ok: true, recipient: saved[0] });
  });

  it("matches the way people actually say it", () => {
    for (const said of ["my work account", "My Work", "the work acct", "work email"]) {
      expect(resolveSavedRecipient(saved, said), said).toEqual({ ok: true, recipient: saved[0] });
    }
  });

  it("matches a saved address exactly", () => {
    expect(resolveSavedRecipient(saved, "PARTNER@example.com")).toEqual({ ok: true, recipient: saved[1] });
  });

  it("refuses an address that is not saved, so an agent cannot pick its own destination", () => {
    const result = resolveSavedRecipient(saved, "attacker@evil.test");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('"Work"');
  });

  it("explains how to fix it when nothing is saved", () => {
    const result = resolveSavedRecipient([], "work");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Settings → Sharing");
  });

  it("never guesses between two candidates", () => {
    const twins = [
      { label: "Work", email: "a@example.com" },
      { label: "work account", email: "b@example.com" },
    ];
    expect(resolveSavedRecipient(twins, "my work").ok).toBe(false);
  });
});

describe("validateSavedRecipients", () => {
  it("normalizes addresses and trims labels", () => {
    expect(validateSavedRecipients([{ label: " Work ", email: " Work@Example.com " }])).toEqual({
      ok: true,
      recipients: [{ label: "Work", email: "work@example.com" }],
    });
  });

  it.each([
    [[{ label: "", email: "a@example.com" }], "name"],
    [[{ label: "x", email: "not-an-email" }], "valid email"],
    [[{ label: "me", email: "Owner@example.com" }], "own address"],
    [[{ label: "a", email: "a@example.com" }, { label: "A", email: "b@example.com" }], "twice"],
    [[{ label: "a", email: "a@example.com" }, { label: "b", email: "A@example.com" }], "twice"],
  ])("rejects %j", (input, message) => {
    const result = validateSavedRecipients(input, "owner@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it("caps the list", () => {
    const many = Array.from({ length: MAX_SAVED_RECIPIENTS + 1 }, (_, i) => ({
      label: `r${i}`,
      email: `r${i}@example.com`,
    }));
    expect(validateSavedRecipients(many).ok).toBe(false);
  });
});

describe("parseSavedRecipients", () => {
  it("tolerates corrupt or foreign preferences", () => {
    expect(parseSavedRecipients(null)).toEqual([]);
    expect(parseSavedRecipients("not json")).toEqual([]);
    expect(parseSavedRecipients(JSON.stringify({ models: {} }))).toEqual([]);
    expect(
      parseSavedRecipients(
        JSON.stringify({ sharing: { recipients: [{ label: "Work", email: "W@example.com" }, { label: 3 }] } })
      )
    ).toEqual([{ label: "Work", email: "w@example.com" }]);
  });
});

describe("strongestRole", () => {
  it("keeps a project editor editing when the note is also shared view-only", () => {
    expect(
      strongestRole({ role: "editor", via: "project" }, { role: "viewer", via: "share" })
    ).toEqual({ role: "editor", via: "project" });
  });

  it("returns null with no grants", () => {
    expect(strongestRole(null, undefined)).toBeNull();
  });
});
