import { describe, it, expect } from "vitest";
import {
  boardOutline,
  boardToMarkdown,
  childrenOf,
  connectorEnds,
  descendantsOf,
  edgePoint,
  frameOf,
  intersects,
  itemRect,
  placeNewItems,
  tidyLayout,
} from "@/lib/whiteboards/layout";
import type { CardRef, WhiteboardItem } from "@/lib/whiteboards/types";

function item(over: Partial<WhiteboardItem> & Pick<WhiteboardItem, "id">): WhiteboardItem {
  return {
    board_id: "b1",
    kind: "sticky",
    x: 0,
    y: 0,
    w: 200,
    h: 200,
    z: 0,
    text: "",
    color: "yellow",
    props: {},
    from_item_id: null,
    to_item_id: null,
    ref_type: null,
    ref_id: null,
    rev: 0,
    source_actor: null,
    source_label: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

const frame = item({ id: "f1", kind: "frame", x: 0, y: 0, w: 800, h: 600, text: "Risks", z: -1000 });
const inner = item({ id: "f2", kind: "frame", x: 40, y: 60, w: 400, h: 300, text: "Supply", z: -999 });
const a = item({ id: "a", x: 60, y: 100, text: "Late parts" });
const b = item({ id: "b", x: 500, y: 100, text: "Price rise" });
const loose = item({ id: "c", x: 1200, y: 0, text: "Loose idea" });

describe("frame membership", () => {
  const all = [frame, inner, a, b, loose];

  it("an item belongs to the smallest frame holding its centre", () => {
    expect(frameOf(a, all)?.id).toBe("f2");
    expect(frameOf(b, all)?.id).toBe("f1");
    expect(frameOf(loose, all)).toBeNull();
    expect(frameOf(inner, all)?.id).toBe("f1");
  });

  it("children are direct, descendants are all depths", () => {
    expect(childrenOf(frame, all).map((i) => i.id).sort()).toEqual(["b", "f2"]);
    expect(descendantsOf(frame, all).map((i) => i.id).sort()).toEqual(["a", "b", "f2"]);
  });
});

describe("placeNewItems", () => {
  it("starts an empty board at the origin", () => {
    const { placements } = placeNewItems([], [{ index: 0, kind: "sticky" }]);
    expect(placements[0]).toMatchObject({ x: 0, y: 0, w: 200, h: 200 });
  });

  it("never lands new loose items on existing ones", () => {
    const existing = [frame, a, b, loose];
    const { placements } = placeNewItems(
      existing,
      Array.from({ length: 7 }, (_, index) => ({ index, kind: "sticky" as const }))
    );
    for (const p of placements) {
      for (const e of existing) expect(intersects(p, itemRect(e))).toBe(false);
    }
    // ...nor on each other.
    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) expect(intersects(placements[i], placements[j])).toBe(false);
    }
  });

  it("puts items into a named frame, below its contents, and grows the frame to fit", () => {
    const small = item({ id: "f3", kind: "frame", x: 0, y: 0, w: 500, h: 300, text: "Ideas" });
    const kid = item({ id: "k", x: 40, y: 60, w: 200, h: 200 });
    const { placements, frameGrowth } = placeNewItems(
      [small, kid],
      [0, 1, 2].map((index) => ({ index, kind: "sticky" as const, frameId: "f3" }))
    );
    for (const p of placements) {
      expect(p.y).toBeGreaterThan(kid.y + kid.h);
      expect(p.x).toBeGreaterThanOrEqual(small.x);
    }
    expect(frameGrowth).toHaveLength(1);
    const g = frameGrowth[0];
    for (const p of placements) {
      expect(p.x + p.w).toBeLessThanOrEqual(small.x + g.w);
      expect(p.y + p.h).toBeLessThanOrEqual(small.y + g.h);
    }
  });

  it("leaves positioned items where they were asked to be", () => {
    const { placements } = placeNewItems([a], [{ index: 0, kind: "text", x: 5, y: 6 }]);
    expect(placements[0]).toMatchObject({ x: 5, y: 6 });
  });
});

describe("tidyLayout", () => {
  it("returns only what moved, and moving twice changes nothing more", () => {
    const messy = [
      item({ id: "fr", kind: "frame", x: 10, y: 10, w: 300, h: 300, text: "Group" }),
      item({ id: "s1", x: 30, y: 200 }),
      item({ id: "s2", x: 150, y: 40 }),
      item({ id: "l1", x: 900, y: 700 }),
    ];
    const first = tidyLayout(messy);
    expect(first.length).toBeGreaterThan(0);
    const applied = messy.map((m) => ({ ...m, ...(first.find((c) => c.id === m.id) ?? {}) }));
    expect(tidyLayout(applied)).toEqual([]);
    // The frame's children stay inside it.
    const fr = applied.find((i) => i.id === "fr")!;
    for (const id of ["s1", "s2"]) expect(frameOf(applied.find((i) => i.id === id)!, applied)?.id).toBe(fr.id);
    // The loose item ends up outside the frame.
    expect(frameOf(applied.find((i) => i.id === "l1")!, applied)).toBeNull();
  });
});

describe("connectors", () => {
  it("meets a box at its edge, not its centre", () => {
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 100 }, [500, 50])).toEqual([100, 50]);
    expect(edgePoint({ x: 0, y: 0, w: 100, h: 100 }, [50, -500])).toEqual([50, 0]);
  });

  it("is null when an end has been deleted", () => {
    const byId = new Map([[a.id, a]]);
    expect(connectorEnds({ from_item_id: "a", to_item_id: "gone", props: {} }, byId)).toBeNull();
  });

  it("joins two items edge to edge", () => {
    const left = item({ id: "l", x: 0, y: 0, w: 100, h: 100 });
    const right = item({ id: "r", x: 300, y: 0, w: 100, h: 100 });
    const ends = connectorEnds({ from_item_id: "l", to_item_id: "r", props: {} }, new Map([["l", left], ["r", right]]));
    expect(ends).toEqual({ start: [100, 50], end: [300, 50] });
  });
});

describe("reading a board", () => {
  const refs = new Map<string, CardRef>([
    ["task:t1", { type: "task", id: "t1", title: "Call the supplier", slug: null, status: "pending", due_date: "2026-11-01" }],
  ]);
  const card = item({ id: "card", kind: "card", x: 1300, y: 300, w: 260, h: 120, ref_type: "task", ref_id: "t1" });
  const arrow = item({ id: "ar", kind: "connector", from_item_id: "c", to_item_id: "card", text: "leads to", w: 0, h: 0 });
  const ink = item({ id: "ink", kind: "ink", props: { points: [[0, 0], [5, 5]] } });
  const all = [frame, inner, a, b, loose, card, arrow, ink];

  it("outlines frames, nesting, cards with live status and arrows, with ids", () => {
    const text = boardOutline("Launch", all, refs);
    expect(text).toContain('Frame "Risks" (id f1)');
    expect(text).toMatch(/ {2}- Frame "Supply"/);
    expect(text).toMatch(/ {4}- \[yellow sticky\] Late parts \(id a\)/);
    expect(text).toContain("[task, pending, due 2026-11-01] Call the supplier (task t1)");
    expect(text).toContain('"Loose idea" → "[task, pending, due 2026-11-01] Call the supplier (task t1)" (leads to)');
    expect(text).toContain("1 hand-drawn stroke not shown");
  });

  it("says when a board is empty, and truncates honestly", () => {
    expect(boardOutline("Empty", [])).toContain("(empty)");
    const many = Array.from({ length: 50 }, (_, i) => item({ id: `s${i}`, x: i * 300, text: `n${i}` }));
    const text = boardOutline("Big", many, new Map(), { maxLines: 10 });
    expect(text.split("\n")).toHaveLength(11);
    expect(text).toMatch(/… 41 more lines$/);
  });

  it("writes markdown with frames as headings and no ids", () => {
    const md = boardToMarkdown("Launch", all, refs);
    expect(md).toMatch(/^# Launch/);
    expect(md).toContain("## Risks");
    expect(md).toContain("### Supply");
    expect(md).toContain("- Price rise");
    expect(md).toContain("- [ ] Call the supplier");
    expect(md).not.toContain("sticky]");
    expect(md).not.toContain("(id ");
    expect(md).toContain("## Connections");
  });
});
