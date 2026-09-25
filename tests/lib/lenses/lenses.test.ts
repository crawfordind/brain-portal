import { describe, it, expect } from "vitest";
import { toBlocks, setTaskChecked } from "@/lib/lenses/blocks";
import { senseNote, parseQuantity, isTemporalLabel, splitLabelValue } from "@/lib/lenses/sense";
import { chooseLenses, chartFormFor, mergeSignals } from "@/lib/lenses/choose";
import { normalizeDeepRead, blocksToPromptText } from "@/lib/lenses/ai-extract";
import { contentFingerprint } from "@/lib/lenses/fingerprint";
import { emptySignals, type Lens } from "@/lib/lenses/types";

/** Fixed clock: Thursday 25 Sep 2026, local time. */
const REF = new Date(2026, 8, 25, 10, 0, 0);
const TODAY = "2026-09-25";

const lensesFor = (content: string) =>
  chooseLenses(senseNote(content, { referenceDate: REF }), { today: TODAY });
const kinds = (lenses: Lens[]) => lenses.map((l) => l.kind);

describe("parseQuantity", () => {
  it.each([
    ["120", 120, undefined],
    ["$1,200", 1200, "$"],
    ["$1.2M", 1_200_000, "$"],
    ["45%", 45, "%"],
    ["3.5k", 3500, undefined],
    ["12 hrs", 12, "hrs"],
    ["-4", -4, undefined],
    ["1,200 users (up 10%)", 1200, "users"],
  ])("reads %s", (input, value, unit) => {
    expect(parseQuantity(input)).toEqual({ value, unit });
  });

  it("treats a lowercase m without currency as a unit, not millions", () => {
    expect(parseQuantity("5m")).toEqual({ value: 5, unit: "m" });
  });

  it("rejects a sentence that merely starts with a number", () => {
    expect(parseQuantity("3 things we learned about pricing and the market this week")).toBeNull();
    expect(parseQuantity("Dana")).toBeNull();
  });
});

describe("labels", () => {
  it("recognises time labels", () => {
    for (const l of ["Jan", "March 2026", "Q3", "Q1 '26", "2025", "FY2024", "Week 3", "2026-09", "9/25", "Mon"]) {
      expect(isTemporalLabel(l), l).toBe(true);
    }
    for (const l of ["Marketing", "Dana", "Stage 1"]) expect(isTemporalLabel(l), l).toBe(false);
  });

  it("splits label/value lines but not URLs or long sentences", () => {
    expect(splitLabelValue("Revenue: $1.2M")).toEqual({ label: "Revenue", value: "$1.2M" });
    expect(splitLabelValue("Q1 — 120")).toEqual({ label: "Q1", value: "120" });
    expect(splitLabelValue("https://example.com")).toBeNull();
    expect(splitLabelValue("so the thing we kept coming back to all afternoon was: pricing")).toBeNull();
  });
});

describe("toBlocks", () => {
  it("reads TipTap HTML: headings, items, task items and tables", () => {
    const html = `<h2>Plan</h2><p>Intro</p>
      <ul data-type="taskList">
        <li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Draft</p></div></li>
        <li data-checked="false" data-type="taskItem"><label><input type="checkbox"><span></span></label><div><p>Ship</p></div></li>
      </ul>
      <table><tbody><tr><th><p>Name</p></th><th><p>Hours</p></th></tr><tr><td><p>Ana</p></td><td><p>12</p></td></tr></tbody></table>`;
    const blocks = toBlocks(html);
    expect(blocks[0]).toEqual({ type: "heading", level: 2, text: "Plan" });
    expect(blocks[1]).toMatchObject({ type: "para", text: "Intro" });
    expect(blocks[2]).toMatchObject({ type: "item", text: "Draft", checked: true, taskIndex: 0 });
    expect(blocks[3]).toMatchObject({ type: "item", text: "Ship", checked: false, taskIndex: 1 });
    expect(blocks[4]).toMatchObject({ type: "table", headers: ["Name", "Hours"], rows: [["Ana", "12"]] });
  });

  it("splits paragraphs on <br> so pasted lines stay lines", () => {
    const blocks = toBlocks("<p>Jan: 1<br>Feb: 2</p>");
    expect(blocks.map((b) => ("text" in b ? b.text : ""))).toEqual(["Jan: 1", "Feb: 2"]);
  });

  it("reads markdown: pipe tables, checkboxes and inline marks", () => {
    const md = `# Title\n\n| Item | Cost |\n|---|---|\n| Rent | $900 |\n| Food | $300 |\n\n- [x] **Pay** rent\n- [ ] Buy [food](http://x)\n1. First`;
    const blocks = toBlocks(md);
    expect(blocks[1]).toMatchObject({ type: "table", headers: ["Item", "Cost"], rows: [["Rent", "$900"], ["Food", "$300"]] });
    expect(blocks[2]).toMatchObject({ type: "item", text: "Pay rent", checked: true, taskIndex: 0 });
    expect(blocks[3]).toMatchObject({ type: "item", text: "Buy food", checked: false, taskIndex: 1 });
    expect(blocks[4]).toMatchObject({ type: "item", ordered: true, text: "First" });
  });
});

describe("setTaskChecked", () => {
  it("ticks exactly the Nth HTML task and nothing else", () => {
    const html = `<li data-checked="false" data-type="taskItem">a</li><li data-checked="false" data-type="taskItem">b</li>`;
    const out = setTaskChecked(html, 1, true);
    expect(out).toBe(`<li data-checked="false" data-type="taskItem">a</li><li data-checked="true" data-type="taskItem">b</li>`);
  });

  it("ticks markdown boxes and ignores an out-of-range index", () => {
    const md = "- [ ] a\n- [ ] b";
    expect(setTaskChecked(md, 0, true)).toBe("- [x] a\n- [ ] b");
    expect(setTaskChecked(md, 7, true)).toBe(md);
  });

  it("round-trips with sensing: the index sensed is the index written", () => {
    const html = `<ul data-type="taskList"><li data-checked="false" data-type="taskItem"><div><p>One</p></div></li><li data-checked="false" data-type="taskItem"><div><p>Two</p></div></li></ul>`;
    const two = senseNote(html, { referenceDate: REF }).checklist.find((c) => c.text === "Two")!;
    const updated = setTaskChecked(html, two.taskIndex!, true);
    expect(senseNote(updated, { referenceDate: REF }).checklist.map((c) => c.done)).toEqual([false, true]);
  });
});

describe("choosing a view", () => {
  it("draws values over time as a line, oldest first", () => {
    const lenses = lensesFor("## Signups\n- Jun: 90\n- May: 70\n- Apr: 40");
    const chart = lenses.find((l) => l.kind === "chart");
    expect(chart).toMatchObject({ kind: "chart", form: "line", title: "Signups" });
    if (chart?.kind !== "chart") throw new Error();
    expect(chart.series.labels).toEqual(["Apr", "May", "Jun"]);
    expect(chart.series.measures[0].values).toEqual([40, 70, 90]);
    expect(chart.reason).toMatch(/over time/);
  });

  it("compares categories as bars", () => {
    const [chart] = lensesFor("Budget\n\nMarketing: $4,000\nEngineering: $12,000\nOps: $2,500").filter(
      (l) => l.kind === "chart"
    );
    expect(chart).toMatchObject({ form: "bar" });
  });

  it("shows percentages that sum to 100 as shares", () => {
    const [chart] = lensesFor("- Yes: 62%\n- No: 30%\n- Unsure: 8%").filter((l) => l.kind === "chart");
    expect(chart).toMatchObject({ form: "share" });
  });

  it("keeps two stray numbers as tiles, not a chart", () => {
    const lenses = lensesFor("Budget: $40k\n\nSome prose in between.\n\nHeadcount: 12");
    expect(kinds(lenses)).toContain("metrics");
    expect(kinds(lenses)).not.toContain("chart");
  });

  it("gives a numeric table both a chart and a sortable table", () => {
    const md = "| Rep | Deals | Revenue |\n|---|---|---|\n| Ana | 12 | $40k |\n| Bo | 7 | $22k |\n| Cy | 9 | $31k |";
    const lenses = lensesFor(md);
    const chart = lenses.find((l) => l.kind === "chart");
    expect(chart?.kind === "chart" && chart.series.measures.map((m) => m.name)).toEqual(["Deals", "Revenue"]);
    expect(kinds(lenses)).toContain("table");
  });

  it("puts dated lines on a timeline and flags deadlines", () => {
    const lenses = lensesFor("Kickoff on October 1\nDesign review Oct 8 at 2pm\nBudget due by Oct 15");
    const tl = lenses.find((l) => l.kind === "timeline");
    if (tl?.kind !== "timeline") throw new Error("no timeline");
    expect(tl.items.map((i) => i.date)).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
    expect(tl.items[1].time).toBe("14:00");
    expect(tl.items[2].kind).toBe("deadline");
  });

  it("does not read a series' month labels as calendar events", () => {
    expect(kinds(lensesFor("- Jan: 10\n- Feb: 12\n- Mar: 15"))).not.toContain("timeline");
  });

  it("collects checkboxes and action-worded lines, most urgent lens first", () => {
    const lenses = lensesFor("- [ ] Send deck\n- [x] Book room\nTODO: call Dana");
    expect(lenses[0].kind).toBe("checklist");
    if (lenses[0].kind !== "checklist") throw new Error();
    expect(lenses[0].items.map((i) => [i.text, i.done, i.taskIndex])).toEqual([
      ["Send deck", false, 0],
      ["Book room", true, 1],
      ["call Dana", false, undefined],
    ]);
  });

  it("turns key: value lines into a fact card and headings into an outline", () => {
    const md = "## Who\n- Owner: Dana\n- Status: Blocked\n## Why\n- The vendor slipped";
    const lenses = lensesFor(md);
    expect(kinds(lenses)).toEqual(expect.arrayContaining(["facts", "outline"]));
  });

  it("finds nothing in plain prose, so the note stays just a note", () => {
    expect(lensesFor("<p>Just thinking out loud about the weekend and what I might cook.</p>")).toEqual([]);
  });

  it("is deterministic: same note, same lenses", () => {
    const md = "- Jan: 1\n- Feb: 2\n- Mar: 3\n- [ ] thing\nOwner: Dana\nStatus: ok";
    expect(lensesFor(md)).toEqual(lensesFor(md));
  });
});

describe("chartFormFor", () => {
  it("does not call percentages a share unless they sum to ~100", () => {
    expect(
      chartFormFor({
        labels: ["A", "B", "C"],
        temporal: false,
        ordinal: false,
        origin: "note",
        measures: [{ name: "Growth", unit: "%", values: [12, 40, 7] }],
      })
    ).toBe("bar");
  });
});

describe("deep read", () => {
  it("keeps valid items and drops malformed ones one at a time", () => {
    const { signals, summary } = normalizeDeepRead({
      summary: " Weekly sync. ",
      series: [
        { title: "Hours", labels: ["Ana", "Bo", "Cy"], measures: [{ name: "Hours", values: [5, 8, 3] }] },
        { labels: ["x"], measures: [] },
      ],
      events: [
        { date: "2026-10-02", text: "Demo", kind: "event" },
        { date: "next week", text: "bad" },
      ],
      tasks: [{ text: "Email Bo" }],
      suggestions: [{ text: "Book the room", why: "Demo needs space", dueDate: null }],
      facts: [{ key: "Owner", value: "Ana" }, { key: "", value: "x" }],
      metrics: "not an array",
    });
    expect(summary).toBe("Weekly sync.");
    expect(signals.series).toHaveLength(1);
    expect(signals.series[0].origin).toBe("ai");
    expect(signals.dated).toEqual([{ date: "2026-10-02", time: undefined, text: "Demo", kind: "event", origin: "ai" }]);
    expect(signals.checklist).toEqual([{ text: "Email Bo", done: false, origin: "ai" }]);
    expect(signals.suggestions).toEqual([{ text: "Book the room", why: "Demo needs space", dueDate: undefined }]);
    expect(signals.facts).toHaveLength(1);
    expect(signals.metrics).toEqual([]);
  });

  it("survives a non-object response", () => {
    expect(normalizeDeepRead("oops").signals).toEqual(emptySignals());
  });

  it("merges without duplicating what the note already says", () => {
    const note = senseNote("- [ ] Email Bo\n- Jan: 1\n- Feb: 2\n- Mar: 3", { referenceDate: REF });
    const ai = normalizeDeepRead({
      tasks: [{ text: "email bo" }, { text: "Call Cy" }],
      series: [{ labels: ["Jan", "Feb", "Mar"], measures: [{ name: "v", values: [1, 2, 3] }] }],
    }).signals;
    const merged = mergeSignals(note, ai);
    expect(merged.checklist.map((c) => c.text)).toEqual(["Email Bo", "Call Cy"]);
    expect(merged.series).toHaveLength(1);
  });

  it("gives the model structure, not markup", () => {
    const text = blocksToPromptText(toBlocks(`<h2>A</h2><ul data-type="taskList"><li data-checked="false"><p>Do it</p></li></ul>`));
    expect(text).toBe("## A\n- [ ] Do it");
  });
});

describe("contentFingerprint", () => {
  it("is stable and sensitive to edits", () => {
    expect(contentFingerprint("abc")).toBe(contentFingerprint("abc"));
    expect(contentFingerprint("abc")).not.toBe(contentFingerprint("abd"));
  });
});
