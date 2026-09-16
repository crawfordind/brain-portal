import { describe, it, expect } from "vitest";
import { sanitizeHtml } from "@/lib/sanitize";
import { extractAnnotations } from "@/lib/annotations/extract";

describe("sanitizeHtml + semantic highlights", () => {
  const html =
    '<p>Intro <mark data-intent="expand" data-note="use 2026 figures" class="bp-annotation bp-annotation-expand" title="Expand — say more here">the pricing section</mark>.</p>';

  it("keeps the highlight, its meaning, and its note through sanitizing", () => {
    const clean = sanitizeHtml(html);

    expect(clean).toContain('data-intent="expand"');
    expect(clean).toContain("bp-annotation-expand");
    expect(clean).toContain('data-note="use 2026 figures"');
    expect(extractAnnotations(clean)).toEqual([
      { intent: "expand", text: "the pricing section", comment: "use 2026 figures" },
    ]);
  });

  it("still drops other data attributes and scripts", () => {
    const clean = sanitizeHtml(
      '<p data-tracking="x">hi</p><script>alert(1)</script><mark data-intent="cut" onclick="x()">z</mark>'
    );

    expect(clean).not.toContain("data-tracking");
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).toContain('data-intent="cut"');
  });
});
