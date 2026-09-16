/**
 * Journal API - Agentic-first journaling
 *
 * GET: Fetch journal entries for a date, date range, or month
 * POST: Create a journal entry (auto-creates daily journal note if needed)
 *
 * The journal system transforms the daily note concept into an intuitive
 * journaling experience. Users just say "today I planted tomatoes" and
 * the system handles everything: creating entries, categorizing them,
 * and compiling monthly journals.
 */

import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import type { JournalEntry, Note } from "@/lib/db/schema";
import { format } from "date-fns";
import { v4 as uuid } from "uuid";
import { complete } from "@/lib/ai/client";

/**
 * AI-powered journal entry categorization and enrichment.
 * Detects category, mood, tags, and location from natural language.
 */
async function categorizeEntry(entryText: string): Promise<{
  category: string;
  tags: string[];
  mood: string | null;
  location: string | null;
  cleanedText: string;
  title: string;
}> {
  // Fast-path: rule-based detection for common patterns
  const lower = entryText.toLowerCase();

  const categoryPatterns: Array<{ pattern: RegExp; category: string }> = [
    { pattern: /\b(bought|purchased|ordered|paid|spent|cost|price|shopping)\b/, category: "purchase" },
    { pattern: /\b(visited|went to|traveled|trip|flew|drove to|road trip|vacation|hotel|airport)\b/, category: "travel" },
    { pattern: /\b(planted|gardened|watered|harvested|pruned|mowed|weeded|composted|fertilized)\b/, category: "maintenance" },
    { pattern: /\b(installed|fixed|repaired|replaced|upgraded|updated|maintained|cleaned|organized)\b/, category: "maintenance" },
    { pattern: /\b(cooked|ate|recipe|meal|breakfast|lunch|dinner|restaurant|cafe)\b/, category: "personal" },
    { pattern: /\b(workout|exercised|ran|jogged|gym|yoga|walked|hiked|swam|biked|weight|health|doctor|dentist|medicine)\b/, category: "health" },
    { pattern: /\b(learned|studied|read|course|tutorial|class|lecture|book|article|discovery)\b/, category: "learning" },
    { pattern: /\b(met with|meeting|call with|talked to|hung out|party|dinner with|coffee with|friends|family)\b/, category: "social" },
    { pattern: /\b(deployed|shipped|coded|built|debugged|released|merged|committed|sprint|standup)\b/, category: "work" },
    { pattern: /\b(project|milestone|launched|completed|finished|delivered)\b/, category: "project" },
  ];

  let detectedCategory = "general";
  for (const { pattern, category } of categoryPatterns) {
    if (pattern.test(lower)) {
      detectedCategory = category;
      break;
    }
  }

  // Detect mood from text
  const moodPatterns: Array<{ pattern: RegExp; mood: string }> = [
    { pattern: /\b(amazing|wonderful|fantastic|excited|thrilled|overjoyed|ecstatic)\b/, mood: "great" },
    { pattern: /\b(good|happy|pleased|satisfied|nice|enjoyed|glad|cheerful)\b/, mood: "good" },
    { pattern: /\b(okay|fine|alright|decent|not bad)\b/, mood: "neutral" },
    { pattern: /\b(tired|stressed|frustrated|annoyed|difficult|tough|hard|exhausted)\b/, mood: "low" },
    { pattern: /\b(terrible|awful|horrible|angry|upset|sad|depressed|anxious)\b/, mood: "bad" },
  ];

  let mood: string | null = null;
  for (const { pattern, mood: m } of moodPatterns) {
    if (pattern.test(lower)) {
      mood = m;
      break;
    }
  }

  // Extract tags from common nouns/activities
  const tagPatterns = [
    /\b(garden(?:ing)?|plants?|flowers?|vegetables?|herbs?)\b/i,
    /\b(cooking|baking|recipe)\b/i,
    /\b(exercise|fitness|running|yoga|gym)\b/i,
    /\b(reading|books?|article)\b/i,
    /\b(coding|programming|development)\b/i,
    /\b(shopping|groceries)\b/i,
    /\b(travel|vacation|trip)\b/i,
    /\b(meeting|work|office)\b/i,
    /\b(family|friends|social)\b/i,
    /\b(health|medical|doctor)\b/i,
    /\b(home improvement|renovation|repair)\b/i,
  ];

  const tags: string[] = [];
  for (const pattern of tagPatterns) {
    const match = lower.match(pattern);
    if (match) {
      tags.push(match[1].toLowerCase());
    }
  }

  // Generate a clean title from the entry
  const title = entryText
    .replace(/^(today i|i |this morning i|this afternoon i|this evening i|just )/i, "")
    .split(/[.\n]/)[0]
    ?.trim()
    .slice(0, 60) || entryText.slice(0, 60);

  return {
    category: detectedCategory,
    tags: [...new Set(tags)],
    mood,
    location: null, // Could be enhanced with location extraction
    cleanedText: entryText,
    title: title.charAt(0).toUpperCase() + title.slice(1),
  };
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
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200);
  const offset = parseInt(searchParams.get("offset") || "0");

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

  const [entriesResult, monthsResult, categoryResult] = await db.batch([
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
  ]);

  const entries = entriesResult.rows as unknown as (JournalEntry & { note_title: string; note_content: string })[];
  const months = monthsResult.rows as unknown as { month: string; count: number }[];
  const categoryCounts = categoryResult.rows as unknown as { category: string; count: number }[];

  return NextResponse.json({
    entries: entries.map(e => ({
      ...e,
      tags: typeof e.tags === "string" ? JSON.parse(e.tags || "[]") : e.tags,
      metadata: typeof e.metadata === "string" ? JSON.parse(e.metadata || "{}") : e.metadata,
    })),
    months,
    categoryCounts,
    hasMore: entries.length === limit,
  });
}

// POST /api/journal - Create a journal entry
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const {
    content,
    date: dateParam,
    category: categoryOverride,
    mood: moodOverride,
    location,
    tags: tagsOverride,
    useAI = false,
  } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  const date = dateParam || format(new Date(), "yyyy-MM-dd");
  const dateTitle = format(new Date(date + "T12:00:00"), "EEEE, MMMM d, yyyy");

  // Categorize the entry
  let categorization = await categorizeEntry(content);

  // Use AI for richer categorization if requested
  if (useAI) {
    try {
      const aiPrompt = `Analyze this journal entry and return JSON with:
- category: one of [general, personal, work, health, travel, purchase, project, learning, social, maintenance]
- tags: array of 1-3 relevant tags
- mood: one of [great, good, neutral, low, bad] or null
- title: a concise title (max 60 chars) summarizing the entry

Journal entry: "${content}"

Respond with JSON only.`;
      const aiResponse = await complete(aiPrompt, {
        slot: "fast",
        userId: user.id,
        maxTokens: 200,
        temperature: 0.3,
      });
      const cleaned = aiResponse.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const parsed = JSON.parse(cleaned);
      categorization = {
        ...categorization,
        category: parsed.category || categorization.category,
        tags: parsed.tags || categorization.tags,
        mood: parsed.mood || categorization.mood,
        title: parsed.title || categorization.title,
      };
    } catch {
      // Fall back to rule-based categorization
    }
  }

  // Apply overrides
  const finalCategory = categoryOverride || categorization.category;
  const finalMood = moodOverride || categorization.mood;
  const finalTags = tagsOverride || categorization.tags;

  // Find or create today's journal note
  const journalSlug = `journal-${date}`;
  let note = await queryOne<Note>(
    "SELECT * FROM notes WHERE user_id = ? AND slug = ?",
    [user.id, journalSlug]
  );

  if (!note) {
    // Create the journal note for this date
    const noteId = uuid();
    const initialContent = `# Journal - ${dateTitle}\n\n---\n\n### ${format(new Date(), "h:mm a")}\n${content}\n`;

    await db.execute({
      sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, note_type, metadata)
            VALUES (?, ?, ?, ?, ?, ?, 'journal', ?)`,
      args: [
        noteId,
        user.id,
        `Journal - ${dateTitle}`,
        journalSlug,
        initialContent,
        content,
        JSON.stringify({ journal_date: date }),
      ],
    });

    note = await queryOne<Note>("SELECT * FROM notes WHERE id = ?", [noteId]);
  } else {
    // Append to existing journal note
    const timestamp = format(new Date(), "h:mm a");
    const appendText = `\n\n### ${timestamp}\n${content}\n`;
    const newContent = (note.content || "") + appendText;
    const newPlain = (note.content_plain || "") + "\n" + content;

    await db.execute({
      sql: `UPDATE notes SET content = ?, content_plain = ?, updated_at = datetime('now') WHERE id = ?`,
      args: [newContent, newPlain, note.id],
    });
  }

  if (!note) {
    return NextResponse.json({ error: "Failed to create journal note" }, { status: 500 });
  }

  // Create the journal entry record
  const entryId = uuid();
  await db.execute({
    sql: `INSERT INTO journal_entries (id, note_id, user_id, date, entry_text, category, tags, mood, location, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      entryId,
      note.id,
      user.id,
      date,
      content,
      finalCategory,
      JSON.stringify(finalTags),
      finalMood,
      location || null,
      JSON.stringify({
        categorization,
        timestamp: new Date().toISOString(),
      }),
    ],
  });

  // Also create/update the daily_notes record for backward compatibility
  const existingDaily = await queryOne(
    "SELECT id FROM daily_notes WHERE user_id = ? AND date = ?",
    [user.id, date]
  );

  if (!existingDaily) {
    await db.execute({
      sql: `INSERT INTO daily_notes (user_id, date, note_id, metadata)
            VALUES (?, ?, ?, ?)`,
      args: [user.id, date, note.id, JSON.stringify({ is_journal: true })],
    });
  }

  return NextResponse.json({
    entry: {
      id: entryId,
      note_id: note.id,
      date,
      entry_text: content,
      category: finalCategory,
      tags: finalTags,
      mood: finalMood,
      title: categorization.title,
    },
    note: {
      id: note.id,
      title: note.title,
      slug: note.slug,
    },
  }, { status: 201 });
}
