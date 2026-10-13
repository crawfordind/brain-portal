import { describe, it, expect } from "vitest";
import { prepareSharedHtml, sharedExcerpt, stripAnnotations } from "@/lib/sharing/render";

describe("stripAnnotations", () => {
  it("removes highlight marks and their private comments, keeping the text", () => {
    const html =
      '<p>Keep <mark data-intent="cut" data-note="I hate this" class="bp-annotation bp-annotation-cut">this part</mark> please</p>';
    const out = stripAnnotations(html);
    expect(out).toBe("<p>Keep this part please</p>");
    expect(out).not.toContain("I hate this");
  });

  it("handles marks that carry only the class", () => {
    expect(stripAnnotations('<mark class="bp-annotation bp-annotation-expand">x</mark>')).toBe("x");
  });

  it("keeps an ordinary highlight", () => {
    expect(stripAnnotations("<mark>plain</mark>")).toBe("<mark>plain</mark>");
  });
});

describe("prepareSharedHtml", () => {
  it("renders markdown notes written over MCP", () => {
    const html = prepareSharedHtml("# Plan\n\n- **ship** it");
    expect(html).toContain("<h1");
    expect(html).toContain("<strong>ship</strong>");
  });

  it("leaves editor HTML as HTML", () => {
    expect(prepareSharedHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });
});

describe("sharedExcerpt", () => {
  it("collapses whitespace and truncates", () => {
    expect(sharedExcerpt("a\n\n b", 10)).toBe("a b");
    expect(sharedExcerpt("x".repeat(200), 10)).toHaveLength(10);
  });
});
