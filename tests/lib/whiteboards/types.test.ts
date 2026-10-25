import { describe, it, expect } from "vitest";
import {
  DEFAULT_SIZE,
  encodeBoardTarget,
  isValidItemId,
  newItemId,
  normalizeItemInput,
  parseBoardTarget,
  parseProps,
} from "@/lib/whiteboards/types";

describe("normalizeItemInput", () => {
  it("fills defaults for an agent's bare sticky", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "sticky", text: "Idea" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.item).toMatchObject({ x: 0, y: 0, w: DEFAULT_SIZE.sticky.w, h: DEFAULT_SIZE.sticky.h, color: "yellow", text: "Idea" });
  });

  it("rejects unknown kinds and bad ids", () => {
    expect(normalizeItemInput({ id: "wi_abcdef", kind: "video" }).ok).toBe(false);
    expect(normalizeItemInput({ id: "x", kind: "sticky" }).ok).toBe(false);
    expect(normalizeItemInput({ id: "has space!", kind: "sticky" }).ok).toBe(false);
    expect(normalizeItemInput(null).ok).toBe(false);
  });

  it("clamps rather than rejects out-of-range numbers", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "sticky", x: 5e9, y: "12", w: 1, h: Infinity });
    expect(r.ok && r.item).toMatchObject({ x: 1_000_000, y: 12, w: 8, h: DEFAULT_SIZE.sticky.h });
  });

  it("unknown colours fall back to the kind's default", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "sticky", color: "#ff0000" });
    expect(r.ok && r.item.color).toBe("yellow");
  });

  it("caps text length", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "text", text: "a".repeat(10_000) });
    expect(r.ok && r.item.text.length).toBe(5000);
  });

  it("needs both ends on a connector, and not the same item", () => {
    expect(normalizeItemInput({ id: "wi_conn01", kind: "connector", from_item_id: "wi_aaaaaa" }).ok).toBe(false);
    expect(
      normalizeItemInput({ id: "wi_conn01", kind: "connector", from_item_id: "wi_aaaaaa", to_item_id: "wi_aaaaaa" }).ok
    ).toBe(false);
    const ok = normalizeItemInput({ id: "wi_conn01", kind: "connector", from_item_id: "wi_aaaaaa", to_item_id: "wi_bbbbbb" });
    expect(ok.ok && ok.item.props.arrow).toBe(true);
  });

  it("drops connector ends and card refs from other kinds", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "sticky", from_item_id: "wi_aaaaaa", ref_type: "note", ref_id: "n1" });
    expect(r.ok && r.item).toMatchObject({ from_item_id: null, ref_type: null, ref_id: null });
  });

  it("needs a ref on a card", () => {
    expect(normalizeItemInput({ id: "wi_card01", kind: "card" }).ok).toBe(false);
    expect(normalizeItemInput({ id: "wi_card01", kind: "card", ref_type: "contact", ref_id: "c1" }).ok).toBe(false);
    expect(normalizeItemInput({ id: "wi_card01", kind: "card", ref_type: "task", ref_id: "t1" }).ok).toBe(true);
  });

  it("keeps ink points, dropping malformed ones", () => {
    const r = normalizeItemInput({ id: "wi_ink001", kind: "ink", props: { points: [[0, 0], ["x", 1], [3, 4]] } });
    expect(r.ok && r.item.props.points).toEqual([[0, 0], [3, 4]]);
    expect(normalizeItemInput({ id: "wi_ink001", kind: "ink", props: { points: [] } }).ok).toBe(false);
  });

  it("defaults a shape to a rectangle", () => {
    const r = normalizeItemInput({ id: "wi_abcdef", kind: "shape", props: { shape: "hexagon" } });
    expect(r.ok && r.item.props.shape).toBe("rect");
  });
});

describe("ids and targets", () => {
  it("mints valid ids", () => {
    const a = newItemId();
    expect(isValidItemId(a)).toBe(true);
    expect(newItemId()).not.toBe(a);
  });

  it("round-trips a board target, keeping colons in the id", () => {
    expect(parseBoardTarget(encodeBoardTarget("note", "abc"))).toEqual({ scope: "note", id: "abc" });
    expect(parseBoardTarget("project:a:b")).toEqual({ scope: "project", id: "a:b" });
    expect(parseBoardTarget("task:abc")).toBeNull();
    expect(parseBoardTarget("note:")).toBeNull();
    expect(parseBoardTarget(null)).toBeNull();
  });

  it("reads a corrupt props column as empty", () => {
    expect(parseProps("{not json")).toEqual({});
    expect(parseProps('{"shape":"ellipse"}')).toEqual({ shape: "ellipse" });
  });
});
