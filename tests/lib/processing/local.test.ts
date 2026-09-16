import { describe, it, expect } from "vitest";
import {
  extractLinks,
  extractWikilinks,
  analyzeStructure,
  stripMarkdown,
  countWords,
  extractExcerpt,
  detectPotentialTags,
  processLocally,
} from "@/lib/processing/local";

describe("extractLinks", () => {
  it("extracts wikilinks", () => {
    const content = "Check out [[My Page]] for more info.";
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      type: "wikilink",
      target: "My Page",
      text: "My Page",
    });
  });

  it("extracts wikilinks with display text", () => {
    const content = "See [[Internal Page|this page]] for details.";
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      type: "wikilink",
      target: "Internal Page",
      text: "this page",
    });
  });

  it("extracts markdown links", () => {
    const content = "Visit [Google](https://google.com) today.";
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      type: "external",
      target: "https://google.com",
      text: "Google",
    });
  });

  it("extracts internal markdown links", () => {
    const content = "Check [the docs](/docs/intro) for info.";
    const links = extractLinks(content);

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      type: "internal",
      target: "/docs/intro",
      text: "the docs",
    });
  });

  it("extracts multiple link types", () => {
    const content = `
      Check [[Wiki Page]] and [external](https://example.com) and [local](/page).
    `;
    const links = extractLinks(content);

    expect(links).toHaveLength(3);
    expect(links.map((l) => l.type)).toContain("wikilink");
    expect(links.map((l) => l.type)).toContain("external");
    expect(links.map((l) => l.type)).toContain("internal");
  });

  it("returns empty array for content without links", () => {
    const content = "This is just plain text without any links.";
    const links = extractLinks(content);

    expect(links).toHaveLength(0);
  });

  it("includes position information", () => {
    const content = "Start [[Link]] end";
    const links = extractLinks(content);

    expect(links[0].position.start).toBe(6);
    expect(links[0].position.end).toBe(14);
  });
});

describe("extractWikilinks", () => {
  it("returns only wikilink targets", () => {
    const content = "[[Page A]] and [markdown](https://x.com) and [[Page B]]";
    const wikilinks = extractWikilinks(content);

    expect(wikilinks).toHaveLength(2);
    expect(wikilinks).toContain("Page A");
    expect(wikilinks).toContain("Page B");
  });

  it("returns empty array when no wikilinks", () => {
    const content = "Only [regular](https://link.com) here.";
    const wikilinks = extractWikilinks(content);

    expect(wikilinks).toHaveLength(0);
  });
});

describe("analyzeStructure", () => {
  it("extracts headings with levels", () => {
    const content = `# Heading 1
Some text
## Heading 2
More text
### Heading 3`;
    const structure = analyzeStructure(content);

    expect(structure.headings).toHaveLength(3);
    expect(structure.headings[0]).toMatchObject({ level: 1, text: "Heading 1" });
    expect(structure.headings[1]).toMatchObject({ level: 2, text: "Heading 2" });
    expect(structure.headings[2]).toMatchObject({ level: 3, text: "Heading 3" });
  });

  it("extracts code blocks", () => {
    const content = `Some text
\`\`\`javascript
const x = 1;
\`\`\`
More text
\`\`\`python
print("hello")
\`\`\``;
    const structure = analyzeStructure(content);

    expect(structure.codeBlocks).toHaveLength(2);
    expect(structure.codeBlocks[0].language).toBe("javascript");
    expect(structure.codeBlocks[1].language).toBe("python");
  });

  it("extracts task items", () => {
    const content = `- [x] Completed task
- [ ] Incomplete task
- [X] Another done`;
    const structure = analyzeStructure(content);

    expect(structure.taskItems).toHaveLength(3);
    expect(structure.taskItems[0]).toMatchObject({ checked: true, text: "Completed task" });
    expect(structure.taskItems[1]).toMatchObject({ checked: false, text: "Incomplete task" });
    expect(structure.taskItems[2]).toMatchObject({ checked: true, text: "Another done" });
  });

  it("calculates word count", () => {
    const content = "This is a simple test with exactly nine words total.";
    const structure = analyzeStructure(content);

    expect(structure.wordCount).toBe(10);
  });

  it("calculates paragraph count", () => {
    const content = `First paragraph here.

Second paragraph here.

Third paragraph here.`;
    const structure = analyzeStructure(content);

    expect(structure.paragraphCount).toBe(3);
  });

  it("estimates read time", () => {
    // 200 words per minute
    const words = Array(400).fill("word").join(" ");
    const structure = analyzeStructure(words);

    expect(structure.estimatedReadTime).toBe(2);
  });

  it("detects images", () => {
    const withImage = "![alt text](image.png)";
    const withoutImage = "Just text here";

    expect(analyzeStructure(withImage).hasImages).toBe(true);
    expect(analyzeStructure(withoutImage).hasImages).toBe(false);
  });

  it("detects tables", () => {
    const withTable = `| Header | Header |
|--------|--------|
| Cell   | Cell   |`;
    const withoutTable = "Just text | not a table";

    expect(analyzeStructure(withTable).hasTables).toBe(true);
    expect(analyzeStructure(withoutTable).hasTables).toBe(false);
  });
});

describe("stripMarkdown", () => {
  it("removes headers", () => {
    const result = stripMarkdown("# Title\nContent here");
    expect(result).toBe("Title Content here");
  });

  it("removes code blocks", () => {
    const result = stripMarkdown("Text\n```js\ncode\n```\nMore text");
    expect(result).toBe("Text More text");
  });

  it("removes inline code", () => {
    const result = stripMarkdown("Use the `command` here");
    expect(result).toBe("Use the here");
  });

  it("removes links but keeps text", () => {
    const result = stripMarkdown("[link text](https://example.com)");
    expect(result).toBe("link text");
  });

  it("removes wikilinks but keeps text", () => {
    const result = stripMarkdown("See [[Page Name]] for more");
    expect(result).toBe("See Page Name for more");
  });

  it("removes wikilinks with display text", () => {
    const result = stripMarkdown("See [[Page|Display]] for more");
    expect(result).toBe("See DisplayPage for more");
  });

  it("removes emphasis", () => {
    const result = stripMarkdown("This is **bold** and *italic*");
    expect(result).toBe("This is bold and italic");
  });

  it("removes images", () => {
    const result = stripMarkdown("Text ![image](img.png) more");
    expect(result).toBe("Text more");
  });

  it("removes blockquotes", () => {
    const result = stripMarkdown("> This is a quote\nNormal text");
    expect(result).toBe("This is a quote Normal text");
  });

  it("removes list markers", () => {
    const result = stripMarkdown("- Item 1\n- Item 2");
    expect(result).toBe("Item 1 Item 2");
  });
});

describe("countWords", () => {
  it("counts words in plain text", () => {
    expect(countWords("One two three four five")).toBe(5);
  });

  it("counts words after stripping markdown", () => {
    expect(countWords("# Heading\n**Bold** and *italic* text")).toBe(5);
  });

  it("returns 0 for empty content", () => {
    expect(countWords("")).toBe(0);
  });

  it("handles whitespace correctly", () => {
    expect(countWords("  word   another   word  ")).toBe(3);
  });
});

describe("extractExcerpt", () => {
  it("extracts first paragraph", () => {
    const content = `# Title

This is the first paragraph with content.

This is the second paragraph.`;
    const excerpt = extractExcerpt(content);

    expect(excerpt).toBe("This is the first paragraph with content.");
  });

  it("truncates long paragraphs", () => {
    const longText = "This is a very long paragraph ".repeat(10);
    const excerpt = extractExcerpt(longText, 50);

    expect(excerpt.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(excerpt).toContain("...");
  });

  it("skips code blocks", () => {
    const content = `# Title

\`\`\`js
code here
\`\`\`

Actual content paragraph.`;
    const excerpt = extractExcerpt(content);

    expect(excerpt).toBe("Actual content paragraph.");
  });

  it("returns empty for content without paragraphs", () => {
    const content = "# Just a heading\n\n```\ncode only\n```";
    const excerpt = extractExcerpt(content);

    expect(excerpt).toBe("");
  });
});

describe("detectPotentialTags", () => {
  it("extracts hashtags", () => {
    const content = "This is about #javascript and #typescript";
    const tags = detectPotentialTags(content);

    expect(tags).toContain("javascript");
    expect(tags).toContain("typescript");
  });

  it("converts tags to lowercase", () => {
    const content = "#JavaScript #TypeScript";
    const tags = detectPotentialTags(content);

    expect(tags).toContain("javascript");
    expect(tags).toContain("typescript");
  });

  it("extracts frontmatter tags", () => {
    const content = `---
title: Test
tags: [react, nextjs, testing]
---

Content here`;
    const tags = detectPotentialTags(content);

    expect(tags).toContain("react");
    expect(tags).toContain("nextjs");
    expect(tags).toContain("testing");
  });

  it("deduplicates tags", () => {
    const content = "#react and #React";
    const tags = detectPotentialTags(content);

    expect(tags.filter((t) => t === "react")).toHaveLength(1);
  });

  it("returns empty array when no tags", () => {
    const content = "Plain content without any tags.";
    const tags = detectPotentialTags(content);

    expect(tags).toHaveLength(0);
  });
});

describe("processLocally", () => {
  it("returns complete processing result", () => {
    const content = `# My Note

This is about [[Related Page]] and #programming.

- [x] Task done
- [ ] Task pending

Check [docs](https://docs.com) for more.`;

    const result = processLocally(content);

    expect(result.links).toHaveLength(2); // wikilink + markdown link
    expect(result.wikilinks).toContain("Related Page");
    expect(result.structure.headings).toHaveLength(1);
    expect(result.structure.taskItems).toHaveLength(2);
    expect(result.potentialTags).toContain("programming");
    expect(result.excerpt).toBeTruthy();
    expect(result.contentPlain).toBeTruthy();
  });

  it("handles empty content", () => {
    const result = processLocally("");

    expect(result.links).toHaveLength(0);
    expect(result.wikilinks).toHaveLength(0);
    expect(result.structure.wordCount).toBe(0);
    expect(result.potentialTags).toHaveLength(0);
  });

  it("includes content plain text", () => {
    const content = "**Bold** and [link](url)";
    const result = processLocally(content);

    expect(result.contentPlain).toBe("Bold and link");
  });
});
