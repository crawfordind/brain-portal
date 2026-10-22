import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HighlightedText, SearchSnippet } from "@/components/search/search-snippet";
import { HIGHLIGHT_END as E, HIGHLIGHT_START as S } from "@/lib/search/snippet";

describe("SearchSnippet", () => {
  it("renders matches as <mark> and everything else as text", () => {
    const { container } = render(<SearchSnippet snippet={`see the ${S}budget${E} <img src=x onerror=alert(1)>`} />);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.querySelector("mark")?.textContent).toBe("budget");
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe("see the budget <img src=x onerror=alert(1)>");
  });

  it("renders nothing for an empty snippet", () => {
    const { container } = render(<SearchSnippet snippet="" />);
    expect(container.innerHTML).toBe("");
  });
});

describe("HighlightedText", () => {
  it("marks the query's words in a title", () => {
    const { container } = render(<HighlightedText text="Q4 Budget review" terms={["budget"]} />);
    expect(container.querySelector("mark")?.textContent).toBe("Budget");
  });
});
