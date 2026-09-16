/**
 * Share API — one endpoint for "put this in Brain Portal".
 *
 * POST /api/share
 *   { url?, text?, title?, target?: "capture" | "note" | "task",
 *     projectId?, tags?, comment? }
 *
 * Backs three callers:
 *   1. The /share page, which the Android share sheet navigates to (session auth).
 *   2. iOS Shortcuts / bookmarklets / desktop automations, which cannot carry a
 *      session cookie and authenticate with an MCP API key instead.
 *   3. Any external agent that already holds a key.
 *
 * The payload is normalized by `parseSharedPayload` before saving, because the
 * sharing app decides which of title/text/url carries the link and they do not
 * agree with each other.
 */

import { NextRequest, NextResponse } from "next/server";
import { mutate, queryAll } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { validateApiKey, hasScope } from "@/mcp/auth";
import { enqueue } from "@/lib/processing/queue";
import { safeParseJson, isErrorResponse } from "@/lib/api/validation";
import { parseSharedPayload } from "@/lib/share/parse";
import type { Capture, Note, Task } from "@/lib/db/schema";

/** Every issued MCP key carries this prefix. */
const KEY_PREFIX = "bp_mcp_";

export type ShareTarget = "capture" | "note" | "task";

const VALID_TARGETS: ShareTarget[] = ["capture", "note", "task"];

/** Scope an API-key caller needs for each destination. */
const REQUIRED_SCOPE: Record<ShareTarget, string> = {
  capture: "captures:write",
  note: "notes:write",
  task: "tasks:write",
};

interface Caller {
  userId: string;
  /** Null for a session caller — cookie auth is not scope-limited. */
  scopes: string[] | null;
}

/**
 * Session cookie first, then a bearer MCP key. A shared link from the phone
 * uses the cookie; a Shortcut uses the key.
 */
async function authenticate(request: NextRequest): Promise<Caller | null> {
  const sessionUser = await getCurrentUser();
  if (sessionUser) return { userId: sessionUser.id, scopes: null };

  const header = request.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : "";
  if (!bearer.startsWith(KEY_PREFIX)) return null;

  const keyUser = await validateApiKey(bearer);
  if (!keyUser) return null;
  return { userId: keyUser.userId, scopes: keyUser.scopes };
}

function authorized(caller: Caller, target: ShareTarget): boolean {
  if (caller.scopes === null) return true; // session caller
  return hasScope(
    { userId: caller.userId, keyId: "", keyName: "", scopes: caller.scopes, rateLimitPerMinute: 0 },
    REQUIRED_SCOPE[target]
  );
}

export async function POST(request: NextRequest) {
  const body = await safeParseJson(request);
  if (isErrorResponse(body)) return body;

  const target = (body.target as ShareTarget) || "capture";
  if (!VALID_TARGETS.includes(target)) {
    return NextResponse.json(
      { error: `target must be one of ${VALID_TARGETS.join(", ")}` },
      { status: 400 }
    );
  }

  const caller = await authenticate(request);
  if (!caller) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!authorized(caller, target)) {
    return NextResponse.json(
      { error: `This API key lacks the ${REQUIRED_SCOPE[target]} scope` },
      { status: 403 }
    );
  }

  const parsed = parseSharedPayload({
    title: body.title as string | undefined,
    text: body.text as string | undefined,
    url: body.url as string | undefined,
  });

  const comment = typeof body.comment === "string" ? body.comment.trim() : "";

  if (parsed.isEmpty && !comment) {
    return NextResponse.json(
      { error: "Nothing to save — the share carried no link or text" },
      { status: 400 }
    );
  }

  // The user's own note goes first: it is the reason they bothered to share.
  const content = [comment, parsed.content].filter(Boolean).join("\n\n");
  const projectId = (body.projectId as string) || null;
  const tags = Array.isArray(body.tags)
    ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  try {
    switch (target) {
      case "capture":
        return await saveCapture(caller.userId, parsed, content, tags);
      case "note":
        return await saveNote(caller.userId, parsed, content, projectId);
      case "task":
        return await saveTask(caller.userId, parsed, content, projectId);
    }
  } catch (error) {
    console.error("[API] POST /api/share failed:", error);
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }
}

async function saveCapture(
  userId: string,
  parsed: ReturnType<typeof parseSharedPayload>,
  content: string,
  tags: string[]
) {
  const capture = await mutate<Capture>(
    `INSERT INTO captures (user_id, content, capture_type, tags, metadata)
     VALUES (?, ?, ?, ?, ?)
     RETURNING *`,
    [
      userId,
      content,
      parsed.captureType,
      JSON.stringify(tags),
      JSON.stringify({
        source: "share_target",
        ...(parsed.url ? { url: parsed.url, scrapeEnabled: true } : {}),
        ...(parsed.title ? { shared_title: parsed.title } : {}),
      }),
    ]
  );

  if (!capture) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  // Shared links are worth reading: scrape the page and embed it so the thing
  // that was shared is searchable by what it says, not just by its URL.
  if (parsed.url) {
    try {
      await enqueue({
        userId,
        entityType: "capture",
        entityId: capture.id,
        operation: "link-scrape-and-embed",
        tier: "embedding",
        priority: 5,
        metadata: { captureId: capture.id, url: parsed.url, userId },
      });
    } catch (queueError) {
      // Enqueueing is an enhancement — never lose the capture over it.
      console.error("[Share] failed to enqueue link scrape:", queueError);
    }
  }

  return NextResponse.json(
    { saved: "capture", id: capture.id, url: `/inbox`, capture },
    { status: 201 }
  );
}

async function saveNote(
  userId: string,
  parsed: ReturnType<typeof parseSharedPayload>,
  content: string,
  projectId: string | null
) {
  const title = parsed.title || "Shared note";
  const slug = await uniqueSlug(userId, title);

  const note = await mutate<Note>(
    `INSERT INTO notes (user_id, project_id, title, slug, content, content_plain, note_type, word_count, metadata, processing_status)
     VALUES (?, ?, ?, ?, ?, ?, 'note', ?, ?, 'pending')
     RETURNING *`,
    [
      userId,
      projectId,
      title,
      slug,
      content,
      content,
      content.split(/\s+/).filter(Boolean).length,
      JSON.stringify({
        source: "share_target",
        ...(parsed.url ? { url: parsed.url } : {}),
      }),
    ]
  );

  if (!note) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  try {
    await enqueue({
      userId,
      entityType: "note",
      entityId: note.id,
      operation: "generate_embedding",
      tier: "embedding",
      priority: 1,
    });
  } catch (queueError) {
    console.error("[Share] failed to enqueue note embedding:", queueError);
  }

  return NextResponse.json(
    { saved: "note", id: note.id, url: `/notes/${note.id}`, note },
    { status: 201 }
  );
}

/**
 * Notes carry a per-user unique slug. Mirrors the numbering scheme used by
 * POST /api/notes so shared notes get the same kind of URL as typed ones.
 */
async function uniqueSlug(userId: string, title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 80) || "shared";

  const existing = await queryAll<{ slug: string }>(
    "SELECT slug FROM notes WHERE user_id = ? AND slug LIKE ?",
    [userId, `${base}%`]
  );
  if (existing.length === 0) return base;

  const taken = new Set(existing.map((row) => row.slug));
  let slug = base;
  let counter = 1;
  while (taken.has(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  return slug;
}

async function saveTask(
  userId: string,
  parsed: ReturnType<typeof parseSharedPayload>,
  content: string,
  projectId: string | null
) {
  // `content` is the legacy NOT NULL column and still what most of the task UI
  // renders; `title`/`description` are the newer pair. Populate all three.
  const title = (parsed.title || content.split("\n")[0]).slice(0, 200);

  const task = await mutate<Task>(
    `INSERT INTO tasks (user_id, project_id, content, title, description, status, priority, metadata)
     VALUES (?, ?, ?, ?, ?, 'pending', 'medium', ?)
     RETURNING *`,
    [
      userId,
      projectId,
      title,
      title,
      content,
      JSON.stringify({
        source: "share_target",
        ...(parsed.url ? { url: parsed.url } : {}),
      }),
    ]
  );

  if (!task) {
    return NextResponse.json({ error: "Failed to save" }, { status: 500 });
  }

  return NextResponse.json(
    { saved: "task", id: task.id, url: `/tasks`, task },
    { status: 201 }
  );
}
