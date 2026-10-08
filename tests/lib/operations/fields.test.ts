import { describe, it, expect } from "vitest";
import {
  applyOpsPatch,
  readOps,
  resolveOps,
  restorePatch,
  validateOpsPatch,
} from "@/lib/operations/fields";

describe("readOps / resolveOps", () => {
  it("reads a task with no ops as a confirmed action the user owns", () => {
    // Every task written before Operations existed has no `ops` key; it must
    // read as exactly what it is, not as something needing review.
    const resolved = resolveOps(readOps('{"other":"kept"}'));
    expect(resolved).toMatchObject({ kind: "action", state: "confirmed", owner: "me", blocked: false });
  });

  it("derives the owner from the kind", () => {
    expect(resolveOps({ kind: "waiting" }).owner).toBe("other");
    expect(resolveOps({ kind: "decision" }).owner).toBe("me");
    expect(resolveOps({ kind: "commitment", direction: "they_owe" }).owner).toBe("other");
    expect(resolveOps({ kind: "commitment", direction: "i_owe" }).owner).toBe("me");
  });

  it("drops garbage field by field instead of throwing", () => {
    const ops = readOps(
      JSON.stringify({ ops: { kind: "waitng", expected_at: "2026-02-30", options: [1, "A"], counterparty: "Will" } })
    );
    expect(ops).toEqual({ options: ["A"], counterparty: "Will" });
    expect(readOps("not json")).toEqual({});
    expect(readOps(null)).toEqual({});
  });
});

describe("validateOpsPatch", () => {
  it("rejects an invalid enum rather than silently ignoring it", () => {
    const result = validateOpsPatch({ kind: "waitng" });
    expect(result.ok).toBe(false);
  });

  it("treats null and empty string as delete", () => {
    expect(validateOpsPatch({ blocked_by: null, counterparty: "" })).toEqual({
      ok: true,
      patch: { blocked_by: null, counterparty: null },
    });
  });

  it("validates dates", () => {
    expect(validateOpsPatch({ expected_at: "next week" }).ok).toBe(false);
    expect(validateOpsPatch({ expected_at: "2026-10-15T10:00:00Z" })).toEqual({
      ok: true,
      patch: { expected_at: "2026-10-15" },
    });
  });
});

describe("applyOpsPatch", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("preserves sibling metadata keys and returns the previous ops", () => {
    const original = JSON.stringify({ source: "import", ops: { kind: "decision" } });
    const { metadata, previous, next } = applyOpsPatch(original, { kind: "waiting", counterparty: "Will" }, now);
    const parsed = JSON.parse(metadata);
    expect(parsed.source).toBe("import");
    expect(previous).toEqual({ kind: "decision" });
    expect(next).toMatchObject({ kind: "waiting", counterparty: "Will" });
  });

  it("resets an explicit owner when the kind changes, unless one is given", () => {
    const original = JSON.stringify({ ops: { kind: "action", owner: "me" } });
    const { next } = applyOpsPatch(original, { kind: "waiting" }, now);
    expect(next.owner).toBeUndefined();
    expect(resolveOps(next).owner).toBe("other");
  });

  it("restorePatch puts back exactly the previous state", () => {
    const original = JSON.stringify({ keep: 1, ops: { kind: "decision", why: "cash" } });
    const first = applyOpsPatch(original, { kind: "waiting", counterparty: "Will", why: null }, now);
    const undone = applyOpsPatch(first.metadata, restorePatch(first.previous), now);
    const { updated_at: _a, ...restored } = undone.next;
    void _a;
    expect(restored).toEqual({ kind: "decision", why: "cash" });
    expect(JSON.parse(undone.metadata).keep).toBe(1);
  });
});
