import { describe, it, expect } from "vitest";
import { detectCadence, findSeries, seriesLabel, sharedHeadings, titleStem } from "@/lib/templates/series";
import type { SeriesNote } from "@/lib/templates/series";

const ops = (id: string, title: string, day: string, body = "<h2>Attendees</h2><h2>Metrics</h2><h2>Action items</h2>"): SeriesNote => ({
  id,
  title,
  content: body,
  project_id: "p1",
  created_at: `${day} 09:00:00`,
});

describe("titleStem", () => {
  it("drops dates, weekdays and counters in any common shape", () => {
    const titles = [
      "Operations meeting 2026-10-06",
      "Operations Meeting – Oct 13",
      "Operations meeting 10/20/2026",
      "Tuesday operations meeting (27 October 2026)",
      "Operations meeting #12",
    ];
    expect(new Set(titles.map(titleStem))).toEqual(new Set(["operations meeting"]));
  });

  it("keeps a readable label", () => {
    expect(seriesLabel("Operations Meeting – Oct 13")).toBe("Operations Meeting");
    expect(seriesLabel("Week 45: Team sync")).toBe("Team sync");
    expect(seriesLabel("Ops (Nov 3)")).toBe("Ops");
  });
});

describe("detectCadence", () => {
  it("reads the median gap", () => {
    expect(detectCadence(["2026-10-06 09:00:00", "2026-10-13 09:00:00", "2026-10-20 10:00:00"])).toBe("weekly");
    expect(detectCadence(["2026-10-01", "2026-10-02", "2026-10-03"])).toBe("daily");
    expect(detectCadence(["2026-08-01", "2026-09-01", "2026-10-01"])).toBe("monthly");
    expect(detectCadence(["2026-10-01"])).toBe("irregular");
  });
});

describe("sharedHeadings", () => {
  it("keeps headings in at least half the notes, in their usual order", () => {
    const out = sharedHeadings([
      "<h2>Attendees</h2><h2>Metrics</h2><h2>Actions</h2>",
      "<h2>Attendees</h2><h2>Metrics</h2><h2>Weather</h2><h2>Actions</h2>",
      "<h2>Attendees</h2><h2>Actions</h2>",
    ]);
    expect(out).toEqual(["Attendees", "Metrics", "Actions"]);
  });
});

describe("findSeries", () => {
  const notes = [
    ops("a", "Operations meeting 2026-10-06", "2026-10-06"),
    ops("b", "Operations meeting 2026-10-13", "2026-10-13"),
    ops("c", "Operations meeting 2026-10-20", "2026-10-20"),
    ops("d", "Operations meeting 2026-10-27", "2026-10-27"),
    ops("x", "Supplier list", "2026-10-01", "<p>one-off</p>"),
    ops("y", "Idea", "2026-10-02", "<p>one-off</p>"),
  ];

  it("finds a weekly meeting series with its reasons and a dated title pattern", () => {
    const [series] = findSeries(notes);
    expect(series.key).toBe("operations meeting");
    expect(series.note_ids).toEqual(["d", "c", "b", "a"]);
    expect(series.cadence).toBe("weekly");
    expect(series.title_pattern).toBe("Operations meeting {{date}}");
    expect(series.shared_headings).toEqual(["Attendees", "Metrics", "Action items"]);
    expect(series.reasons[0]).toContain("4 notes");
    expect(series.has_template).toBe(false);
  });

  it("ignores one-offs and counts two notes only when they share structure", () => {
    expect(findSeries(notes).map((s) => s.key)).toEqual(["operations meeting"]);
    const pair = [ops("1", "Board prep Q1", "2026-01-01"), ops("2", "Board prep Q2", "2026-04-01")];
    expect(findSeries(pair)).toHaveLength(1);
    const plainPair = [ops("1", "Board prep Q1", "2026-01-01", "<p>x</p>"), ops("2", "Board prep Q2", "2026-04-01", "<p>y</p>")];
    expect(findSeries(plainPair)).toHaveLength(0);
  });

  it("keeps projects apart and ranks a series a template covers last", () => {
    const other = notes.slice(0, 3).map((n) => ({ ...n, id: `o${n.id}`, project_id: "p2" }));
    const out = findSeries([...notes, ...other], [
      { name: "Operations meeting", title_pattern: "Operations meeting {{date}}", project_id: "p1" },
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((s) => s.has_template)).toBe(true);
  });
});
