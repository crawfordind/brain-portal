import { describe, it, expect } from "vitest";
import {
  buildMindGraph,
  scoreMindItem,
  readDue,
  hashString,
  type MindSourceItem,
} from "@/lib/stream/mind";

// Local noon, so calendar-day arithmetic is the same in every test timezone.
const NOW = new Date(2026, 10, 2, 12, 0, 0);

function iso(date: Date): string {
  return date.toISOString();
}

function day(offsetDays: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

let counter = 0;
function item(partial: Partial<MindSourceItem> = {}): MindSourceItem {
  counter += 1;
  const weekAgo = new Date(NOW.getTime() - 7 * 24 * 3600 * 1000);
  return {
    id: `id-${counter}`,
    type: "note",
    status: "active",
    title: `Item ${counter}`,
    priority: "medium",
    createdAt: iso(weekAgo),
    updatedAt: iso(weekAgo),
    ...partial,
  };
}

describe("readDue", () => {
  it("compares date-only values as calendar days", () => {
    expect(readDue(day(0), NOW)?.days).toBe(0);
    expect(readDue(day(-3), NOW)?.days).toBe(-3);
    expect(readDue(day(2), NOW)?.days).toBe(2);
  });

  it("returns null for missing or unreadable values", () => {
    expect(readDue(null, NOW)).toBeNull();
    expect(readDue("not a date", NOW)).toBeNull();
  });
});

describe("scoreMindItem", () => {
  it("ranks an overdue task above one due today, and both above a plain note", () => {
    const overdue = scoreMindItem(item({ type: "task", dueDate: day(-2) }), NOW);
    const today = scoreMindItem(item({ type: "task", dueDate: day(0) }), NOW);
    const note = scoreMindItem(item({ type: "note" }), NOW);

    expect(overdue.score).toBeGreaterThan(today.score);
    expect(today.score).toBeGreaterThan(note.score);
    expect(overdue.reason).toBe("Overdue by 2 days");
    expect(today.reason).toBe("Due today");
  });

  it("does not call a task due today overdue", () => {
    const s = scoreMindItem(item({ type: "task", dueDate: day(0) }), NOW);
    expect(s.reason).not.toMatch(/Overdue/);
  });

  it("puts work waiting for review high, and says so", () => {
    const s = scoreMindItem(item({ type: "agent_output", status: "waiting" }), NOW);
    expect(s.reason).toBe("Ready for your review");
    expect(s.score).toBeGreaterThan(50);
  });

  it("treats a just-captured thought as on the user's mind", () => {
    const fresh = scoreMindItem(
      item({ type: "thought", createdAt: iso(new Date(NOW.getTime() - 10 * 60000)) }),
      NOW
    );
    const old = scoreMindItem(item({ type: "thought" }), NOW);
    expect(fresh.score).toBeGreaterThan(old.score);
    expect(fresh.reason).toBe("Just captured");
  });

  it("ignores due dates on things that are not actions", () => {
    const note = scoreMindItem(item({ type: "note", dueDate: day(-5) }), NOW);
    expect(note.reason).not.toMatch(/Overdue/);
  });

  it("explains work an agent is still doing", () => {
    const s = scoreMindItem(item({ type: "agent_output", status: "processing" }), NOW);
    expect(s.reason).toBe("Being worked on");
  });
});

describe("buildMindGraph", () => {
  it("returns an empty graph for no items", () => {
    const g = buildMindGraph([], { now: NOW });
    expect(g.nodes).toEqual([]);
    expect(g.focusKey).toBeNull();
  });

  it("puts the most important item at the centre as the moment", () => {
    const urgent = item({ type: "task", dueDate: day(-1), priority: "urgent", title: "Pay rent" });
    const g = buildMindGraph([item(), item(), urgent, item()], { now: NOW });

    const focus = g.nodes.find((n) => n.key === g.focusKey)!;
    expect(focus.item?.title).toBe("Pay rent");
    expect(focus.ring).toBe("moment");
    expect(focus.position).toEqual([0, 0, 0]);
    expect(g.ranked[0].key).toBe(g.focusKey);
  });

  it("fills the today shell with the next few, then the life ring", () => {
    const items = Array.from({ length: 12 }, () => item());
    const g = buildMindGraph(items, { now: NOW, todayCount: 4 });
    const rings = g.ranked.map((n) => n.ring);
    expect(rings.filter((r) => r === "moment")).toHaveLength(1);
    expect(rings.filter((r) => r === "today")).toHaveLength(4);
    expect(rings.filter((r) => r === "life")).toHaveLength(7);
  });

  it("leaves out done and archived items, and duplicates", () => {
    const dup = item();
    const g = buildMindGraph(
      [dup, { ...dup }, item({ status: "completed" }), item({ status: "archived" })],
      { now: NOW }
    );
    expect(g.ranked).toHaveLength(1);
  });

  it("caps how many items are drawn", () => {
    const items = Array.from({ length: 80 }, () => item());
    expect(buildMindGraph(items, { now: NOW, maxItems: 20 }).ranked).toHaveLength(20);
  });

  it("makes project hubs and links items to them", () => {
    const a = item({ projectId: "p1", projectName: "Garden" });
    const b = item({ projectId: "p1", projectName: "Garden" });
    const g = buildMindGraph([item({ type: "task", dueDate: day(0) }), a, b], { now: NOW });

    const hub = g.nodes.find((n) => n.key === "hub:p1");
    expect(hub?.label).toBe("Garden");
    const projectEdges = g.edges.filter((e) => e.kind === "project" && e.to === "hub:p1");
    expect(projectEdges.map((e) => e.from).sort()).toEqual(
      [`note:${a.id}`, `note:${b.id}`].sort()
    );
  });

  it("links items from one run and items sharing a tag", () => {
    const r1 = item({ sourceRunId: "run-1" });
    const r2 = item({ sourceRunId: "run-1" });
    const t1 = item({ tags: ["Health"] });
    const t2 = item({ tags: ["health"] });
    const g = buildMindGraph([r1, r2, t1, t2], { now: NOW, todayCount: 0 });

    const has = (x: string, y: string, kind: string) =>
      g.edges.some(
        (e) =>
          e.kind === kind &&
          ((e.from === x && e.to === y) || (e.from === y && e.to === x))
      );
    expect(has(`note:${r1.id}`, `note:${r2.id}`, "run")).toBe(true);
    expect(has(`note:${t1.id}`, `note:${t2.id}`, "tag")).toBe(true);
  });

  it("leaves no node unconnected", () => {
    const items = Array.from({ length: 15 }, () => item());
    const g = buildMindGraph(items, { now: NOW });
    const connected = new Set(g.edges.flatMap((e) => [e.from, e.to]));
    for (const node of g.nodes) expect(connected.has(node.key)).toBe(true);
  });

  it("is deterministic: the same items draw the same brain", () => {
    const items = Array.from({ length: 10 }, () => item({ projectId: "p", projectName: "P" }));
    const a = buildMindGraph(items, { now: NOW });
    const b = buildMindGraph([...items].reverse(), { now: NOW });
    expect(a.nodes.map((n) => [n.key, n.position])).toEqual(
      b.nodes.map((n) => [n.key, n.position])
    );
  });

  it("hashes strings stably", () => {
    expect(hashString("abc")).toBe(hashString("abc"));
    expect(hashString("abc")).not.toBe(hashString("abd"));
  });
});
