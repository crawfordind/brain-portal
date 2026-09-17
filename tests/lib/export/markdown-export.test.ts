import { describe, it, expect } from "vitest";
import {
  htmlToMarkdown,
  generateFrontmatter,
  convertLinksToWikilinks,
  getNotePath,
  getNoteLinkTarget,
  sanitizeFilename,
  buildNoteFile,
  buildCaptureFile,
  buildInsightFile,
  buildConnectionsSection,
} from "@/lib/export/markdown-export";
import type {
  Note,
  DailyNote,
  WeeklyReview,
  Capture,
  Insight,
  NoteConnection,
} from "@/lib/db/schema";

// --- Helpers to build test fixtures ---

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "note-1",
    user_id: "user-1",
    project_id: null,
    title: "Test Note",
    slug: "test-note",
    content: "<p>Hello world</p>",
    content_plain: "Hello world",
    note_type: "note",
    is_pinned: false,
    is_archived: false,
    word_count: 2,
    frontmatter: "{}",
    metadata: "{}",
    summary: null,
    auto_tags: "[]",
    processing_status: "completed",
    share_token: null,
    shared_at: null,
    created_at: "2025-01-15 10:00:00",
    updated_at: "2025-01-15 12:00:00",
    ...overrides,
  };
}

// --- htmlToMarkdown ---

describe("htmlToMarkdown", () => {
  it("converts basic HTML to markdown", () => {
    const result = htmlToMarkdown("<h1>Title</h1><p>Some <strong>bold</strong> text.</p>");
    expect(result).toContain("# Title");
    expect(result).toContain("**bold**");
  });

  it("converts task lists", () => {
    const html = `<ul data-type="taskList"><li data-checked="true"><p>Done item</p></li><li data-checked="false"><p>Todo item</p></li></ul>`;
    const result = htmlToMarkdown(html);
    expect(result).toContain("[x] Done item");
    expect(result).toContain("[ ] Todo item");
  });

  it("converts code blocks", () => {
    const html = `<pre><code class="language-javascript">const x = 1;</code></pre>`;
    const result = htmlToMarkdown(html);
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  it("converts figures with captions", () => {
    const html = `<figure><img src="https://example.com/img.png"><figcaption>My caption</figcaption></figure>`;
    const result = htmlToMarkdown(html);
    expect(result).toContain("![My caption](https://example.com/img.png)");
  });

  it("returns empty string for empty content", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("  ")).toBe("");
  });

  it("handles nested formatting", () => {
    const html = "<p>Text with <strong><em>bold italic</em></strong> words</p>";
    const result = htmlToMarkdown(html);
    expect(result).toContain("***bold italic***");
  });
});

// --- generateFrontmatter ---

describe("generateFrontmatter", () => {
  it("generates basic frontmatter", () => {
    const note = makeNote();
    const result = generateFrontmatter(note);
    expect(result).toMatch(/^---/);
    expect(result).toMatch(/---$/);
    expect(result).toContain('title: "Test Note"');
    expect(result).toContain("type: note");
    expect(result).toContain("created: 2025-01-15 10:00:00");
    expect(result).toContain("updated: 2025-01-15 12:00:00");
  });

  it("includes tags from options and auto_tags", () => {
    const note = makeNote({ auto_tags: '["ai", "coding"]' });
    const result = generateFrontmatter(note, { tags: ["imported"] });
    expect(result).toContain("tags:");
    expect(result).toContain('"imported"');
    expect(result).toContain('"ai"');
    expect(result).toContain('"coding"');
  });

  it("includes tags from frontmatter JSON", () => {
    const note = makeNote({ frontmatter: '{"tags": ["obsidian"]}' });
    const result = generateFrontmatter(note);
    expect(result).toContain('"obsidian"');
  });

  it("deduplicates tags", () => {
    const note = makeNote({
      auto_tags: '["shared"]',
      frontmatter: '{"tags": ["shared", "unique"]}',
    });
    const result = generateFrontmatter(note, { tags: ["shared"] });
    // "shared" should appear only once
    const matches = result.match(/"shared"/g);
    expect(matches).toHaveLength(1);
  });

  it("includes project name", () => {
    const result = generateFrontmatter(makeNote(), { projectName: "My Project" });
    expect(result).toContain('project: "My Project"');
  });

  it("includes daily note metadata", () => {
    const dailyNote: DailyNote = {
      id: "dn-1",
      note_id: "note-1",
      user_id: "user-1",
      date: "2025-01-15",
      morning_focus: "Build features",
      reflection: "{}",
      mood: 4,
      energy: 3,
      metadata: null,
      created_at: "2025-01-15",
      updated_at: "2025-01-15",
    };
    const result = generateFrontmatter(makeNote({ note_type: "daily" }), { dailyNote });
    expect(result).toContain("date: 2025-01-15");
    expect(result).toContain("mood: 4");
    expect(result).toContain("energy: 3");
    expect(result).toContain('morning_focus: "Build features"');
  });

  it("includes weekly review metadata", () => {
    const weeklyReview: WeeklyReview = {
      id: "wr-1",
      note_id: "note-1",
      user_id: "user-1",
      year: 2025,
      week_number: 3,
      start_date: "2025-01-13",
      end_date: "2025-01-19",
      summary: null,
      stats: "{}",
      created_at: "2025-01-19",
      updated_at: "2025-01-19",
    };
    const result = generateFrontmatter(makeNote({ note_type: "weekly" }), { weeklyReview });
    expect(result).toContain("year: 2025");
    expect(result).toContain("week: 3");
    expect(result).toContain("start_date: 2025-01-13");
    expect(result).toContain("end_date: 2025-01-19");
  });

  it("includes pinned and archived flags", () => {
    const note = makeNote({ is_pinned: true, is_archived: true });
    const result = generateFrontmatter(note);
    expect(result).toContain("pinned: true");
    expect(result).toContain("archived: true");
  });

  it("escapes quotes in title", () => {
    const note = makeNote({ title: 'Note with "quotes"' });
    const result = generateFrontmatter(note);
    expect(result).toContain('title: "Note with \\"quotes\\""');
  });
});

// --- convertLinksToWikilinks ---

describe("convertLinksToWikilinks", () => {
  const slugToTitle = new Map([
    ["my-note", "My Note"],
    ["another-note", "Another Note"],
  ]);

  it("converts internal links to wikilinks", () => {
    const md = "See [My Note](/notes/my-note) for details.";
    const result = convertLinksToWikilinks(md, slugToTitle);
    expect(result).toBe("See [[My Note]] for details.");
  });

  it("uses aliased wikilink when text differs from title", () => {
    const md = "See [this page](/notes/my-note) for info.";
    const result = convertLinksToWikilinks(md, slugToTitle);
    expect(result).toBe("See [[My Note|this page]] for info.");
  });

  it("preserves external links", () => {
    const md = "Visit [Google](https://google.com) for search.";
    const result = convertLinksToWikilinks(md, slugToTitle);
    expect(result).toBe("Visit [Google](https://google.com) for search.");
  });

  it("handles missing slugs gracefully", () => {
    const md = "See [Unknown](/notes/deleted-note) here.";
    const result = convertLinksToWikilinks(md, slugToTitle);
    expect(result).toBe("See [[Unknown]] here.");
  });

  it("handles multiple links in one line", () => {
    const md = "Link [My Note](/notes/my-note) and [Another Note](/notes/another-note).";
    const result = convertLinksToWikilinks(md, slugToTitle);
    expect(result).toBe("Link [[My Note]] and [[Another Note]].");
  });
});

// --- getNotePath ---

describe("getNotePath", () => {
  it("returns daily path for daily notes", () => {
    const note = makeNote({ note_type: "daily" });
    const result = getNotePath(note, { dailyNoteDate: "2025-01-15" });
    expect(result).toBe("daily/2025-01-15.md");
  });

  it("returns weekly path for weekly reviews", () => {
    const note = makeNote({ note_type: "weekly" });
    const weeklyReview = {
      id: "wr-1",
      note_id: "note-1",
      user_id: "user-1",
      year: 2025,
      week_number: 3,
      start_date: "2025-01-13",
      end_date: "2025-01-19",
      summary: null,
      stats: "{}",
      created_at: "2025-01-19",
      updated_at: "2025-01-19",
    };
    const result = getNotePath(note, { weeklyReview });
    expect(result).toBe("weekly/2025-W03.md");
  });

  it("returns project path when project is set", () => {
    const note = makeNote({ title: "My Feature" });
    const result = getNotePath(note, { projectName: "Cool Project" });
    expect(result).toBe("projects/Cool Project/My Feature.md");
  });

  it("returns uncategorized path by default", () => {
    const note = makeNote({ title: "Random Thought" });
    const result = getNotePath(note);
    expect(result).toBe("uncategorized/Random Thought.md");
  });

  it("zero-pads single-digit week numbers", () => {
    const note = makeNote({ note_type: "weekly" });
    const weeklyReview = {
      id: "wr-1",
      note_id: "note-1",
      user_id: "user-1",
      year: 2025,
      week_number: 1,
      start_date: "2025-01-01",
      end_date: "2025-01-07",
      summary: null,
      stats: "{}",
      created_at: "2025-01-07",
      updated_at: "2025-01-07",
    };
    const result = getNotePath(note, { weeklyReview });
    expect(result).toBe("weekly/2025-W01.md");
  });
});

// --- getNoteLinkTarget ---

describe("getNoteLinkTarget", () => {
  it("uses the date basename for daily notes (not the display title)", () => {
    const note = makeNote({
      note_type: "daily",
      title: "Sunday, January 4, 2026",
    });
    expect(getNoteLinkTarget(note, { dailyNoteDate: "2026-01-04" })).toBe(
      "2026-01-04"
    );
  });

  it("uses the year-week basename for weekly reviews", () => {
    const note = makeNote({ note_type: "weekly" });
    const weeklyReview = {
      id: "wr-1",
      note_id: "note-1",
      user_id: "user-1",
      year: 2026,
      week_number: 2,
      start_date: "2026-01-05",
      end_date: "2026-01-11",
      summary: null,
      stats: "{}",
      created_at: "2026-01-11",
      updated_at: "2026-01-11",
    };
    expect(getNoteLinkTarget(note, { weeklyReview })).toBe("2026-W02");
  });

  it("uses the sanitized title basename for regular notes", () => {
    const note = makeNote({ title: "Brain Portal Brainstorm " });
    expect(getNoteLinkTarget(note)).toBe("Brain Portal Brainstorm");
  });
});

// --- insight & connection wikilinks resolve to file targets ---

describe("wikilink target resolution", () => {
  function makeInsight(overrides: Partial<Insight> = {}): Insight {
    return {
      id: "ins-1",
      user_id: "user-1",
      note_id: null,
      insight_type: "connection",
      title: "Test Insight",
      content: "Some content",
      source_notes: '["daily-1"]',
      source_captures: "[]",
      confidence: 0.8,
      is_dismissed: false,
      is_actioned: false,
      generated_at: "2026-01-05",
      actioned_at: null,
      feedback: null,
      metadata: "{}",
      // Spreading a Partial<Insight> reintroduces `undefined` on every optional
      // key, so assert the assembled shape rather than annotating the literal.
      ...overrides,
    } as Insight;
  }

  it("links insight source daily notes by date, aliased to the prose title", () => {
    const titles = new Map([["daily-1", "Sunday, January 4, 2026"]]);
    const targets = new Map([["daily-1", "2026-01-04"]]);
    const result = buildInsightFile(makeInsight(), titles, "obsidian", targets);
    expect(result).toContain("[[2026-01-04|Sunday, January 4, 2026]]");
    // The old broken form (prose title as the link target) must be gone.
    expect(result).not.toContain("[[Sunday, January 4, 2026]]");
  });

  it("falls back to a plain title wikilink when no target map is given", () => {
    const titles = new Map([["daily-1", "My Note"]]);
    const result = buildInsightFile(makeInsight(), titles, "obsidian");
    expect(result).toContain("[[My Note]]");
  });

  it("resolves connection links by file target", () => {
    const conn: NoteConnection = {
      id: "c-1",
      user_id: "user-1",
      source_note_id: "note-1",
      target_note_id: "daily-1",
      connection_type: "related",
      strength: 0.9,
      reason: null,
      is_manual: false,
      embedding_similarity: 0.8,
      discovery_method: "embedding",
      created_at: "2026-01-05",
    };
    const titles = new Map([
      ["note-1", "Note One"],
      ["daily-1", "Monday, January 5, 2026"],
    ]);
    const targets = new Map([
      ["note-1", "Note One"],
      ["daily-1", "2026-01-05"],
    ]);
    const result = buildConnectionsSection(
      "note-1",
      [conn],
      titles,
      "obsidian",
      targets
    );
    expect(result).toContain("[[2026-01-05|Monday, January 5, 2026]]");
  });
});

// --- sanitizeFilename ---

describe("sanitizeFilename", () => {
  it("removes invalid characters", () => {
    expect(sanitizeFilename('file<>:"/\\|?*name')).toBe("filename");
  });

  it("collapses multiple spaces", () => {
    expect(sanitizeFilename("hello   world")).toBe("hello world");
  });

  it("truncates long names", () => {
    const longName = "a".repeat(300);
    const result = sanitizeFilename(longName);
    expect(result.length).toBeLessThanOrEqual(200);
  });

  it("returns 'untitled' for empty input", () => {
    expect(sanitizeFilename("")).toBe("untitled");
  });

  it("returns 'untitled' for input that becomes empty after sanitization", () => {
    expect(sanitizeFilename("***")).toBe("untitled");
  });

  it("trims leading/trailing dots", () => {
    expect(sanitizeFilename("..hidden..")).toBe("hidden");
  });
});

// --- buildNoteFile ---

describe("buildNoteFile", () => {
  it("combines frontmatter and converted content", () => {
    const note = makeNote({ content: "<p>Hello <strong>world</strong></p>" });
    const slugToTitle = new Map<string, string>();
    const result = buildNoteFile(note, slugToTitle);
    expect(result).toMatch(/^---/);
    expect(result).toContain("Hello **world**");
  });

  it("resolves internal links to wikilinks", () => {
    const note = makeNote({
      content: '<p>See <a href="/notes/other">Other Note</a></p>',
    });
    const slugToTitle = new Map([["other", "Other Note"]]);
    const result = buildNoteFile(note, slugToTitle);
    expect(result).toContain("[[Other Note]]");
  });
});

// --- buildCaptureFile ---

describe("buildCaptureFile", () => {
  it("generates a capture markdown file", () => {
    const capture: Capture = {
      id: "cap-1",
      user_id: "user-1",
      daily_note_id: null,
      content: "Quick thought about something",
      capture_type: "thought",
      captured_at: "2025-01-15 08:30:00",
      processed: false,
      linked_notes: "[]",
      linked_projects: "[]",
      tags: '["idea"]',
      metadata: "{}",
      created_at: "2025-01-15 08:30:00",
    };
    const result = buildCaptureFile(capture);
    expect(result).toContain("type: capture");
    expect(result).toContain("capture_type: thought");
    expect(result).toContain('"idea"');
    expect(result).toContain("Quick thought about something");
  });
});
