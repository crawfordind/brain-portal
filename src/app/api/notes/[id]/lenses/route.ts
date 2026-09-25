// src/app/api/notes/[id]/lenses/route.ts
//
// "Read deeper" for Note Lenses. The rule-based lenses need no server at all;
// this is the optional model read for notes too loose for rules. Results are
// cached per (note, content fingerprint), so reopening an unchanged note shows
// the deeper read again without another model call.
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne } from "@/lib/db/client";
import { generateCacheKey, getCached, setCache } from "@/lib/processing/cache";
import { extractNoteSignals } from "@/lib/lenses/ai-extract";
import { contentFingerprint } from "@/lib/lenses/fingerprint";
import type { DeepRead } from "@/lib/lenses/types";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MIN_CHARS = 80;
const MAX_CHARS = 200_000;
const CACHE_TTL_HOURS = 24 * 30;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const cacheKey = (noteId: string, fingerprint: string) =>
  generateCacheKey("note-lenses-v1", { noteId, fingerprint });

async function loadNote(id: string, userId: string) {
  return queryOne<{ id: string; title: string; content: string }>(
    "SELECT id, title, content FROM notes WHERE id = ? AND user_id = ?",
    [id, userId]
  );
}

// GET /api/notes/[id]/lenses?fingerprint=… — the cached read for that body, if any
export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await loadNote(id, user.id);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const fingerprint =
    request.nextUrl.searchParams.get("fingerprint") || contentFingerprint(note.content ?? "");
  const cached = await getCached<DeepRead>(user.id, cacheKey(id, fingerprint));
  return NextResponse.json({ deepRead: cached });
}

// POST /api/notes/[id]/lenses — { content?, today? } → run the model read
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await loadNote(id, user.id);
  if (!note) return NextResponse.json({ error: "Note not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as { content?: unknown; today?: unknown };
  // The client sends what it is showing, which may be ahead of the last save.
  const content = typeof body.content === "string" ? body.content : note.content ?? "";
  const today =
    typeof body.today === "string" && DAY.test(body.today)
      ? body.today
      : new Date().toISOString().slice(0, 10);

  if (content.length > MAX_CHARS) {
    return NextResponse.json({ error: "Note is too long to read in one go." }, { status: 413 });
  }
  if (content.replace(/<[^>]*>/g, "").trim().length < MIN_CHARS) {
    return NextResponse.json(
      { error: "Add a bit more to this note first. There isn't enough to read yet." },
      { status: 400 }
    );
  }

  const fingerprint = contentFingerprint(content);
  const key = cacheKey(id, fingerprint);
  const cached = await getCached<DeepRead>(user.id, key);
  if (cached) return NextResponse.json({ deepRead: cached, cached: true });

  try {
    const { signals, summary } = await extractNoteSignals({
      userId: user.id,
      title: note.title,
      content,
      today,
    });
    const deepRead: DeepRead = {
      fingerprint,
      signals,
      summary,
      generatedAt: new Date().toISOString(),
    };
    await setCache(user.id, key, deepRead, {
      operation: "note-lenses",
      tier: "full_llm",
      ttlHours: CACHE_TTL_HOURS,
    });
    return NextResponse.json({ deepRead, cached: false });
  } catch (error) {
    console.error("Note lenses read failed:", error);
    return NextResponse.json(
      { error: "Couldn't read this note right now. Try again in a moment." },
      { status: 502 }
    );
  }
}
