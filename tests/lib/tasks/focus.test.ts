import { describe, expect, it } from "vitest";
import { daysBetween, dueDay, rankFocusTasks, scoreFocusTask } from "@/lib/tasks/focus";

const base = { status: "pending", priority: "medium", due_date: null as string | null };
const today = "2026-11-03";

describe("dueDay / daysBetween", () => {
  it("keeps date-only dates as written", () => {
    expect(dueDay("2026-11-03")).toBe("2026-11-03");
  });
  it("counts calendar days", () => {
    expect(daysBetween("2026-11-01", today)).toBe(2);
    expect(daysBetween("2026-11-04", today)).toBe(-1);
  });
});

describe("scoreFocusTask", () => {
  it("ignores done, cancelled and delegated work", () => {
    expect(scoreFocusTask({ id: "a", ...base, status: "completed", due_date: today }, today)).toBeNull();
    expect(scoreFocusTask({ id: "a", ...base, due_date: today, delegated_to: "general" }, today)).toBeNull();
  });
  it("gives a calm task no focus", () => {
    expect(scoreFocusTask({ id: "a", ...base }, today)).toBeNull();
    expect(scoreFocusTask({ id: "a", ...base, due_date: "2026-11-04" }, today)).toBeNull();
  });
  it("names the strongest reason", () => {
    expect(scoreFocusTask({ id: "a", ...base, due_date: "2026-11-01", priority: "urgent" }, today)?.reason).toBe(
      "Overdue 2 days"
    );
    expect(scoreFocusTask({ id: "a", ...base, due_date: today }, today)?.reason).toBe("Due today");
    expect(scoreFocusTask({ id: "a", ...base, priority: "urgent" }, today)?.reason).toBe("Urgent");
  });
});

describe("rankFocusTasks", () => {
  it("puts overdue before due today before urgent, and caps the list", () => {
    const tasks = [
      { id: "u", ...base, priority: "urgent" },
      { id: "t", ...base, due_date: today },
      { id: "o", ...base, due_date: "2026-10-30" },
      { id: "calm", ...base },
    ];
    expect(rankFocusTasks(tasks, today).map((p) => p.task.id)).toEqual(["o", "t", "u"]);
    expect(rankFocusTasks(tasks, today, 1)).toHaveLength(1);
  });
});
