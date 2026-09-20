import { describe, it, expect } from "vitest";
import {
  collapseRuns,
  countTypes,
  formatRunSummary,
  nounFor,
  MIN_RUN_SIZE,
  type RunnableItem,
} from "@/lib/stream/runs";
import { groupStream } from "@/lib/stream/grouping";

const NOW = new Date(2026, 8, 15, 14, 0, 0);
const minutesAgo = (n: number) =>
  new Date(NOW.getTime() - n * 60_000).toISOString();

/** Items arrive newest-first, which is what /api/stream returns. */
function item(
  id: string,
  overrides: Partial<RunnableItem> = {}
): RunnableItem {
  return {
    id,
    type: "note",
    updatedAt: minutesAgo(10),
    sourceActor: "human",
    sourceLabel: null,
    sourceRunId: null,
    ...overrides,
  };
}

function agentItem(
  id: string,
  runId: string,
  overrides: Partial<RunnableItem> = {}
): RunnableItem {
  return item(id, {
    sourceActor: "mcp_key",
    sourceLabel: "Claude Desktop",
    sourceRunId: runId,
    ...overrides,
  });
}

describe("collapseRuns", () => {
  it("passes everything through when nothing carries a run", () => {
    const items = [item("a"), item("b"), item("c")];
    const entries = collapseRuns(items);

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.kind === "item")).toBe(true);
    expect(entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
  });

  it("folds a run into one entry", () => {
    const entries = collapseRuns([
      agentItem("1", "r1"),
      agentItem("2", "r1"),
      agentItem("3", "r1"),
      agentItem("4", "r1"),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("run");
    if (entries[0].kind !== "run") throw new Error("expected a run");
    expect(entries[0].run.items).toHaveLength(4);
    expect(entries[0].run.label).toBe("Claude Desktop");
  });

  it("leaves a run smaller than the threshold expanded", () => {
    // "Claude Desktop wrote 2 notes" costs a click and says less than the two
    // rows it replaced. Summarising only pays once the batch is in the way.
    const entries = collapseRuns([agentItem("1", "r1"), agentItem("2", "r1")]);

    expect(entries).toHaveLength(2);
    expect(entries.every((e) => e.kind === "item")).toBe(true);
  });

  it("honours a custom threshold", () => {
    const entries = collapseRuns([agentItem("1", "r1"), agentItem("2", "r1")], {
      minRunSize: 2,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("run");
  });

  it("puts the run where its newest member was, keeping the feed's order", () => {
    // The run's entry must not jump to where the job *started*, or a batch
    // that began this morning would sort below things written since.
    const entries = collapseRuns([
      item("newest", { updatedAt: minutesAgo(1) }),
      agentItem("r-a", "r1", { updatedAt: minutesAgo(5) }),
      item("between", { updatedAt: minutesAgo(30) }),
      agentItem("r-b", "r1", { updatedAt: minutesAgo(60) }),
      agentItem("r-c", "r1", { updatedAt: minutesAgo(90) }),
      item("oldest", { updatedAt: minutesAgo(120) }),
    ]);

    expect(entries.map((e) => e.id)).toEqual([
      "newest",
      "run:r1",
      "between",
      "oldest",
    ]);
    expect(entries[1].updatedAt).toBe(minutesAgo(5));
  });

  it("never collapses the user's own writing", () => {
    // Even if something stamped a run id on them: the user does not need their
    // own typing summarised back to them.
    const entries = collapseRuns([
      item("1", { sourceRunId: "r1" }),
      item("2", { sourceRunId: "r1" }),
      item("3", { sourceRunId: "r1" }),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.every((e) => e.kind === "item")).toBe(true);
  });

  it("keeps separate runs separate", () => {
    const entries = collapseRuns([
      agentItem("a1", "r1"),
      agentItem("a2", "r1"),
      agentItem("a3", "r1"),
      agentItem("b1", "r2", { sourceLabel: "Research bot" }),
      agentItem("b2", "r2", { sourceLabel: "Research bot" }),
      agentItem("b3", "r2", { sourceLabel: "Research bot" }),
    ]);

    expect(entries.map((e) => e.id)).toEqual(["run:r1", "run:r2"]);
  });

  it("records the run's span from its oldest and newest writes", () => {
    const entries = collapseRuns([
      agentItem("1", "r1", { updatedAt: minutesAgo(5) }),
      agentItem("2", "r1", { updatedAt: minutesAgo(20) }),
      agentItem("3", "r1", { updatedAt: minutesAgo(45) }),
    ]);

    if (entries[0].kind !== "run") throw new Error("expected a run");
    expect(entries[0].run.startedAt).toBe(minutesAgo(45));
    expect(entries[0].run.endedAt).toBe(minutesAgo(5));
  });

  it("flags a run that reaches the end of what is loaded", () => {
    // The feed pages 30 at a time, so a big run's count is a lower bound until
    // the rest is loaded. The row says "23+" rather than claiming a total.
    const entries = collapseRuns([
      item("first"),
      agentItem("1", "r1"),
      agentItem("2", "r1"),
      agentItem("3", "r1"),
    ]);

    if (entries[1].kind !== "run") throw new Error("expected a run");
    expect(entries[1].run.mayExtend).toBe(true);
  });

  it("does not flag a run that is fully loaded", () => {
    const entries = collapseRuns([
      agentItem("1", "r1"),
      agentItem("2", "r1"),
      agentItem("3", "r1"),
      item("last"),
    ]);

    if (entries[0].kind !== "run") throw new Error("expected a run");
    expect(entries[0].run.mayExtend).toBe(false);
  });

  it("falls back to a label when the rows carry none", () => {
    const entries = collapseRuns([
      agentItem("1", "r1", { sourceLabel: null }),
      agentItem("2", "r1", { sourceLabel: null }),
      agentItem("3", "r1", { sourceLabel: null }),
    ]);

    if (entries[0].kind !== "run") throw new Error("expected a run");
    expect(entries[0].run.label).toBe("Automation");
  });

  it("handles an empty feed", () => {
    expect(collapseRuns([])).toEqual([]);
  });

  it("produces entries groupStream can bucket unchanged", () => {
    // Collapsing runs before bucketing is the whole point: a run should take
    // one slot in its time bucket, not fill the bucket with its members.
    const entries = collapseRuns([
      item("typed", { updatedAt: minutesAgo(5) }),
      agentItem("1", "r1", { updatedAt: minutesAgo(20) }),
      agentItem("2", "r1", { updatedAt: minutesAgo(25) }),
      agentItem("3", "r1", { updatedAt: minutesAgo(30) }),
    ]);

    const grouped = groupStream(entries, { now: NOW });
    const now = grouped.groups.find((g) => g.key === "now");

    expect(now?.entries).toHaveLength(2);
    expect(now?.entries.map((e) => e.item.id)).toEqual(["typed", "run:r1"]);
  });

  it("defaults the threshold to three", () => {
    expect(MIN_RUN_SIZE).toBe(3);
  });
});

describe("countTypes", () => {
  it("counts by type, commonest first", () => {
    expect(
      countTypes([
        { type: "note" },
        { type: "task" },
        { type: "note" },
        { type: "note" },
      ])
    ).toEqual([
      { type: "note", count: 3 },
      { type: "task", count: 1 },
    ]);
  });

  it("breaks ties alphabetically so the summary is stable between renders", () => {
    expect(countTypes([{ type: "task" }, { type: "note" }])).toEqual([
      { type: "note", count: 1 },
      { type: "task", count: 1 },
    ]);
  });
});

describe("formatRunSummary", () => {
  it("names one type", () => {
    expect(formatRunSummary([{ type: "note", count: 23 }])).toBe("23 notes");
  });

  it("joins two types with 'and'", () => {
    expect(
      formatRunSummary([
        { type: "note", count: 23 },
        { type: "task", count: 4 },
      ])
    ).toBe("23 notes and 4 tasks");
  });

  it("folds the tail into a count so the row stays one line", () => {
    expect(
      formatRunSummary([
        { type: "note", count: 23 },
        { type: "task", count: 4 },
        { type: "thought", count: 2 },
        { type: "reference", count: 1 },
      ])
    ).toBe("23 notes, 4 tasks and 3 more");
  });

  it("singularises", () => {
    expect(formatRunSummary([{ type: "task", count: 1 }])).toBe("1 task");
  });

  it("marks counts that are only a lower bound", () => {
    expect(
      formatRunSummary([{ type: "note", count: 30 }], { mayExtend: true })
    ).toBe("30+ notes");
  });

  it("speaks the user's words, not the schema's", () => {
    expect(nounFor("reference", 2)).toBe("links");
    expect(nounFor("journal", 2)).toBe("journal entries");
    expect(nounFor("agent_output", 1)).toBe("piece of AI work");
  });

  it("degrades gracefully for a type it does not know", () => {
    expect(formatRunSummary([{ type: "sideways", count: 2 }])).toBe("2 items");
  });

  it("says something for an empty run rather than an empty string", () => {
    expect(formatRunSummary([])).toBe("no items");
  });
});
