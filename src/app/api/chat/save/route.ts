/**
 * Keep a chat answer.
 *
 * The delegation flow ended in a review screen with approve / revise / reject.
 * In a conversation those three collapse: revising is the next message,
 * rejecting is closing the sheet, and the only one that needed a button is
 * keeping the answer. So this is the whole tail of the workflow.
 *
 * POST body: { content, as: "note" | "task", title?, projectId?, sourceType?, sourceId? }
 */

import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db/client";
import { enqueue } from "@/lib/processing/queue";
import slugify from "@/lib/utils/slugify";
import { parseItemRef, loadChatItem } from "@/lib/chat/item-context";
import type { Note, Task } from "@/lib/db/schema";

const MAX_CONTENT = 100_000;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content.trim() : "";
  const as = body.as === "task" ? "task" : "note";

  if (!content) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }
  if (content.length > MAX_CONTENT) {
    return NextResponse.json({ error: "Answer is too long to save" }, { status: 413 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : null;
  const sourceType = typeof body.sourceType === "string" ? body.sourceType : null;
  const sourceId = typeof body.sourceId === "string" ? body.sourceId : null;

  // The item the chat was pinned to, if any — used for the title and the
  // back-link, so a saved answer says what it came from.
  const source = await resolveSource(user.id, sourceType, sourceId);

  try {
    if (as === "task") {
      return await saveAsTask(user.id, content, projectId, source);
    }
    return await saveAsNote(user.id, content, projectId, source, body.title);
  } catch (error) {
    console.error("[chat/save] Failed:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

interface SavedSource {
  title: string;
  label: string;
  href: string | null;
}

async function resolveSource(
  userId: string,
  sourceType: string | null,
  sourceId: string | null
): Promise<SavedSource | null> {
  if (!sourceType || !sourceId) return null;

  const ref = parseItemRef(`${sourceType}:${sourceId}`);
  if (!ref) return null;

  try {
    const item = await loadChatItem(userId, ref);
    if (!item) return null;
    return {
      title: item.title,
      label: item.label,
      href: ref.type === "note" || ref.type === "journal" ? `/notes/${ref.id}` : null,
    };
  } catch {
    return null;
  }
}

async function saveAsNote(
  userId: string,
  content: string,
  projectId: string | null,
  source: SavedSource | null,
  rawTitle: unknown
): Promise<NextResponse> {
  const title =
    (typeof rawTitle === "string" && rawTitle.trim()) ||
    (source ? `Re: ${source.title}` : deriveTitle(content));

  // Provenance footer, built server-side so it can't be spoofed by the client.
  const footer = source
    ? `\n\n---\n\n*From a chat about ${source.label.toLowerCase()} ${
        source.href ? `[${source.title}](${source.href})` : `"${source.title}"`
      }.*\n`
    : `\n\n---\n\n*Saved from a chat.*\n`;

  const slug = await uniqueSlug(userId, title);

  const note = await queryOne<Note>(
    `INSERT INTO notes (user_id, project_id, title, slug, content, content_plain, note_type)
     VALUES (?, ?, ?, ?, ?, ?, 'note')
     RETURNING *`,
    [userId, projectId, title, slug, content + footer, content]
  );

  if (!note) {
    return NextResponse.json({ error: "Failed to create note" }, { status: 500 });
  }

  // Index it, so the answer is findable later rather than only readable now.
  try {
    await enqueue({
      userId,
      entityType: "note",
      entityId: note.id,
      operation: "generate_embedding",
      tier: "embedding",
      priority: 1,
    });
  } catch (err) {
    // Non-fatal: the note exists either way.
    console.error("[chat/save] Failed to enqueue embedding:", err);
  }

  return NextResponse.json({ saved: "note", id: note.id, slug, title });
}

async function saveAsTask(
  userId: string,
  content: string,
  projectId: string | null,
  source: SavedSource | null
): Promise<NextResponse> {
  // A task is a one-liner, so the answer becomes the title and the body is
  // kept in the description rather than thrown away.
  const title = deriveTitle(content);

  const task = await queryOne<Task>(
    `INSERT INTO tasks (user_id, content, title, description, status, priority, project_id)
     VALUES (?, ?, ?, ?, 'pending', 'medium', ?)
     RETURNING *`,
    [userId, title, title, buildTaskDescription(content, source), projectId]
  );

  if (!task) {
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }

  return NextResponse.json({ saved: "task", id: task.id, title });
}

function buildTaskDescription(content: string, source: SavedSource | null): string {
  const origin = source ? `\n\n(From a chat about "${source.title}".)` : "";
  return content + origin;
}

/** First meaningful line, trimmed to something that reads as a title. */
function deriveTitle(content: string): string {
  const line =
    content
      .split("\n")
      .map((l) => l.replace(/^[#>\-*\s]+/, "").trim())
      .find((l) => l.length > 0) || "Saved answer";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

async function uniqueSlug(userId: string, title: string): Promise<string> {
  const base = slugify(title) || "saved-answer";
  let candidate = base;
  let counter = 1;

  // Bounded so a pathological collision run can't spin here forever.
  while (counter < 100) {
    const existing = await queryOne<{ id: string }>(
      "SELECT id FROM notes WHERE user_id = ? AND slug = ?",
      [userId, candidate]
    );
    if (!existing) return candidate;
    candidate = `${base}-${counter}`;
    counter++;
  }

  return `${base}-${Date.now()}`;
}
