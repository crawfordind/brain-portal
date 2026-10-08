import { describe, it, expect } from "vitest";
import { buildHomeSections, countItems, filterView, isLate } from "@/lib/operations/classify";
import { resolveOps } from "@/lib/operations/fields";
import type { OpsFields, OpsItem } from "@/lib/operations/types";

const TODAY = "2026-10-08";

function item(id: string, over: Partial<OpsItem> = {}, ops: OpsFields = {}): OpsItem {
  const resolved = resolveOps(ops);
  const dueDate = over.dueDate ?? null;
  return {
    id,
    title: id,
    status: "pending",
    priority: "medium",
    dueDate,
    projectId: null,
    projectName: null,
    projectSlug: null,
    ventureId: null,
    ventureName: null,
    noteId: null,
    updatedAt: null,
    href: `/tasks?task=${id}`,
    ...over,
    ops: resolved,
    nextDate: dueDate?.slice(0, 10) ?? resolved.expected_at ?? null,
  };
}

describe("buildHomeSections", () => {
  it("lists each item once, in the first section that claims it", () => {
    const overdueDecision = item("a", { dueDate: "2026-10-01" }, { kind: "decision" });
    const sections = buildHomeSections([overdueDecision], TODAY);
    const holding = sections.filter((s) => s.items.some((i) => i.id === "a")).map((s) => s.key);
    expect(holding).toEqual(["today"]);
  });

  it("caps sections but keeps the true total", () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`d${i}`, {}, { kind: "decision" }));
    const decisions = buildHomeSections(many, TODAY).find((s) => s.key === "decisions")!;
    expect(decisions.items).toHaveLength(5);
    expect(decisions.total).toBe(9);
  });

  it("leaves proposed and closed items off the home screen", () => {
    const sections = buildHomeSections(
      [
        item("p", { dueDate: TODAY }, { state: "proposed" }),
        item("c", { dueDate: TODAY, status: "completed" }),
      ],
      TODAY
    );
    expect(sections.every((s) => s.total === 0)).toBe(true);
  });

  it("puts waiting items under Waiting even when dated today, because they are not the user's move", () => {
    const sections = buildHomeSections([item("w", { dueDate: TODAY }, { kind: "waiting", counterparty: "Will" })], TODAY);
    expect(sections.find((s) => s.key === "today")!.total).toBe(0);
    expect(sections.find((s) => s.key === "waiting")!.total).toBe(1);
  });

  it("only counts real deadlines in This week, not undated work", () => {
    const sections = buildHomeSections(
      [item("soon", { dueDate: "2026-10-12" }), item("later", { dueDate: "2026-11-30" }), item("none")],
      TODAY
    );
    expect(sections.find((s) => s.key === "week")!.items.map((i) => i.id)).toEqual(["soon"]);
  });
});

describe("countItems / filterView / isLate", () => {
  it("counts the whole population", () => {
    const counts = countItems(
      [
        item("o", { dueDate: "2026-10-01" }),
        item("b", {}, { blocked_by: "permit" }),
        item("p", {}, { state: "proposed" }),
      ],
      TODAY
    );
    expect(counts).toMatchObject({ overdue: 1, blocked: 1, proposed: 1 });
  });

  it("flags a waited-on item past its expected date", () => {
    expect(isLate(item("w", {}, { kind: "waiting", expected_at: "2026-10-01" }), TODAY)).toBe(true);
    expect(isLate(item("w", {}, { kind: "waiting", expected_at: "2026-10-20" }), TODAY)).toBe(false);
  });

  it("filters views", () => {
    const list = [item("d", {}, { kind: "decision" }), item("b", {}, { blocked_by: "me" })];
    expect(filterView(list, "decisions").map((i) => i.id)).toEqual(["d"]);
    expect(filterView(list, "blocked").map((i) => i.id)).toEqual(["b"]);
  });
});
