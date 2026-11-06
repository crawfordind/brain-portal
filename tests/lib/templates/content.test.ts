import { describe, it, expect } from "vitest";
import {
  extractHeadings,
  headingKey,
  normalizeSections,
  plainForPrompt,
  sectionsToHtml,
  structureOnly,
} from "@/lib/templates/content";

describe("extractHeadings", () => {
  it("reads HTML headings, bold labels and markdown, in order, once each", () => {
    const html = `<h2>Attendees</h2><p>a, b</p><p><strong>Metrics:</strong></p><p>x</p><h2>attendees</h2><h3>Action items</h3>`;
    expect(extractHeadings(html)).toEqual(["Attendees", "Metrics", "Action items"]);
    const md = "# Agenda\ntext\n**Decisions:**\n## Next steps ##";
    expect(extractHeadings(md)).toEqual(["Agenda", "Decisions", "Next steps"]);
  });

  it("decodes entities and ignores long bold sentences", () => {
    expect(extractHeadings("<h2>R&amp;D</h2>")).toEqual(["R&D"]);
    expect(extractHeadings(`<p><strong>${"x".repeat(80)}</strong></p>`)).toEqual([]);
  });

  it("keys headings without case or trailing colons", () => {
    expect(headingKey("Action Items:")).toBe(headingKey("action items"));
  });
});

describe("sections", () => {
  it("normalises model output and drops junk and duplicates", () => {
    const sections = normalizeSections([
      { heading: "Agenda", kind: "list", items: ["Safety", 3, ""] },
      { heading: "agenda:" },
      { heading: "", hint: "x" },
      { heading: "Actions", kind: "weird" },
      "nope",
    ]);
    expect(sections).toEqual([
      { heading: "Agenda", hint: "", kind: "list", items: ["Safety"] },
      { heading: "Actions", hint: "", kind: "text", items: [] },
    ]);
  });

  it("renders escaped HTML with TipTap task lists", () => {
    const html = sectionsToHtml([
      { heading: "<script>", hint: "What & why", kind: "text", items: [] },
      { heading: "Actions", hint: "", kind: "checklist", items: ["Follow up"] },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("<h2>&lt;script&gt;</h2><p><em>What &amp; why</em></p>");
    expect(html).toContain('<li data-type="taskItem" data-checked="false"><p>Follow up</p></li>');
  });

  it("keeps a note's structure without its words", () => {
    const out = structureOnly("<h2>Numbers</h2><p>Revenue 42k</p><h2>Risks</h2><p>secret</p>");
    expect(out).toBe("<h2>Numbers</h2><p></p><h2>Risks</h2><p></p>");
    expect(structureOnly("<p>no headings</p>")).toBe("");
  });
});

describe("plainForPrompt", () => {
  it("keeps headings and list shape and caps length", () => {
    const text = plainForPrompt(
      '<h2>Agenda</h2><ul><li><p>One</p></li></ul><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Done</p></li></ul>'
    );
    expect(text).toBe("## Agenda\n- One\n- [x] Done");
    expect(plainForPrompt("a".repeat(50), 10)).toBe(`${"a".repeat(10)}…`);
  });
});
