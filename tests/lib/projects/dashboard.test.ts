import { describe, it, expect } from "vitest";
import {
  addDays,
  assessPmHealth,
  buildProjectDashboard,
  forecastFinish,
  toDay,
  weekStart,
  type DashboardProjectRow,
  type DashboardTaskRow,
} from "@/lib/projects/dashboard";

const TODAY = "2026-10-22"; // a Thursday

function project(over: Partial<DashboardProjectRow> = {}): DashboardProjectRow {
  return {
    id: "p1",
    name: "Northwind launch",
    slug: "northwind-launch",
    status: "active",
    color: null,
    parent_id: null,
    priority: 0,
    created_at: "2026-09-01 10:00:00",
    updated_at: "2026-10-20 10:00:00",
    ...over,
  };
}

let seq = 0;
function task(over: Partial<DashboardTaskRow> = {}): DashboardTaskRow {
  seq++;
  return {
    id: `t${seq}`,
    project_id: "p1",
    title: `Task ${seq}`,
    content: "",
    status: "pending",
    priority: "medium",
    due_date: null,
    completed_at: null,
    created_at: "2026-10-01 09:00:00",
    updated_at: "2026-10-20 09:00:00",
    metadata: "{}",
    ...over,
  };
}

describe("date helpers", () => {
  it("reads every stored date shape as a calendar day", () => {
    expect(toDay("2026-10-22")).toBe("2026-10-22");
    expect(toDay("2026-10-22 23:59:00")).toBe("2026-10-22");
    expect(toDay("2026-10-22T08:00:00.000Z")).toBe("2026-10-22");
    expect(toDay("soon")).toBeNull();
    expect(toDay(null)).toBeNull();
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-22")).toBe("2026-10-19");
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday
  });
});

describe("forecastFinish", () => {
  it("projects open work at the weekly pace", () => {
    expect(forecastFinish(TODAY, 4, 2)).toBe(addDays(TODAY, 14));
  });
  it("refuses to forecast without pace or open work", () => {
    expect(forecastFinish(TODAY, 4, 0)).toBeNull();
    expect(forecastFinish(TODAY, 0, 3)).toBeNull();
  });
});

describe("assessPmHealth", () => {
  const base = { open: 10, overdue: 0, blocked: 0, urgent: 0, slipDays: null, weeklyPace: 2, daysSinceActivity: 1 };

  it("is quiet with nothing open", () => {
    expect(assessPmHealth({ ...base, open: 0 }).health).toBe("quiet");
  });
  it("is red for any blocker", () => {
    const r = assessPmHealth({ ...base, blocked: 1 });
    expect(r.health).toBe("at_risk");
    expect(r.reason).toContain("1 blocked");
  });
  it("is red when a quarter of open work is overdue, amber below that", () => {
    expect(assessPmHealth({ ...base, open: 4, overdue: 1 }).health).toBe("at_risk");
    expect(assessPmHealth({ ...base, open: 10, overdue: 1 }).health).toBe("attention");
  });
  it("is red for a forecast more than a week past plan", () => {
    expect(assessPmHealth({ ...base, slipDays: 8 }).health).toBe("at_risk");
    expect(assessPmHealth({ ...base, slipDays: 3 }).health).toBe("attention");
  });
  it("flags stale and paceless projects as attention", () => {
    expect(assessPmHealth({ ...base, daysSinceActivity: 20 }).reason).toContain("no activity in 20d");
    expect(assessPmHealth({ ...base, weeklyPace: 0 }).reason).toContain("no completions");
  });
  it("is on track otherwise", () => {
    expect(assessPmHealth(base)).toEqual({ health: "on_track", reason: "10 open, nothing late" });
  });
});

describe("buildProjectDashboard", () => {
  it("counts progress, overdue, blocked and ignores cancelled tasks", () => {
    const d = buildProjectDashboard(
      [project()],
      [
        task({ status: "completed", completed_at: "2026-10-15 10:00:00", due_date: "2026-10-16" }),
        task({ status: "in_progress", due_date: "2026-10-30" }),
        task({ due_date: "2026-10-10" }),
        task({ metadata: JSON.stringify({ ops: { blocked_by: "Vendor contract" } }) }),
        task({ status: "cancelled", due_date: "2026-09-01" }),
      ],
      TODAY
    );
    const p = d.projects[0];
    expect(p).toMatchObject({ total: 4, done: 1, inProgress: 1, todo: 2, overdue: 1, blocked: 1, percentDone: 25 });
    expect(p.health).toBe("at_risk");
    expect(p.planEnd).toBe("2026-10-30");
    expect(d.kpis).toMatchObject({ openTasks: 3, overdue: 1, blocked: 1, atRisk: 1, completedLast30: 1, onTimeRate: 100 });
  });

  it("never invents a plan end for a project without due dates", () => {
    const d = buildProjectDashboard([project()], [task(), task()], TODAY);
    expect(d.projects[0].planEnd).toBeNull();
    expect(d.projects[0].slipDays).toBeNull();
    expect(d.projects[0].forecastEnd).toBeNull(); // no completions, no pace
  });

  it("measures slip as forecast against the latest due date", () => {
    // 4 completions in the last 28 days = 1/week; 3 open → 21 days out.
    const done = Array.from({ length: 4 }, () =>
      task({ status: "completed", completed_at: "2026-10-12 10:00:00" })
    );
    const open = [task({ due_date: "2026-10-29" }), task(), task()];
    const p = buildProjectDashboard([project()], [...done, ...open], TODAY).projects[0];
    expect(p.weeklyPace).toBe(1);
    expect(p.forecastEnd).toBe(addDays(TODAY, 21));
    expect(p.slipDays).toBe(14);
    expect(p.health).toBe("at_risk");
  });

  it("leaves out completed and archived projects", () => {
    const d = buildProjectDashboard(
      [project(), project({ id: "p2", status: "archived" }), project({ id: "p3", status: "completed" })],
      [task(), task({ project_id: "p2" }), task({ project_id: "p3" })],
      TODAY
    );
    expect(d.projects.map((p) => p.id)).toEqual(["p1"]);
    expect(d.kpis.openTasks).toBe(1);
  });

  it("sorts worst health first", () => {
    const d = buildProjectDashboard(
      [project({ id: "ok", name: "A" }), project({ id: "bad", name: "B" })],
      [
        task({ project_id: "ok", status: "completed", completed_at: "2026-10-20" }),
        task({ project_id: "ok", due_date: "2026-11-30" }),
        task({ project_id: "bad", due_date: "2026-10-01" }),
      ],
      TODAY
    );
    expect(d.projects.map((p) => p.id)).toEqual(["bad", "ok"]);
  });

  it("puts overdue work in this week's workload and lists upcoming in date order", () => {
    const d = buildProjectDashboard(
      [project()],
      [task({ due_date: "2026-10-01" }), task({ due_date: "2026-11-03" }), task({ due_date: "2027-06-01" })],
      TODAY
    );
    expect(d.workloadWeeks[0]).toBe("2026-10-19");
    expect(d.workload[0].counts[0]).toBe(1);
    expect(d.workload[0].counts[2]).toBe(1);
    expect(d.undated).toBe(1);
    expect(d.upcoming.map((u) => u.date)).toEqual(["2026-10-01", "2026-11-03"]);
    expect(d.upcoming[0].overdue).toBe(true);
  });

  it("builds a cumulative burn-up that carries work from before the window", () => {
    const d = buildProjectDashboard(
      [project()],
      [
        task({ created_at: "2026-01-05 10:00:00", status: "completed", completed_at: "2026-02-01 10:00:00" }),
        task({ created_at: "2026-10-20 10:00:00" }),
        task({ created_at: "2026-10-21 10:00:00", status: "completed", completed_at: "2026-10-21 12:00:00" }),
      ],
      TODAY
    );
    expect(d.history).toHaveLength(12);
    const first = d.history[0];
    const last = d.history[d.history.length - 1];
    expect(first.scope).toBe(1);
    expect(first.doneTotal).toBe(1);
    expect(last).toMatchObject({ weekStart: "2026-10-19", created: 2, completed: 1, scope: 3, doneTotal: 2 });
  });
});
