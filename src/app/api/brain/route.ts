import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { db, query, queryOne } from "@/lib/db/client";
import type {
  Capture,
  Note,
  Project,
  Task,
  User,
} from "@/lib/db/schema";

// External "brain state" read/write endpoint.
//
// Auth: a static service token supplied as `Authorization: Bearer <token>`.
// The token must equal process.env.BRAIN_SERVICE_TOKEN.
//
// BOTH of these must be set or the endpoint fails closed with 503:
//   BRAIN_SERVICE_TOKEN  - the shared secret
//   BRAIN_SERVICE_EMAIL  - the account all state is scoped to
//
// There is deliberately no default account. An earlier version defaulted to
// the original author's own address, which meant every deployment that did not
// override it exposed a named third party's mailbox as the privileged account.
//
// The token is NOT accepted as a query parameter: URLs land in proxy access
// logs, browser history and Referer headers. Use the header.
//
// For anything richer than this, prefer the MCP transport at /api/mcp/rpc —
// its keys are per-user, scoped and rate-limited. This endpoint exists only
// for simple external sync agents.
//
// GET  /api/brain  -> full state dump (projects, notes, tasks, captures)
// POST /api/brain  -> { state: { projects?, notes?, tasks?, captures? } }
//                      Creates the provided items. This endpoint is
//                      intentionally create-only (non-destructive sync).

type BrainState = {
  projects: Project[];
  notes: Note[];
  tasks: Task[];
  captures: Capture[];
};

type CreatedSummary = {
  projects: number;
  notes: number;
  tasks: number;
  captures: number;
};

function getServiceConfig():
  | { ok: true; token: string; email: string }
  | { ok: false; response: NextResponse } {
  const token = process.env.BRAIN_SERVICE_TOKEN;
  const email = process.env.BRAIN_SERVICE_EMAIL?.trim().toLowerCase();

  // Fail closed on either half. A configured token with no configured account
  // would have to invent one, and inventing one is how the previous default
  // ended up pointing at a real person.
  if (!token || !email) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error:
            "This endpoint is disabled. Set both BRAIN_SERVICE_TOKEN and BRAIN_SERVICE_EMAIL to enable it.",
        },
        { status: 503 }
      ),
    };
  }

  return { ok: true, token, email };
}

function extractToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (header && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}

async function authorize(
  request: NextRequest
): Promise<
  { ok: true; user: User } | { ok: false; response: NextResponse }
> {
  const config = getServiceConfig();
  if (!config.ok) return config;

  const provided = extractToken(request);
  // Compare BYTE lengths, not character lengths: a multibyte token of equal
  // character length would make timingSafeEqual throw a RangeError, turning a
  // failed auth attempt into a 500.
  const providedBytes = provided ? Buffer.from(provided, "utf8") : null;
  const expectedBytes = Buffer.from(config.token, "utf8");
  if (
    !providedBytes ||
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid token" }, { status: 401 }),
    };
  }

  const user = await queryOne<User>("SELECT * FROM users WHERE email = ?", [
    config.email,
  ]);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `No user found for ${config.email}` },
        { status: 404 }
      ),
    };
  }

  return { ok: true, user };
}

async function getBrainState(userId: string): Promise<BrainState> {
  const [projects, notes, tasks, captures] = await Promise.all([
    query<Project>(
      "SELECT * FROM projects WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    ),
    query<Note>(
      "SELECT * FROM notes WHERE user_id = ? ORDER BY updated_at DESC",
      [userId]
    ),
    query<Task>(
      "SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC",
      [userId]
    ),
    query<Capture>(
      "SELECT * FROM captures WHERE user_id = ? ORDER BY captured_at DESC",
      [userId]
    ),
  ]);
  return { projects, notes, tasks, captures };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120);
}

async function uniqueNoteSlug(userId: string, base: string): Promise<string> {
  const safeBase = base || "untitled";
  const existing = await query<{ slug: string }>(
    "SELECT slug FROM notes WHERE user_id = ? AND slug LIKE ?",
    [userId, `${safeBase}%`]
  );
  if (existing.length === 0) return safeBase;
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(safeBase)) return safeBase;
  let i = 1;
  while (taken.has(`${safeBase}-${i}`)) i++;
  return `${safeBase}-${i}`;
}

async function uniqueProjectSlug(
  userId: string,
  base: string
): Promise<string> {
  const safeBase = base || "project";
  const existing = await query<{ slug: string }>(
    "SELECT slug FROM projects WHERE user_id = ? AND slug LIKE ?",
    [userId, `${safeBase}%`]
  );
  if (existing.length === 0) return safeBase;
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(safeBase)) return safeBase;
  let i = 1;
  while (taken.has(`${safeBase}-${i}`)) i++;
  return `${safeBase}-${i}`;
}

function toMetadataString(value: unknown): string {
  if (value == null) return "{}";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

async function setBrainState(
  userId: string,
  state: Partial<BrainState> | undefined | null
): Promise<CreatedSummary> {
  const summary: CreatedSummary = {
    projects: 0,
    notes: 0,
    tasks: 0,
    captures: 0,
  };
  if (!state || typeof state !== "object") return summary;

  if (Array.isArray(state.projects)) {
    for (const project of state.projects) {
      if (!project || typeof project.name !== "string" || !project.name.trim())
        continue;
      const slug = await uniqueProjectSlug(
        userId,
        slugify(project.slug || project.name)
      );
      await db.execute({
        sql: `INSERT INTO projects (user_id, name, slug, description, status, color, icon, priority, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          userId,
          project.name.trim(),
          slug,
          project.description ?? null,
          project.status ?? "active",
          project.color ?? "#0d9488",
          project.icon ?? "folder",
          typeof project.priority === "number" ? project.priority : 0,
          toMetadataString(project.metadata),
        ],
      });
      summary.projects++;
    }
  }

  if (Array.isArray(state.notes)) {
    for (const note of state.notes) {
      if (!note || typeof note.title !== "string" || !note.title.trim())
        continue;
      const slug = await uniqueNoteSlug(
        userId,
        slugify(note.slug || note.title)
      );
      await db.execute({
        sql: `INSERT INTO notes (user_id, project_id, title, slug, content, note_type, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          userId,
          note.project_id ?? null,
          note.title.trim(),
          slug,
          note.content ?? "",
          note.note_type ?? "note",
          toMetadataString(note.metadata),
        ],
      });
      summary.notes++;
    }
  }

  if (Array.isArray(state.tasks)) {
    for (const task of state.tasks) {
      if (!task || typeof task.content !== "string" || !task.content.trim())
        continue;
      await db.execute({
        sql: `INSERT INTO tasks (user_id, content, status, priority, project_id, note_id, due_date, metadata)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          userId,
          task.content.trim(),
          task.status ?? "pending",
          task.priority ?? "medium",
          task.project_id ?? null,
          task.note_id ?? null,
          task.due_date ?? null,
          toMetadataString(task.metadata),
        ],
      });
      summary.tasks++;
    }
  }

  if (Array.isArray(state.captures)) {
    for (const capture of state.captures) {
      if (
        !capture ||
        typeof capture.content !== "string" ||
        !capture.content.trim()
      )
        continue;
      await db.execute({
        sql: `INSERT INTO captures (user_id, content, capture_type, metadata)
              VALUES (?, ?, ?, ?)`,
        args: [
          userId,
          capture.content.trim(),
          capture.capture_type ?? "thought",
          toMetadataString(capture.metadata),
        ],
      });
      summary.captures++;
    }
  }

  return summary;
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const state = await getBrainState(auth.user.id);
  return NextResponse.json({
    timestamp: new Date().toISOString(),
    user: { id: auth.user.id, email: auth.user.email },
    state,
  });
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  let body: { state?: Partial<BrainState> } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const created = await setBrainState(auth.user.id, body.state);
    return NextResponse.json({ success: true, created });
  } catch (error) {
    console.error("Failed to update brain state:", error);
    return NextResponse.json(
      { error: "Failed to update brain state" },
      { status: 500 }
    );
  }
}
