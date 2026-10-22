import { describe, it, expect } from "vitest";
import {
  HIGHLIGHT_END as E,
  HIGHLIGHT_START as S,
  buildSnippet,
  cleanFtsSnippet,
  hasHighlight,
  highlightTerms,
  parseSnippet,
  queryTerms,
  stripHighlights,
  toSearchText,
} from "@/lib/search/snippet";

describe("toSearchText", () => {
  it("turns TipTap HTML into readable text", () => {
    const html = "<h2>Launch plan</h2><p>Ship the <strong>beta</strong> on Friday.</p><ul><li><p>Email list</p></li></ul>";
    expect(toSearchText(html)).toBe("Launch plan Ship the beta on Friday. Email list");
  });

  it("decodes entities left behind by tag stripping", () => {
    expect(toSearchText("Fish &amp; chips&nbsp;&lt;3 &#8220;yes&#8221; &#x2014; ok")).toBe(
      "Fish & chips <3 “yes” — ok"
    );
  });

  it("removes markdown syntax but keeps the words", () => {
    const md = "# Title\n\n- [ ] **Call** the [supplier](https://example.com)\n> quoted `code`\n==[expand] more here==";
    expect(toSearchText(md)).toBe("Title Call the supplier quoted code more here");
  });

  it("drops scripts and styles entirely", () => {
    expect(toSearchText('<p>hi</p><script>alert(1)</script><style>p{}</style>')).toBe("hi");
  });

  it("drops a tag cut off at the end of a window", () => {
    expect(toSearchText('Some text <span class="bp-annot')).toBe("Some text");
  });

  it("keeps highlight markers", () => {
    expect(toSearchText(`<p>a ${S}plan${E} &amp; b</p>`)).toBe(`a ${S}plan${E} & b`);
  });

  it("never lets an entity forge a marker", () => {
    expect(hasHighlight(toSearchText("&#2;x&#3;"))).toBe(false);
  });

  it("handles null and empty input", () => {
    expect(toSearchText(null)).toBe("");
    expect(toSearchText("")).toBe("");
  });
});

describe("queryTerms", () => {
  it("splits words, drops operators and quotes, longest first", () => {
    expect(queryTerms('"plan" AND plans OR q2')).toEqual(["plans", "plan", "q2"]);
  });

  it("dedupes case-insensitively", () => {
    expect(queryTerms("Plan plan")).toEqual(["Plan"]);
  });
});

describe("buildSnippet", () => {
  it("centres on the first match and marks every occurrence", () => {
    const text = `${"filler ".repeat(40)}the budget is final and the budget is approved ${"tail ".repeat(40)}`;
    const snippet = buildSnippet(text, ["budget"], 80);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain(`${S}budget${E}`);
    expect(stripHighlights(snippet).length).toBeLessThanOrEqual(82);
  });

  it("returns the opening when nothing matches", () => {
    expect(buildSnippet("Short note", ["zzz"])).toBe("Short note");
  });

  it("is case-insensitive and keeps the original casing", () => {
    expect(buildSnippet("Budget review", ["budget"])).toBe(`${S}Budget${E} review`);
  });

  it("treats regex characters in the query literally", () => {
    expect(buildSnippet("cost (est.) is 5", ["(est.)"])).toBe(`cost ${S}(est.)${E} is 5`);
  });
});

describe("cleanFtsSnippet", () => {
  it("cleans entities and markdown inside an FTS snippet", () => {
    expect(cleanFtsSnippet(`…**${S}Plan${E}** &amp; more…`)).toBe(`…${S}Plan${E} & more…`);
  });

  it("repairs an unclosed marker", () => {
    expect(parseSnippet(cleanFtsSnippet(`a ${S}b`))).toEqual([
      { text: "a ", highlight: false },
      { text: "b", highlight: true },
    ]);
  });
});

describe("parseSnippet", () => {
  it("splits into plain and highlighted segments", () => {
    expect(parseSnippet(`a ${S}b${E} c`)).toEqual([
      { text: "a ", highlight: false },
      { text: "b", highlight: true },
      { text: " c", highlight: false },
    ]);
  });

  it("treats HTML in a note as text", () => {
    expect(parseSnippet('<img src=x onerror="alert(1)">')).toEqual([
      { text: '<img src=x onerror="alert(1)">', highlight: false },
    ]);
  });

  it("returns nothing for an empty snippet", () => {
    expect(parseSnippet("")).toEqual([]);
    expect(parseSnippet(undefined)).toEqual([]);
  });
});

describe("highlightTerms", () => {
  it("marks every term in a title", () => {
    expect(highlightTerms("Q2 plan and plans", queryTerms("plan"))).toBe(
      `Q2 ${S}plan${E} and ${S}plan${E}s`
    );
  });
});
