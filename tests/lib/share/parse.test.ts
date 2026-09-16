import { describe, it, expect } from "vitest";
import {
  parseSharedPayload,
  sharedInputFromParams,
  findUrl,
  hostOf,
} from "@/lib/share/parse";

/**
 * Each case below is a payload an actual Android app produces. The whole reason
 * this module exists is that they disagree about which field holds the link.
 */
describe("parseSharedPayload — real Android share shapes", () => {
  it("Chrome: url and title in their proper fields", () => {
    const result = parseSharedPayload({
      title: "Everything I know about SQLite",
      text: "",
      url: "https://example.com/sqlite",
    });

    expect(result.kind).toBe("link");
    expect(result.url).toBe("https://example.com/sqlite");
    expect(result.title).toBe("Everything I know about SQLite");
    expect(result.captureType).toBe("link");
    expect(result.content).toBe(
      "Everything I know about SQLite\n\nhttps://example.com/sqlite"
    );
  });

  it("Twitter-style: the link is buried in text and url is empty", () => {
    const result = parseSharedPayload({
      title: "",
      text: "This thread is excellent https://t.co/abc123",
      url: "",
    });

    expect(result.kind).toBe("link");
    expect(result.url).toBe("https://t.co/abc123");
    expect(result.title).toBe("This thread is excellent");
    // That line was promoted to the title, so it is not left in the body too.
    expect(result.body).toBe("");
    expect(result.content).toBe("This thread is excellent\n\nhttps://t.co/abc123");
  });

  it("bare URL in text: no phantom title, no duplication", () => {
    const result = parseSharedPayload({ text: "https://example.com/post" });

    expect(result.url).toBe("https://example.com/post");
    // Falls back to the host rather than inventing a title.
    expect(result.title).toBe("example.com");
    expect(result.content).toBe("example.com\n\nhttps://example.com/post");
    expect(result.content.match(/https:/g)).toHaveLength(1);
  });

  it("selected text with no link stays a thought", () => {
    const result = parseSharedPayload({
      text: "The best time to plant a tree was twenty years ago.",
    });

    expect(result.kind).toBe("text");
    expect(result.url).toBeNull();
    expect(result.captureType).toBe("thought");
    expect(result.content).toBe(
      "The best time to plant a tree was twenty years ago."
    );
    // A single line of shared text is content, not a title masquerading as one.
    expect(result.title).toBe("");
  });

  it("multi-line text uses the first line as the title but keeps the whole body", () => {
    const result = parseSharedPayload({
      text: "Reading list\n\nDesign of Everyday Things\nThinking in Systems",
    });

    expect(result.title).toBe("Reading list");
    // The promoted heading is stripped from the body rather than duplicated.
    expect(result.body).not.toContain("Reading list");
    expect(result.body).toContain("Thinking in Systems");
    expect(result.content).toContain("Reading list");
    expect(result.content).toContain("Thinking in Systems");
  });

  it("title and url both present, title duplicating the url", () => {
    const result = parseSharedPayload({
      title: "https://example.com/x",
      url: "https://example.com/x",
    });

    expect(result.title).toBe("example.com");
    expect(result.content.match(/https:/g)).toHaveLength(1);
  });

  it("an explicit url field wins over one embedded in the text", () => {
    const result = parseSharedPayload({
      text: "compare against https://other.example/old",
      url: "https://example.com/canonical",
    });

    expect(result.url).toBe("https://example.com/canonical");
  });

  it("reports an empty share instead of saving nothing", () => {
    expect(parseSharedPayload({}).isEmpty).toBe(true);
    expect(parseSharedPayload({ title: "  ", text: "", url: "" }).isEmpty).toBe(true);
  });

  it("ignores non-http schemes rather than treating them as links", () => {
    const result = parseSharedPayload({ text: "javascript:alert(1)" });
    expect(result.url).toBeNull();
    expect(result.kind).toBe("text");
  });

  it("truncates a pasted essay instead of storing it whole", () => {
    const result = parseSharedPayload({ text: "word ".repeat(10000) });
    expect(result.content.length).toBeLessThanOrEqual(20000);
  });
});

describe("findUrl", () => {
  it("trims sentence punctuation that a greedy match swallows", () => {
    expect(findUrl("see https://example.com/a.")).toBe("https://example.com/a");
    expect(findUrl("(https://example.com/b)")).toBe("https://example.com/b");
  });

  it("returns null when there is no link", () => {
    expect(findUrl("just some words")).toBeNull();
    expect(findUrl("ftp://example.com/file")).toBeNull();
  });

  it("takes the first link when there are several", () => {
    expect(findUrl("https://a.example and https://b.example")).toBe(
      "https://a.example"
    );
  });
});

describe("hostOf", () => {
  it("drops the www prefix", () => {
    expect(hostOf("https://www.example.com/path")).toBe("example.com");
  });

  it("returns an empty string for junk", () => {
    expect(hostOf("not a url")).toBe("");
  });
});

describe("sharedInputFromParams", () => {
  it("reads the manifest's parameter names", () => {
    const params = new URLSearchParams({
      title: "T",
      text: "X",
      url: "https://example.com",
    });
    expect(sharedInputFromParams(params)).toEqual({
      title: "T",
      text: "X",
      url: "https://example.com",
    });
  });

  it("accepts the shorter names a hand-written Shortcut is likely to send", () => {
    const params = new URLSearchParams({ link: "https://example.com", q: "note" });
    const input = sharedInputFromParams(params);
    expect(input.url).toBe("https://example.com");
    expect(input.text).toBe("note");
  });

  it("accepts Next.js searchParams objects, including repeated keys", () => {
    const input = sharedInputFromParams({
      url: ["https://example.com", "https://ignored.example"],
      title: undefined,
    });
    expect(input.url).toBe("https://example.com");
    expect(input.title).toBe("");
  });
});

/**
 * The share page parses once for display, then posts the pieces back to
 * /api/share, which parses them again before saving. If the second pass
 * disagreed with the first, what gets stored would not be what the user
 * approved on screen.
 */
describe("parseSharedPayload is stable across the page → API round trip", () => {
  const SHARES = [
    { title: "Everything I know about SQLite", url: "https://example.com/sqlite" },
    { text: "This thread is excellent https://t.co/abc123" },
    { text: "https://example.com/post" },
    { text: "The best time to plant a tree was twenty years ago." },
    { text: "Reading list\n\nDesign of Everyday Things\nThinking in Systems" },
    { title: "https://example.com/x", url: "https://example.com/x" },
  ];

  it.each(SHARES)("re-parsing %j yields the same content", (share) => {
    const first = parseSharedPayload(share);
    const second = parseSharedPayload({
      title: first.title,
      text: first.body,
      url: first.url,
    });

    expect(second.content).toBe(first.content);
    expect(second.url).toBe(first.url);
    expect(second.captureType).toBe(first.captureType);
  });
});
