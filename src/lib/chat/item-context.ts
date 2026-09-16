/**
 * Chat context for a single item.
 *
 * "Ask about this" on a note, capture, task, reminder or insight opens the
 * chat with that item as the subject. Before this, getting AI help on one
 * thing meant the delegation flow: a form with an agent roster, a router, a
 * queue, a cron worker and a review screen — minutes of latency for what is
 * almost always a question with an answer.
 *
 * The chat already streams and already carries workspace context, so the item
 * is expressed as one more context type rather than as a parallel system.
 *
 * `context_id` is a composite `"<type>:<id>"` because the chat context is a
 * single nullable column and an item needs both halves to be loaded back. It
 * is parsed, never interpolated, so a malformed value resolves to nothing
 * instead of widening a query.
 */

import { queryOne } from "@/lib/db/client";
import { buildAnnotationPromptSection } from "@/lib/annotations";
import { findSimilarToText } from "@/lib/ai/embeddings";
import { CHAT_ITEM_TYPES, type ChatItemType, type ChatItemRef } from "./item-types";

export { CHAT_ITEM_TYPES, encodeItemRef, parseItemRef } from "./item-types";
export type { ChatItemType, ChatItemRef } from "./item-types";

/**
 * Where each item type can live, and how to read a title and a body out of it.
 *
 * Several types are genuinely ambiguous: the stream labels a capture whose
 * `capture_type` is 'task' or 'followup' as a `task` item, so a task id may
 * belong to either table, and a `reminder` may be a row in `reminders` or a
 * task the UI is presenting as one. Candidates are therefore a list tried in
 * order rather than a single table — the previous delegation endpoint assumed
 * one table per type and simply failed to find those items.
 */
interface ItemSource {
  table: string;
  /** Columns to select, aliased to `title` / `body` / `extra` / `project_id`. */
  select: string;
  /** Whether rows are addressable by slug as well as id. */
  hasSlug: boolean;
  /** What to call this in the prompt. */
  label: string;
  /** True when `body` is HTML that may carry annotation markup. */
  bodyIsHtml: boolean;
}

const NOTE_SOURCE: ItemSource = {
  table: "notes",
  select: "title, content AS body, content_plain AS extra, project_id",
  hasSlug: true,
  label: "Note",
  bodyIsHtml: true,
};

const CAPTURE_SOURCE: ItemSource = {
  table: "captures",
  select: "NULL AS title, content AS body, capture_type AS extra, NULL AS project_id",
  hasSlug: false,
  label: "Captured thought",
  bodyIsHtml: false,
};

const TASK_SOURCE: ItemSource = {
  table: "tasks",
  select: "title, COALESCE(description, content) AS body, status AS extra, project_id",
  hasSlug: false,
  label: "Task",
  bodyIsHtml: false,
};

const REMINDER_SOURCE: ItemSource = {
  table: "reminders",
  select: "title, COALESCE(content, title) AS body, status AS extra, project_id",
  hasSlug: false,
  label: "Reminder",
  bodyIsHtml: false,
};

const INSIGHT_SOURCE: ItemSource = {
  table: "insights",
  select: "title, content AS body, insight_type AS extra, NULL AS project_id",
  hasSlug: false,
  label: "Insight",
  bodyIsHtml: false,
};

const ITEM_SOURCES: Record<ChatItemType, ItemSource[]> = {
  note: [NOTE_SOURCE],
  journal: [{ ...NOTE_SOURCE, label: "Journal entry" }],
  capture: [CAPTURE_SOURCE],
  thought: [CAPTURE_SOURCE],
  // A stream "task" is a task row most of the time and a capture the rest.
  task: [TASK_SOURCE, { ...CAPTURE_SOURCE, label: "Task" }],
  // Likewise a "reminder" may be a reminder row or a dated task.
  reminder: [REMINDER_SOURCE, { ...TASK_SOURCE, label: "Reminder" }],
  insight: [INSIGHT_SOURCE],
};

interface ItemRow {
  id: string;
  title: string | null;
  body: string | null;
  extra: string | null;
  project_id: string | null;
}

export interface ResolvedChatItem {
  ref: ChatItemRef;
  label: string;
  title: string;
  /** Plain-ish body, truncated for the prompt. */
  body: string;
  /** Raw body as stored — carries annotation markup for notes. */
  rawBody: string;
  projectName: string | null;
}

const BODY_LIMIT = 4000;

/** Load the item itself. Returns null if it does not exist or is not the user's. */
export async function loadChatItem(
  userId: string,
  ref: ChatItemRef
): Promise<ResolvedChatItem | null> {
  const candidates = ITEM_SOURCES[ref.type];
  if (!candidates) return null;

  for (const source of candidates) {
    // Table and column names come from the constants above, never from the
    // ref, so only the id and user id vary — and those are bound parameters.
    const match = source.hasSlug ? "(id = ? OR slug = ?)" : "id = ?";
    const params = source.hasSlug ? [ref.id, ref.id, userId] : [ref.id, userId];

    let row: ItemRow | null = null;
    try {
      row = await queryOne<ItemRow>(
        `SELECT id, ${source.select} FROM ${source.table} WHERE ${match} AND user_id = ?`,
        params
      );
    } catch {
      // An optional table may not exist in this deployment — try the next one.
      continue;
    }
    if (!row) continue;

    const rawBody = row.body || "";
    // `extra` holds content_plain for notes, which is the cheaper plain form
    // when it has been computed.
    const plain = source.bodyIsHtml ? row.extra || stripTags(rawBody) : rawBody;

    let projectName: string | null = null;
    if (row.project_id) {
      const project = await queryOne<{ name: string }>(
        "SELECT name FROM projects WHERE id = ? AND user_id = ?",
        [row.project_id, userId]
      );
      projectName = project?.name || null;
    }

    return {
      ref,
      label: source.label,
      title: row.title?.trim() || firstLine(plain) || `Untitled ${source.label.toLowerCase()}`,
      body: plain.length > BODY_LIMIT ? `${plain.slice(0, BODY_LIMIT)}…` : plain,
      rawBody,
      projectName,
    };
  }

  return null;
}

/**
 * Build the context block describing this item.
 *
 * Annotations are read from the raw body rather than the plain text: a note's
 * semantic highlights live in its HTML, and `content_plain` has already
 * stripped them. Losing them here would silently drop an instruction the user
 * deliberately painted onto the passage.
 */
export async function buildItemContextSummary(
  userId: string,
  item: ResolvedChatItem
): Promise<string> {
  const parts: string[] = [`${item.label}: ${item.title}`];

  if (item.projectName) parts.push(`Project: ${item.projectName}`);

  parts.push(`\nContent:\n${item.body}`);

  const annotations = buildAnnotationPromptSection(item.rawBody);
  if (annotations) parts.push(`\n${annotations}`);

  // Related notes give the model the rest of what the user has written on the
  // subject, which is the whole reason to ask here rather than in a bare chat.
  try {
    const related = await findSimilarToText(userId, item.body.slice(0, 2000), 0.65, 4);
    const others = related.filter((r) => r.id !== item.ref.id);
    if (others.length > 0) {
      parts.push(
        `\nRelated notes from this workspace:\n${others
          .map((r) => {
            const snippet = (r.content_plain || "").slice(0, 200).trim();
            return `- ${r.title}${snippet ? `\n  > ${snippet}` : ""}`;
          })
          .join("\n")}`
      );
    }
  } catch {
    // Non-fatal: embeddings may not be indexed yet.
  }

  return parts.join("\n");
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim().length > 0) || "";
  const trimmed = line.trim();
  return trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
}
