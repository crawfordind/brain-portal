import { describe, it, expect } from "vitest";
import {
  extractAnnotations,
  hasAnnotations,
  summarizeAnnotations,
  formatAnnotationsForPrompt,
  buildAnnotationPromptSection,
} from "@/lib/annotations/extract";
import { ANNOTATION_INTENTS, getAnnotationIntent, annotationClass } from "@/lib/annotations/intents";

const mark = (intent: string, text: string, extra = "") =>
  `<mark data-intent="${intent}" class="${annotationClass(intent as never)}"${extra}>${text}</mark>`;

describe("extractAnnotations", () => {
  it("returns nothing for content without highlights", () => {
    expect(extractAnnotations("<p>Just a note.</p>")).toEqual([]);
    expect(extractAnnotations("")).toEqual([]);
    expect(extractAnnotations(null)).toEqual([]);
    expect(hasAnnotations("<p>plain</p>")).toBe(false);
  });

  it("pulls out intent and passage in document order", () => {
    const html = `<p>Intro ${mark("approve", "this part works")} and ${mark(
      "expand",
      "this part is thin"
    )}.</p>`;

    expect(extractAnnotations(html)).toEqual([
      { intent: "approve", text: "this part works" },
      { intent: "expand", text: "this part is thin" },
    ]);
    expect(hasAnnotations(html)).toBe(true);
  });

  it("reads the intent from the class when data attributes were sanitized away", () => {
    const html = `<p><mark class="bp-annotation bp-annotation-cut">drop this</mark></p>`;
    expect(extractAnnotations(html)).toEqual([{ intent: "cut", text: "drop this" }]);
  });

  it("ignores plain highlights and unknown intents", () => {
    const html = `<p><mark>just yellow</mark> <mark data-intent="sparkle">unknown</mark></p>`;
    expect(extractAnnotations(html)).toEqual([]);
  });

  it("strips nested inline markup and decodes entities in the passage", () => {
    const html = mark("edit", "the <strong>Q3 &amp; Q4</strong> numbers");
    expect(extractAnnotations(html)).toEqual([
      { intent: "edit", text: "the Q3 & Q4 numbers" },
    ]);
  });

  it("keeps a per-highlight comment when the user attached one", () => {
    const html = mark("expand", "the pricing section", ' data-note="use the 2026 figures"');
    expect(extractAnnotations(html)).toEqual([
      { intent: "expand", text: "the pricing section", comment: "use the 2026 figures" },
    ]);
  });

  it("merges adjacent marks that the editor split, but not separated ones", () => {
    const split = `<p>${mark("expand", "one half")}${mark("expand", "other half")}</p>`;
    expect(extractAnnotations(split)).toEqual([
      { intent: "expand", text: "one half other half" },
    ]);

    const separated = `<p>${mark("expand", "one")} plain ${mark("expand", "two")}</p>`;
    expect(extractAnnotations(separated)).toHaveLength(2);

    const differentIntents = `<p>${mark("expand", "one")}${mark("cut", "two")}</p>`;
    expect(extractAnnotations(differentIntents)).toHaveLength(2);
  });

  it("skips empty highlights", () => {
    expect(extractAnnotations(`<p>${mark("cut", "   ")}</p>`)).toEqual([]);
  });

  it("truncates a very long passage", () => {
    const long = "word ".repeat(400);
    const [annotation] = extractAnnotations(mark("condense", long));
    expect(annotation.text.length).toBeLessThanOrEqual(601);
    expect(annotation.text.endsWith("…")).toBe(true);
  });
});

describe("summarizeAnnotations", () => {
  it("counts per intent in palette order", () => {
    const summary = summarizeAnnotations([
      { intent: "cut", text: "a" },
      { intent: "approve", text: "b" },
      { intent: "cut", text: "c" },
    ]);
    expect(summary.map((s) => [s.intent.id, s.count])).toEqual([
      ["approve", 1],
      ["cut", 2],
    ]);
  });
});

describe("formatAnnotationsForPrompt", () => {
  it("is empty when there is nothing marked", () => {
    expect(formatAnnotationsForPrompt([])).toBe("");
    expect(buildAnnotationPromptSection("<p>nothing</p>")).toBe("");
  });

  it("explains only the intents that were actually used", () => {
    const prompt = formatAnnotationsForPrompt([{ intent: "expand", text: "the pricing section" }]);

    expect(prompt).toContain("EXPAND");
    expect(prompt).toContain(getAnnotationIntent("expand")!.directive);
    expect(prompt).toContain('"the pricing section"');
    expect(prompt).not.toContain("CONDENSE");
  });

  it("numbers the passages and includes per-highlight comments", () => {
    const prompt = formatAnnotationsForPrompt([
      { intent: "approve", text: "keep me" },
      { intent: "verify", text: "the 40% claim", comment: "source?" },
    ]);

    expect(prompt).toContain('1. [APPROVE] "keep me"');
    expect(prompt).toContain('2. [VERIFY] "the 40% claim"');
    expect(prompt).toContain("User's note on this passage: source?");
  });

  it("tells the model the markings outrank the general instructions", () => {
    const prompt = buildAnnotationPromptSection(mark("cut", "this paragraph"));
    expect(prompt.toLowerCase()).toContain("the markings win");
  });
});

describe("intent registry", () => {
  it("has a unique id, a meaning, a directive and a shortcut for every intent", () => {
    const ids = ANNOTATION_INTENTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const intent of ANNOTATION_INTENTS) {
      expect(intent.meaning.length).toBeGreaterThan(0);
      expect(intent.directive.length).toBeGreaterThan(0);
      expect(intent.shortcut).toMatch(/^Mod-Alt-\d$/);
    }
  });

  it("resolves ids case-insensitively and rejects unknown ones", () => {
    expect(getAnnotationIntent("APPROVE")?.id).toBe("approve");
    expect(getAnnotationIntent("nope")).toBeNull();
    expect(getAnnotationIntent(null)).toBeNull();
  });
});

describe("markdown export of highlights", () => {
  it("keeps the meaning of a highlight in exported markdown", async () => {
    const { htmlToMarkdown } = await import("@/lib/export/markdown-export");

    expect(
      htmlToMarkdown('<p>Rework <mark data-intent="edit">this bit</mark> please.</p>')
    ).toBe("Rework ==[edit] this bit== please.");

    expect(
      htmlToMarkdown(
        '<p><mark class="bp-annotation bp-annotation-expand" data-note="2026 figures">pricing</mark></p>'
      )
    ).toBe("==[expand: 2026 figures] pricing==");

    // A plain highlight with no meaning still exports as a highlight.
    expect(htmlToMarkdown("<p><mark>just yellow</mark></p>")).toBe("==just yellow==");
  });
});
