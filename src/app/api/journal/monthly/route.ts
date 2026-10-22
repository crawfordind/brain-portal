/**
 * Monthly Journal API
 *
 * GET: Retrieve a monthly journal (compiled view of all entries for a month)
 * POST: Compile/recompile a monthly journal from daily entries
 */

import { NextRequest, NextResponse } from "next/server";
import { queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { JournalEntry, MonthlyJournal } from "@/lib/db/schema";
import { complete } from "@/lib/ai/client";
import { saveMonthlyJournal } from "@/lib/journal/store";

function parseTags(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((t): t is string => typeof t === "string");
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string") return (raw as T) ?? fallback;
  try {
    return JSON.parse(raw || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// GET /api/journal/monthly - Get monthly journal
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const searchParams = request.nextUrl.searchParams;
  const year = parseInt(searchParams.get("year") || new Date().getFullYear().toString());
  const month = parseInt(searchParams.get("month") || (new Date().getMonth() + 1).toString());

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
  }

  // Get the monthly journal record
  const monthlyJournal = await queryOne<MonthlyJournal & { note_content: string; note_title: string }>(
    `SELECT mj.*, n.content as note_content, n.title as note_title
     FROM monthly_journals mj
     LEFT JOIN notes n ON mj.note_id = n.id
     WHERE mj.user_id = ? AND mj.year = ? AND mj.month = ?`,
    [user.id, year, month]
  );

  // Get all entries for this month
  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const entries = await queryAll<JournalEntry>(
    `SELECT * FROM journal_entries
     WHERE user_id = ? AND date LIKE ? || '%'
     ORDER BY date ASC, created_at ASC`,
    [user.id, monthStr]
  );

  // Get category breakdown
  const categoryBreakdown = await queryAll<{ category: string; count: number }>(
    `SELECT category, COUNT(*) as count
     FROM journal_entries
     WHERE user_id = ? AND date LIKE ? || '%'
     GROUP BY category
     ORDER BY count DESC`,
    [user.id, monthStr]
  );

  // Get available months
  const availableMonths = await queryAll<{ year: number; month: number; count: number }>(
    `SELECT
       CAST(SUBSTR(date, 1, 4) AS INTEGER) as year,
       CAST(SUBSTR(date, 6, 2) AS INTEGER) as month,
       COUNT(*) as count
     FROM journal_entries
     WHERE user_id = ?
     GROUP BY SUBSTR(date, 1, 7)
     ORDER BY date DESC
     LIMIT 120`,
    [user.id]
  );

  return NextResponse.json({
    monthlyJournal: monthlyJournal ? {
      ...monthlyJournal,
      categories: parseJson<Record<string, number>>(monthlyJournal.categories, {}),
      highlights: parseJson<string[]>(monthlyJournal.highlights, []),
    } : null,
    entries: entries.map(e => ({
      ...e,
      tags: parseTags(e.tags),
    })),
    categoryBreakdown,
    availableMonths,
    month,
    year,
    monthName: MONTH_NAMES[month - 1],
  });
}

// POST /api/journal/monthly - Compile monthly journal
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) ?? {};
  } catch {
    body = {};
  }
  const year = Number(body.year) || new Date().getFullYear();
  const month = Number(body.month) || new Date().getMonth() + 1;
  const useAI = body.useAI !== false;

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Invalid year or month" }, { status: 400 });
  }

  const monthStr = `${year}-${String(month).padStart(2, "0")}`;
  const monthName = MONTH_NAMES[month - 1];

  // Get all entries for this month
  const entries = await queryAll<JournalEntry>(
    `SELECT * FROM journal_entries
     WHERE user_id = ? AND date LIKE ? || '%'
     ORDER BY date ASC, created_at ASC`,
    [user.id, monthStr]
  );

  if (entries.length === 0) {
    return NextResponse.json({
      error: "No journal entries found for this month",
    }, { status: 404 });
  }

  // Group entries by date
  const entriesByDate: Record<string, JournalEntry[]> = {};
  for (const entry of entries) {
    if (!entriesByDate[entry.date]) {
      entriesByDate[entry.date] = [];
    }
    entriesByDate[entry.date].push(entry);
  }

  // Build category stats
  const categoryStats: Record<string, number> = {};
  for (const entry of entries) {
    categoryStats[entry.category] = (categoryStats[entry.category] || 0) + 1;
  }

  // Compile the monthly journal content
  let compiledContent = `# ${monthName} ${year} Journal\n\n`;
  compiledContent += `*${entries.length} entries across ${Object.keys(entriesByDate).length} days*\n\n`;
  compiledContent += `---\n\n`;

  // Add entries grouped by date
  for (const [date, dayEntries] of Object.entries(entriesByDate)) {
    const dayDate = new Date(date + "T12:00:00");
    const dayName = dayDate.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    compiledContent += `## ${dayName}\n\n`;

    for (const entry of dayEntries) {
      const tags = parseTags(entry.tags);
      const categoryBadge = entry.category !== "general" ? ` \`${entry.category}\`` : "";
      const moodBadge = entry.mood ? ` *${entry.mood}*` : "";
      const tagStr = tags.length > 0 ? ` [${tags.join(", ")}]` : "";

      compiledContent += `- ${entry.entry_text}${categoryBadge}${moodBadge}${tagStr}\n`;
    }
    compiledContent += `\n`;
  }

  // Generate AI summary if requested
  let summary: string | null = null;
  let highlights: string[] = [];

  if (useAI) {
    try {
      const entrySummaries = entries
        .map(e => `[${e.date}] (${e.category}) ${e.entry_text}`)
        .join("\n");

      const prompt = `Analyze this month's journal entries and provide:
1. A 3-4 sentence summary of the month's highlights and themes
2. A list of 3-5 key highlights/milestones

Journal entries for ${monthName} ${year}:
${entrySummaries.substring(0, 6000)}

Respond in JSON:
{
  "summary": "...",
  "highlights": ["highlight 1", "highlight 2", ...]
}`;

      const response = await complete(prompt, {
        purpose: "Monthly journal",
        slot: "fast",
        userId: user.id,
        maxTokens: 500,
        temperature: 0.5,
      });

      const cleaned = response.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      summary = typeof parsed?.summary === "string" ? parsed.summary : null;
      highlights = Array.isArray(parsed?.highlights)
        ? parsed.highlights.filter((h: unknown): h is string => typeof h === "string")
        : [];

      // Add AI summary to the compiled content
      if (summary) {
        compiledContent += `---\n\n## Monthly Summary\n\n${summary}\n\n`;
      }
      if (highlights.length > 0) {
        compiledContent += `### Highlights\n\n`;
        for (const h of highlights) {
          compiledContent += `- ${h}\n`;
        }
        compiledContent += `\n`;
      }
    } catch {
      // Continue without AI summary
    }
  }

  // Add category breakdown
  compiledContent += `---\n\n### Categories\n\n`;
  for (const [cat, count] of Object.entries(categoryStats).sort((a, b) => b[1] - a[1])) {
    compiledContent += `- **${cat}**: ${count} entries\n`;
  }

  let noteId: string;
  try {
    ({ noteId } = await saveMonthlyJournal({
      userId: user.id,
      year,
      month,
      title: `${monthName} ${year} Journal`,
      content: compiledContent,
      entryCount: entries.length,
      summary,
      categories: categoryStats,
      highlights,
    }));
  } catch (error) {
    console.error("[journal] monthly compile save failed:", error);
    return NextResponse.json(
      { error: "The monthly journal couldn't be saved. Try again in a moment." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    noteId,
    month,
    year,
    monthName,
    entryCount: entries.length,
    daysWithEntries: Object.keys(entriesByDate).length,
    categories: categoryStats,
    summary,
    highlights,
  });
}
