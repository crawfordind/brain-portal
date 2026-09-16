import TurndownService from "turndown";
import type {
  Note,
  Capture,
  DailyNote,
  WeeklyReview,
  Project,
  Task,
  JournalEntry,
  Reminder,
  Insight,
  NoteConnection,
} from "@/lib/db/schema";

// --- Turndown instance with TipTap-specific rules ---

function createTurndownService(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });

  // Task lists: <ul data-type="taskList"> → - [x] / - [ ]
  td.addRule("taskList", {
    filter(node) {
      return (
        node.nodeName === "LI" &&
        node.parentElement?.getAttribute("data-type") === "taskList"
      );
    },
    replacement(content, node) {
      const el = node as HTMLElement;
      const checked = el.getAttribute("data-checked") === "true";
      const checkbox = checked ? "[x]" : "[ ]";
      const trimmed = content.replace(/^\n+/, "").replace(/\n+$/, "");
      return `- ${checkbox} ${trimmed}\n`;
    },
  });

  // Wrap taskList <ul> so it doesn't get double-bullet treatment
  td.addRule("taskListWrapper", {
    filter(node) {
      return (
        node.nodeName === "UL" &&
        (node as HTMLElement).getAttribute("data-type") === "taskList"
      );
    },
    replacement(_content, node) {
      // Process children directly — replacement is already handled by taskList rule
      const items: string[] = [];
      node.childNodes.forEach((child) => {
        if (child.nodeName === "LI") {
          const el = child as HTMLElement;
          const checked = el.getAttribute("data-checked") === "true";
          const checkbox = checked ? "[x]" : "[ ]";
          const text = td.turndown(el.innerHTML).replace(/^\n+/, "").replace(/\n+$/, "");
          items.push(`- ${checkbox} ${text}`);
        }
      });
      return "\n" + items.join("\n") + "\n";
    },
  });

  // Figures: <figure><img src="..."><figcaption>text</figcaption></figure> → ![text](url)
  td.addRule("figure", {
    filter: "figure",
    replacement(_content, node) {
      const el = node as HTMLElement;
      const img = el.querySelector("img");
      const figcaption = el.querySelector("figcaption");
      if (!img) return "";
      const src = img.getAttribute("src") || "";
      const alt = figcaption?.textContent || img.getAttribute("alt") || "";
      return `\n![${alt}](${src})\n`;
    },
  });

  // Semantic highlights: <mark data-intent="expand">text</mark> → ==[expand] text==
  // The colour is the instruction, so an export that keeps only the text throws
  // away what the user actually said. Markdown has no colour, so the intent is
  // written out as a label inside the highlight where it stays readable.
  td.addRule("annotation", {
    filter: "mark",
    replacement(content, node) {
      const el = node as HTMLElement;
      const text = content.trim();
      if (!text) return "";

      const intent =
        el.getAttribute("data-intent") ||
        el.getAttribute("class")?.match(/\bbp-annotation-([a-z-]+)/)?.[1] ||
        "";
      if (!intent) return `==${text}==`;

      const comment = el.getAttribute("data-note")?.trim();
      const label = comment ? `${intent}: ${comment}` : intent;
      return `==[${label}] ${text}==`;
    },
  });

  return td;
}

const turndownService = createTurndownService();

// --- Public API ---

/**
 * Convert TipTap HTML to markdown
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") return "";
  return turndownService.turndown(html);
}

/**
 * Generate YAML frontmatter compatible with Obsidian
 */
export function generateFrontmatter(
  note: Note,
  options?: {
    tags?: string[];
    projectName?: string;
    dailyNote?: DailyNote;
    weeklyReview?: WeeklyReview;
  }
): string {
  const lines: string[] = ["---"];

  lines.push(`title: "${escapeFrontmatterValue(note.title)}"`);

  // Tags
  const tags: string[] = [];
  if (options?.tags && options.tags.length > 0) {
    tags.push(...options.tags);
  }
  // Try to extract tags from note's auto_tags or frontmatter
  try {
    const autoTags = JSON.parse(note.auto_tags || "[]");
    if (Array.isArray(autoTags)) {
      tags.push(...autoTags.filter((t: string) => !tags.includes(t)));
    }
  } catch {
    // ignore parse errors
  }
  try {
    const fm = JSON.parse(note.frontmatter || "{}");
    if (Array.isArray(fm.tags)) {
      tags.push(...fm.tags.filter((t: string) => !tags.includes(t)));
    }
  } catch {
    // ignore parse errors
  }
  if (tags.length > 0) {
    lines.push(`tags: [${tags.map((t) => `"${escapeFrontmatterValue(t)}"`).join(", ")}]`);
  }

  // Type
  lines.push(`type: ${note.note_type}`);

  // Project
  if (options?.projectName) {
    lines.push(`project: "${escapeFrontmatterValue(options.projectName)}"`);
  }

  // Daily note metadata
  if (options?.dailyNote) {
    lines.push(`date: ${options.dailyNote.date}`);
    if (options.dailyNote.mood) lines.push(`mood: ${options.dailyNote.mood}`);
    if (options.dailyNote.energy) lines.push(`energy: ${options.dailyNote.energy}`);
    if (options.dailyNote.morning_focus) {
      lines.push(`morning_focus: "${escapeFrontmatterValue(options.dailyNote.morning_focus)}"`);
    }
  }

  // Weekly review metadata
  if (options?.weeklyReview) {
    lines.push(`year: ${options.weeklyReview.year}`);
    lines.push(`week: ${options.weeklyReview.week_number}`);
    lines.push(`start_date: ${options.weeklyReview.start_date}`);
    lines.push(`end_date: ${options.weeklyReview.end_date}`);
  }

  // Timestamps
  lines.push(`created: ${note.created_at}`);
  lines.push(`updated: ${note.updated_at}`);

  // Pinned/Archived flags
  if (note.is_pinned) lines.push(`pinned: true`);
  if (note.is_archived) lines.push(`archived: true`);

  lines.push("---");
  return lines.join("\n");
}

/**
 * Convert internal links (/notes/slug) to Obsidian [[wikilinks]]
 */
export function convertLinksToWikilinks(
  markdown: string,
  slugToTitleMap: Map<string, string>
): string {
  // Match markdown links pointing to internal note paths: [text](/notes/slug)
  return markdown.replace(
    /\[([^\]]+)\]\(\/notes\/([^)]+)\)/g,
    (_match, text, slug) => {
      const title = slugToTitleMap.get(slug);
      if (title) {
        // If link text matches title, use simple wikilink
        if (text === title) return `[[${title}]]`;
        // Otherwise use aliased wikilink
        return `[[${title}|${text}]]`;
      }
      // If slug not found, keep as-is but use wikilink syntax with the text
      return `[[${text}]]`;
    }
  );
}

/**
 * Determine the file path for a note within the vault
 */
export function getNotePath(
  note: Note,
  options?: {
    projectName?: string;
    dailyNoteDate?: string;
    weeklyReview?: WeeklyReview;
  }
): string {
  const filename = sanitizeFilename(note.title) + ".md";

  if (note.note_type === "daily" && options?.dailyNoteDate) {
    return `daily/${options.dailyNoteDate}.md`;
  }

  if (note.note_type === "weekly" && options?.weeklyReview) {
    const weekStr = String(options.weeklyReview.week_number).padStart(2, "0");
    return `weekly/${options.weeklyReview.year}-W${weekStr}.md`;
  }

  if (options?.projectName) {
    return `projects/${sanitizeFilename(options.projectName)}/${filename}`;
  }

  return `uncategorized/${filename}`;
}

/**
 * Determine the canonical wikilink target for a note.
 *
 * Obsidian `[[wikilinks]]` resolve against a file's basename, NOT its display
 * title. A daily note titled "Sunday, January 4, 2026" lives at
 * `daily/2026-01-04.md`, so linking it by title produces a broken link. This
 * returns the file basename (without folder or `.md`) so writers and linkers
 * agree on one stable identifier.
 */
export function getNoteLinkTarget(
  note: Note,
  options?: {
    projectName?: string;
    dailyNoteDate?: string;
    weeklyReview?: WeeklyReview;
  }
): string {
  const path = getNotePath(note, options);
  const base = path.split("/").pop() || "";
  return base.replace(/\.md$/, "");
}

/**
 * Build a wikilink (Obsidian) or plain text (standard) reference.
 * Uses the canonical file target for resolution and the display title as an
 * alias when they differ, so links both resolve AND read naturally.
 */
function buildLink(
  target: string | undefined,
  display: string,
  format: ExportFormat
): string {
  const label = display.trim();
  if (format !== "obsidian") return label;
  if (!target || target === label) return `[[${label}]]`;
  return `[[${target}|${label}]]`;
}

/**
 * Sanitize a string for use as a filename
 */
export function sanitizeFilename(name: string): string {
  if (!name) return "untitled";
  return (
    name
      // Remove characters invalid in filenames
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
      // Replace multiple spaces/dots with single
      .replace(/\s+/g, " ")
      .replace(/\.{2,}/g, ".")
      // Trim whitespace and dots from ends
      .trim()
      .replace(/^\.+|\.+$/g, "")
      // Truncate to reasonable length (200 chars)
      .slice(0, 200) || "untitled"
  );
}

/**
 * Build a complete markdown file for a note (frontmatter + content)
 */
export function buildNoteFile(
  note: Note,
  slugToTitleMap: Map<string, string>,
  options?: {
    tags?: string[];
    projectName?: string;
    dailyNote?: DailyNote;
    weeklyReview?: WeeklyReview;
  }
): string {
  const frontmatter = generateFrontmatter(note, options);
  let markdown = htmlToMarkdown(note.content);
  markdown = convertLinksToWikilinks(markdown, slugToTitleMap);
  return `${frontmatter}\n\n${markdown}\n`;
}

/**
 * Build a simple markdown file for a capture
 */
export function buildCaptureFile(capture: Capture): string {
  const lines: string[] = ["---"];
  lines.push(`type: capture`);
  lines.push(`capture_type: ${capture.capture_type}`);
  lines.push(`captured_at: ${capture.captured_at}`);

  try {
    const tags = JSON.parse(capture.tags || "[]");
    if (Array.isArray(tags) && tags.length > 0) {
      lines.push(`tags: [${tags.map((t: string) => `"${escapeFrontmatterValue(t)}"`).join(", ")}]`);
    }
  } catch {
    // ignore
  }

  lines.push("---");
  lines.push("");
  lines.push(capture.content);
  lines.push("");

  return lines.join("\n");
}

/**
 * Build a markdown file for a task
 */
export function buildTaskFile(
  task: Task & { project_name?: string; note_title?: string },
  slugToTitleMap: Map<string, string>,
  format: ExportFormat = "obsidian"
): string {
  const lines: string[] = ["---"];
  const title = task.title || task.content.slice(0, 80);
  lines.push(`title: "${escapeFrontmatterValue(title)}"`);
  lines.push(`type: task`);
  lines.push(`status: ${task.status}`);
  lines.push(`priority: ${task.priority}`);
  if (task.due_date) lines.push(`due: ${task.due_date}`);
  if (task.scheduled_at) lines.push(`scheduled: ${task.scheduled_at}`);
  if (task.completed_at) lines.push(`completed: ${task.completed_at}`);
  if (task.project_name) lines.push(`project: "${escapeFrontmatterValue(task.project_name)}"`);

  try {
    const tags = JSON.parse(task.tags || "[]");
    if (Array.isArray(tags) && tags.length > 0) {
      lines.push(`tags: [${tags.map((t: string) => `"${escapeFrontmatterValue(t)}"`).join(", ")}]`);
    }
  } catch { /* ignore */ }

  lines.push(`created: ${task.created_at}`);
  lines.push(`updated: ${task.updated_at}`);
  lines.push("---");
  lines.push("");

  // Status indicator
  const checkbox = task.status === "completed" ? "[x]" : "[ ]";
  lines.push(`# ${checkbox} ${title}`);
  lines.push("");

  if (task.description) {
    lines.push(task.description);
    lines.push("");
  } else if (task.content !== title) {
    lines.push(task.content);
    lines.push("");
  }

  // Metadata section
  const meta: string[] = [];
  if (task.priority !== "medium") meta.push(`**Priority:** ${task.priority}`);
  if (task.due_date) meta.push(`**Due:** ${task.due_date}`);
  if (task.recurrence_rule) meta.push(`**Recurrence:** ${task.recurrence_rule}`);
  if (task.delegated_to) meta.push(`**Delegated to:** ${task.delegated_to}`);
  if (task.note_title) {
    const link = format === "obsidian"
      ? `[[${task.note_title}]]`
      : task.note_title;
    meta.push(`**Linked note:** ${link}`);
  }

  if (meta.length > 0) {
    lines.push("## Details");
    lines.push("");
    meta.forEach((m) => lines.push(`- ${m}`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Build a markdown file for a journal entry
 */
export function buildJournalFile(entry: JournalEntry): string {
  const lines: string[] = ["---"];
  lines.push(`type: journal`);
  lines.push(`date: ${entry.date}`);
  lines.push(`category: ${entry.category}`);
  if (entry.mood) lines.push(`mood: "${escapeFrontmatterValue(entry.mood)}"`);
  if (entry.location) lines.push(`location: "${escapeFrontmatterValue(entry.location)}"`);

  try {
    const tags = JSON.parse(entry.tags || "[]");
    if (Array.isArray(tags) && tags.length > 0) {
      lines.push(`tags: [${tags.map((t: string) => `"${escapeFrontmatterValue(t)}"`).join(", ")}]`);
    }
  } catch { /* ignore */ }

  lines.push(`created: ${entry.created_at}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Journal — ${entry.date}`);
  lines.push("");
  lines.push(entry.entry_text);
  lines.push("");

  return lines.join("\n");
}

/**
 * Build a markdown file for a reminder
 */
export function buildReminderFile(
  reminder: Reminder & { project_name?: string }
): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${escapeFrontmatterValue(reminder.title)}"`);
  lines.push(`type: reminder`);
  lines.push(`status: ${reminder.status}`);
  lines.push(`priority: ${reminder.priority}`);
  lines.push(`remind_at: ${reminder.remind_at}`);
  if (reminder.project_name) lines.push(`project: "${escapeFrontmatterValue(reminder.project_name)}"`);
  if (reminder.recurrence_rule) lines.push(`recurrence: "${escapeFrontmatterValue(reminder.recurrence_rule)}"`);

  try {
    const tags = JSON.parse(reminder.tags || "[]");
    if (Array.isArray(tags) && tags.length > 0) {
      lines.push(`tags: [${tags.map((t: string) => `"${escapeFrontmatterValue(t)}"`).join(", ")}]`);
    }
  } catch { /* ignore */ }

  lines.push(`created: ${reminder.created_at}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${reminder.title}`);
  lines.push("");
  if (reminder.content) {
    lines.push(reminder.content);
    lines.push("");
  }
  lines.push(`**Remind at:** ${reminder.remind_at}`);
  if (reminder.triggered_at) lines.push(`**Triggered:** ${reminder.triggered_at}`);
  if (reminder.snoozed_until) lines.push(`**Snoozed until:** ${reminder.snoozed_until}`);
  lines.push("");

  return lines.join("\n");
}

/**
 * Build a markdown file for an AI insight
 */
export function buildInsightFile(
  insight: Insight,
  noteIdToTitle: Map<string, string>,
  format: ExportFormat = "obsidian",
  noteIdToLinkTarget?: Map<string, string>
): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${escapeFrontmatterValue(insight.title)}"`);
  lines.push(`type: insight`);
  lines.push(`insight_type: ${insight.insight_type}`);
  lines.push(`confidence: ${insight.confidence}`);
  if (insight.is_actioned) lines.push(`actioned: true`);
  if (insight.is_dismissed) lines.push(`dismissed: true`);
  lines.push(`generated: ${insight.generated_at}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${insight.title}`);
  lines.push("");
  lines.push(insight.content);
  lines.push("");

  // Source notes
  try {
    const sourceNotes = JSON.parse(insight.source_notes || "[]");
    if (Array.isArray(sourceNotes) && sourceNotes.length > 0) {
      lines.push("## Source Notes");
      lines.push("");
      for (const noteId of sourceNotes) {
        const title = noteIdToTitle.get(noteId);
        if (title) {
          const link = buildLink(noteIdToLinkTarget?.get(noteId), title, format);
          lines.push(`- ${link}`);
        }
      }
      lines.push("");
    }
  } catch { /* ignore */ }

  return lines.join("\n");
}

/**
 * Build a connections appendix for a note (added to the end of the note content)
 */
export function buildConnectionsSection(
  noteId: string,
  connections: NoteConnection[],
  noteIdToTitle: Map<string, string>,
  format: ExportFormat = "obsidian",
  noteIdToLinkTarget?: Map<string, string>
): string {
  const related = connections.filter(
    (c) => c.source_note_id === noteId || c.target_note_id === noteId
  );
  if (related.length === 0) return "";

  const lines: string[] = [];
  lines.push("");
  lines.push("## Connected Notes");
  lines.push("");

  for (const conn of related) {
    const otherId = conn.source_note_id === noteId ? conn.target_note_id : conn.source_note_id;
    const title = noteIdToTitle.get(otherId);
    if (!title) continue;

    const link = buildLink(noteIdToLinkTarget?.get(otherId), title, format);
    const arrow = conn.source_note_id === noteId ? "→" : "←";
    const label = conn.connection_type !== "related" ? ` (${conn.connection_type})` : "";
    lines.push(`- ${arrow} ${link}${label}`);
  }
  lines.push("");

  return lines.join("\n");
}

// --- Internal helpers ---

function escapeFrontmatterValue(value: string): string {
  return value.replace(/"/g, '\\"').replace(/\n/g, " ");
}

// --- Types for export orchestration ---

export type ExportFormat = "obsidian" | "standard";

export interface ExportOptions {
  format: ExportFormat;
  includeNotes: boolean;
  includeCaptures: boolean;
  includeTasks: boolean;
  includeJournal: boolean;
  includeReminders: boolean;
  includeInsights: boolean;
  includeConnections: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  format: "obsidian",
  includeNotes: true,
  includeCaptures: true,
  includeTasks: true,
  includeJournal: true,
  includeReminders: true,
  includeInsights: true,
  includeConnections: true,
};

export interface NoteWithRelations extends Note {
  project_name?: string;
  project_slug?: string;
  daily_note?: DailyNote;
  weekly_review?: WeeklyReview;
  tag_names?: string[];
}

export interface ExportResult {
  path: string;
  content: string;
}

export interface ExportStats {
  notes: number;
  captures: number;
  tasks: number;
  journal: number;
  reminders: number;
  insights: number;
  connections: number;
  projects: number;
  totalFiles: number;
}

export interface VaultExportData {
  notes: NoteWithRelations[];
  captures: Capture[];
  tasks: (Task & { project_name?: string; note_title?: string })[];
  journal: JournalEntry[];
  reminders: (Reminder & { project_name?: string })[];
  insights: Insight[];
  connections: NoteConnection[];
  projects: Project[];
}

/**
 * Convert an array of notes with relations into export-ready files
 */
export function buildVaultFiles(
  notes: NoteWithRelations[],
  captures: Capture[],
  projects: Project[],
  options?: Partial<ExportOptions>,
  extraData?: {
    tasks?: (Task & { project_name?: string; note_title?: string })[];
    journal?: JournalEntry[];
    reminders?: (Reminder & { project_name?: string })[];
    insights?: Insight[];
    connections?: NoteConnection[];
  }
): ExportResult[] {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const files: ExportResult[] = [];

  // Build slug-to-title map for wikilink resolution.
  // noteIdToLinkTarget maps to the canonical file basename so wikilinks resolve;
  // noteIdToTitle keeps the (trimmed) display title for aliasing and readability.
  const slugToTitleMap = new Map<string, string>();
  const noteIdToTitle = new Map<string, string>();
  const noteIdToLinkTarget = new Map<string, string>();
  for (const note of notes) {
    const title = (note.title || "").trim();
    slugToTitleMap.set(note.slug, title);
    noteIdToTitle.set(note.id, title);
    noteIdToLinkTarget.set(
      note.id,
      getNoteLinkTarget(note, {
        projectName: note.project_name,
        dailyNoteDate: note.daily_note?.date,
        weeklyReview: note.weekly_review,
      })
    );
  }

  // Build connection lookup
  const connectionsByNote = new Map<string, NoteConnection[]>();
  if (opts.includeConnections && extraData?.connections) {
    for (const conn of extraData.connections) {
      if (!connectionsByNote.has(conn.source_note_id)) {
        connectionsByNote.set(conn.source_note_id, []);
      }
      connectionsByNote.get(conn.source_note_id)!.push(conn);
      if (!connectionsByNote.has(conn.target_note_id)) {
        connectionsByNote.set(conn.target_note_id, []);
      }
      connectionsByNote.get(conn.target_note_id)!.push(conn);
    }
  }

  // Convert each note
  if (opts.includeNotes) {
    for (const note of notes) {
      const path = getNotePath(note, {
        projectName: note.project_name,
        dailyNoteDate: note.daily_note?.date,
        weeklyReview: note.weekly_review,
      });

      let content = buildNoteFile(note, slugToTitleMap, {
        tags: note.tag_names,
        projectName: note.project_name,
        dailyNote: note.daily_note,
        weeklyReview: note.weekly_review,
      });

      // Append connections section if available
      const noteConns = connectionsByNote.get(note.id);
      if (noteConns && noteConns.length > 0) {
        content += buildConnectionsSection(note.id, noteConns, noteIdToTitle, opts.format, noteIdToLinkTarget);
      }

      files.push({ path, content });
    }
  }

  // Convert captures
  if (opts.includeCaptures) {
    for (const capture of captures) {
      const date = capture.captured_at.split("T")[0] || capture.captured_at.split(" ")[0];
      const shortId = capture.id.slice(0, 8);
      const path = `captures/${date}-${shortId}.md`;
      files.push({ path, content: buildCaptureFile(capture) });
    }
  }

  // Convert tasks
  if (opts.includeTasks && extraData?.tasks) {
    for (const task of extraData.tasks) {
      const title = sanitizeFilename(task.title || task.content.slice(0, 80));
      const shortId = task.id.slice(0, 8);
      const folder = task.project_name
        ? `tasks/${sanitizeFilename(task.project_name)}`
        : `tasks`;
      const path = `${folder}/${title}-${shortId}.md`;
      files.push({ path, content: buildTaskFile(task, slugToTitleMap, opts.format) });
    }
  }

  // Convert journal entries
  if (opts.includeJournal && extraData?.journal) {
    for (const entry of extraData.journal) {
      const shortId = entry.id.slice(0, 8);
      const month = entry.date.slice(0, 7); // YYYY-MM
      const path = `journal/${month}/${entry.date}-${shortId}.md`;
      files.push({ path, content: buildJournalFile(entry) });
    }
  }

  // Convert reminders
  if (opts.includeReminders && extraData?.reminders) {
    for (const reminder of extraData.reminders) {
      const title = sanitizeFilename(reminder.title);
      const shortId = reminder.id.slice(0, 8);
      const path = `reminders/${title}-${shortId}.md`;
      files.push({ path, content: buildReminderFile(reminder) });
    }
  }

  // Convert insights
  if (opts.includeInsights && extraData?.insights) {
    for (const insight of extraData.insights) {
      const title = sanitizeFilename(insight.title);
      const shortId = insight.id.slice(0, 8);
      const path = `insights/${insight.insight_type}/${title}-${shortId}.md`;
      files.push({ path, content: buildInsightFile(insight, noteIdToTitle, opts.format, noteIdToLinkTarget) });
    }
  }

  // Generate Map of Content
  const stats = computeExportStats(
    notes, captures, projects,
    extraData?.tasks || [],
    extraData?.journal || [],
    extraData?.reminders || [],
    extraData?.insights || [],
    extraData?.connections || [],
    files.length + 1 // +1 for the MOC itself
  );
  const moc = buildMapOfContent(stats, projects, opts);
  files.push({ path: "README.md", content: moc });

  return files;
}

/**
 * Compute export statistics for preview and README
 */
export function computeExportStats(
  notes: NoteWithRelations[],
  captures: Capture[],
  projects: Project[],
  tasks: Task[],
  journal: JournalEntry[],
  reminders: Reminder[],
  insights: Insight[],
  connections: NoteConnection[],
  totalFiles: number
): ExportStats {
  return {
    notes: notes.length,
    captures: captures.length,
    tasks: tasks.length,
    journal: journal.length,
    reminders: reminders.length,
    insights: insights.length,
    connections: connections.length,
    projects: projects.length,
    totalFiles,
  };
}

function buildMapOfContent(
  stats: ExportStats,
  projects: Project[],
  options: ExportOptions
): string {
  const exportDate = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  lines.push("# Vault Export");
  lines.push("");
  lines.push(`Exported on ${exportDate} from Brain Portal.`);
  lines.push("");
  lines.push("## Contents");
  lines.push("");
  if (options.includeNotes) lines.push(`- **${stats.notes}** notes`);
  if (options.includeCaptures) lines.push(`- **${stats.captures}** captures`);
  if (options.includeTasks) lines.push(`- **${stats.tasks}** tasks`);
  if (options.includeJournal) lines.push(`- **${stats.journal}** journal entries`);
  if (options.includeReminders) lines.push(`- **${stats.reminders}** reminders`);
  if (options.includeInsights) lines.push(`- **${stats.insights}** insights`);
  if (options.includeConnections) lines.push(`- **${stats.connections}** note connections`);
  lines.push(`- **${stats.projects}** projects`);
  lines.push(`- **${stats.totalFiles}** total files`);
  lines.push("");

  lines.push("## Folder Structure");
  lines.push("");
  if (options.includeNotes) {
    lines.push("- `daily/` — Daily notes (YYYY-MM-DD.md)");
    lines.push("- `weekly/` — Weekly reviews (YYYY-WXX.md)");
    lines.push("- `projects/` — Notes organized by project");
    lines.push("- `uncategorized/` — Notes without a project");
  }
  if (options.includeCaptures) lines.push("- `captures/` — Quick captures and thoughts");
  if (options.includeTasks) lines.push("- `tasks/` — Tasks organized by project");
  if (options.includeJournal) lines.push("- `journal/` — Journal entries by month");
  if (options.includeReminders) lines.push("- `reminders/` — Reminders");
  if (options.includeInsights) lines.push("- `insights/` — AI-generated insights by type");
  lines.push("");

  if (projects.length > 0 && options.includeNotes) {
    lines.push("## Projects");
    lines.push("");
    for (const project of projects) {
      const statusIcon = project.status === "active" ? "●" : project.status === "completed" ? "✓" : "○";
      lines.push(`- ${statusIcon} **${project.name}** — ${project.status}${project.description ? `: ${project.description.slice(0, 100)}` : ""}`);
    }
    lines.push("");
  }

  const formatLabel = options.format === "obsidian"
    ? "Obsidian — uses `[[wikilink]]` syntax and YAML frontmatter"
    : "Standard Markdown — uses regular `[text](url)` links";

  lines.push("## Compatibility");
  lines.push("");
  lines.push(`Format: ${formatLabel}`);
  lines.push("");
  if (options.format === "obsidian") {
    lines.push("Open this folder directly in [Obsidian](https://obsidian.md) as a vault.");
  } else {
    lines.push("This export uses standard markdown and can be opened in any markdown editor.");
  }
  lines.push("");

  return lines.join("\n");
}
