import { describe, it, expect } from "vitest";
import { hasTemplateVariables, isoWeek, renderTemplate } from "@/lib/templates/variables";

// 2026-11-03 02:30 UTC is still Monday evening, Nov 2, in New York.
const NOW = new Date("2026-11-03T02:30:00Z");

describe("renderTemplate", () => {
  it("fills dates in the viewer's zone, not the server's", () => {
    expect(renderTemplate("{{date}}", { now: NOW, timeZone: "UTC" })).toBe("2026-11-03");
    expect(renderTemplate("{{date}}", { now: NOW, timeZone: "America/New_York" })).toBe("2026-11-02");
    expect(renderTemplate("{{weekday}}", { now: NOW, timeZone: "America/New_York" })).toBe("Monday");
    expect(renderTemplate("{{time}}", { now: NOW, timeZone: "America/New_York" })).toBe("21:30");
  });

  it("supports day offsets across month and year ends", () => {
    const ctx = { now: new Date("2026-12-30T12:00:00Z"), timeZone: "UTC" };
    expect(renderTemplate("{{date+7}}", ctx)).toBe("2027-01-06");
    expect(renderTemplate("{{date-30}}", ctx)).toBe("2026-11-30");
    expect(renderTemplate("{{ date + 1 }}", ctx)).toBe("2026-12-31");
  });

  it("writes long dates, months, years and ISO weeks", () => {
    const ctx = { now: NOW, timeZone: "UTC" };
    expect(renderTemplate("{{date_long}}", ctx)).toBe("Tuesday, November 3, 2026");
    expect(renderTemplate("{{month}} {{year}} w{{week}}", ctx)).toBe("November 2026 w45");
  });

  it("fills the project and escapes it in HTML", () => {
    const ctx = { now: NOW, projectName: "R&D <Ops>" };
    expect(renderTemplate("{{project}}", ctx)).toBe("R&D <Ops>");
    expect(renderTemplate("<h1>{{project}}</h1>", ctx, { html: true })).toBe("<h1>R&amp;D &lt;Ops&gt;</h1>");
  });

  it("leaves unknown tokens and an unknown zone alone", () => {
    expect(renderTemplate("{{attendees}} {{date}}", { now: NOW, timeZone: "Not/AZone" })).toBe(
      "{{attendees}} 2026-11-03"
    );
    expect(renderTemplate("", { now: NOW })).toBe("");
  });

  it("detects variables", () => {
    expect(hasTemplateVariables("Ops {{date}}")).toBe(true);
    expect(hasTemplateVariables("Ops {{nope}}")).toBe(false);
  });
});

describe("isoWeek", () => {
  it("matches ISO-8601 at year boundaries", () => {
    expect(isoWeek({ year: 2026, month: 1, day: 1 })).toBe(1);
    expect(isoWeek({ year: 2027, month: 1, day: 1 })).toBe(53);
    expect(isoWeek({ year: 2024, month: 12, day: 30 })).toBe(1);
  });
});
