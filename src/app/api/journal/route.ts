/**
 * Journal API - Agentic-first journaling
 *
 * GET: Fetch journal entries for a date, date range, or month
 * POST: Create a journal entry (auto-creates daily journal note if needed).
 *       Writing is in src/lib/journal/store.ts, shared with the stream.
 *
 * The journal system transforms the daily note concept into an intuitive
 * journaling experience. Users just say "today I planted tomatoes" and
 * the system handles everything: creating entries, categorizing them,
 * and compiling monthly journals.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { JournalEntry } from "@/lib/db/schema";
import { complete } from "@/lib/ai/client";
import { isValidJournalDate, normalizeCategory, normalizeTags } from "@/lib/journal/entry";
import {
  getStoredTimeZone,
  JournalInputError,
  saveJournalEntry,
} from "@/lib/journal/store";

function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return (raw as T) ?? fallback;
  try {
    return JSON.parse(raw || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

// GET /api/journal - Get journal entries
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const date = searchParams.get("date");
  const month = searchParams.get("month"); // YYYY-MM format
  const year = searchParams.get("year");
  const category = searchParams.get("category");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "50") || 50, 1), 200);
  const offset = Math.max(parseInt(searchParams.get("offset") || "0") || 0, 0);

  if (date && !isValidJournalDate(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  let query = `
    SELECT je.*, n.title as note_title, n.content as note_content
    FROM journal_entries je
    LEFT JOIN notes n ON je.note_id = n.id
    WHERE je.user_id = ?
  `;
  const args: (string | number)[] = [user.id];

  if (date) {
    query += " AND je.date = ?";
    args.push(date);
  } else if (month) {
    query += " AND je.date LIKE ? || '%'";
    args.push(month);
  } else if (year) {
    query += " AND je.date LIKE ? || '%'";
    args.push(year);
  }

  if (category) {
    query += " AND je.category = ?";
    args.push(category);
  }

  query += " ORDER BY je.date DESC, je.created_at DESC LIMIT ? OFFSET ?";
  args.push(limit, offset);

  let batch;
  try {
    batch = await db.batch([
    { sql: query, args },
    {
      sql: `SELECT SUBSTR(date, 1, 7) as month, COUNT(*) as count
            FROM journal_entries WHERE user_id = ?
            GROUP BY SUBSTR(date, 1, 7) ORDER BY month DESC`,
      args: [user.id],
    },
    {
      sql: `SELECT category, COUNT(*) as count
            FROM journal_entries WHERE user_id = ?
            GROUP BY category ORDER BY count DESC`,
      args: [user.id],
    },
  ], "read");
  } catch (error) {
    console.error("[journal] GET failed:", error);
    return NextResponse.json(
      { error: "Couldn't load the journal. Try again in a moment." },
      { status: 500 }
    );
  }
  const [entriesResult, monthsResult, categoryResult] = batch;

  const entries = entriesResult.rows as unknown as (JournalEntry & { note_title: string; note_content: string })[];
  const months = monthsResult.rows as unknown as { month: string; count: number }[];
  const categoryCounts = categoryResult.rows as unknown as { category: string; count: number }[];

  return NextResponse.json({
    entries: entries.map(e => ({
      ...e,
      tags: safeJson<string[]>(e.tags, []),
      metadata: safeJson<Record<string, unknown>>(e.metadata, {}),
    })),
    months,
    categoryCounts,
    hasMore: entries.length === limit,
  });
}

// POST /api/journal - Create a journal entry
//
// Body: { content, date?, clientId?, timeZone?, category?, mood?, tags?, location?, useAI? }
// Send the same clientId when retrying: the entry is written at most once.
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "You're signed out. Sign in again to save." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
    if (!body || typeof body !== "object") throw new Error("not an object");
  } catch {
    return NextResponse.json({ error: "The request body must be JSON." }, { status: 400 });
  }

  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  let category = typeof body.category === "string" ? body.category : null;
  let mood = typeof body.mood === "string" ? body.mood : null;
  let tags: unknown = Array.isArray(body.tags) ? body.tags : undefined;

  // Optional model enrichment. Bounded and best-effort: the entry is saved
  // with the rule-based reading whatever the model does.
  if (body.useAI === true && !category) {
    try {
      const aiResponse = await complete(
        `Analyze this journal entry and return JSON with:
- category: one of [general, personal, work, health, travel, purchase, project, learning, social, maintenance]
- tags: array of 1-3 relevant tags
- mood: one of [great, good, neutral, low, bad] or null

Journal entry: ${JSON.stringify(content.slice(0, 4000))}

Respond with JSON only.`,
        { purpose: "Journal reflection", slot: "fast", userId: user.id, maxTokens: 200, temperature: 0.3 }
      );
      const parsed = JSON.parse(aiResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      if (typeof parsed?.category === "string") category = normalizeCategory(parsed.category);
      if (typeof parsed?.mood === "string") mood = parsed.mood;
      if (Array.isArray(parsed?.tags)) tags = normalizeTags(parsed.tags);
    } catch {
      // Rule-based categorization stands.
    }
  }

  try {
    const timeZone =
      (typeof body.timeZone === "string" ? body.timeZone : null) ??
      (await getStoredTimeZone(user.id));
    const result = await saveJournalEntry({
      userId: user.id,
      text: content,
      date: typeof body.date === "string" ? body.date : null,
      clientId: typeof body.clientId === "string" ? body.clientId : null,
      timeZone,
      category,
      mood,
      tags,
      location: typeof body.location === "string" ? body.location : null,
      metadata: { source: "journal" },
    });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof JournalInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[journal] save failed:", error);
    return NextResponse.json(
      { error: "The journal couldn't save right now. Your entry is kept on this device and will retry." },
      { status: 500 }
    );
  }
}
