import { NextRequest, NextResponse } from "next/server";
import { db, queryAll, queryOne, mutate } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth";
import { generateInsights } from "@/lib/ai/client";
import { Note, Capture, DailyNote, Insight } from "@/lib/db/schema";
import { findSimilarNotes, findSimilarToText, generateEmbedding } from "@/lib/ai/embeddings";
import {
  dedupeInsights,
  applyDiversityBudget,
  computeTypeFeedbackBias,
  rankInsights,
  DEFAULT_MAX_PER_TYPE,
} from "@/lib/ai/insight-quality";
import {
  getCached,
  setCache,
  generateCacheKey,
  hashContent,
} from "@/lib/processing/cache";
import { getCompiledGuardrails } from "@/lib/guardrails";

// POST /api/insights/generate - Generate AI insights from recent activity
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { focusNoteId, includeCaptures = true, daysBack: rawDaysBack = 7, skipCache = false } = body;
  const daysBack = Math.max(1, Math.min(90, Math.floor(Number(rawDaysBack)) || 7));

  // Get focus note if specified
  let focusNote: Note | null = null;
  if (focusNoteId) {
    focusNote = await queryOne<Note>(
      "SELECT * FROM notes WHERE id = ? AND user_id = ?",
      [focusNoteId, user.id]
    );
  }

  // Build a cache key based on the context
  const cacheInputs = {
    focusNoteId: focusNoteId || null,
    daysBack,
    includeCaptures,
  };

  // Check cache first (unless skipCache is true)
  const cacheKey = generateCacheKey("insights", cacheInputs);
  if (!skipCache) {
    const cachedInsights = await getCached<Insight[]>(user.id, cacheKey);
    if (cachedInsights) {
      return NextResponse.json({
        message: `Retrieved ${cachedInsights.length} cached insights`,
        insights: cachedInsights,
        cached: true,
      });
    }
  }

  // Use embeddings to find semantically related notes if we have a focus note
  let relevantNotes: Note[] = [];

  if (focusNote) {
    // Find notes similar to the focus note using embeddings
    try {
      const similarResults = await findSimilarNotes(user.id, focusNote.id, 0.55, 15);
      const similarIds = similarResults.map((r) => r.id);

      if (similarIds.length > 0) {
        relevantNotes = await queryAll<Note>(
          `SELECT id, title, content, note_type, created_at, updated_at
           FROM notes
           WHERE id IN (${similarIds.map(() => "?").join(",")})
           AND user_id = ?`,
          [...similarIds, user.id]
        );
      }
    } catch (embeddingError) {
      console.warn("Embedding search failed, falling back to recent notes:", embeddingError);
    }
  }

  // If no embedding results or no focus note, fall back to recent notes
  if (relevantNotes.length === 0) {
    relevantNotes = await queryAll<Note>(
      `SELECT id, title, content, note_type, created_at, updated_at
       FROM notes
       WHERE user_id = ? AND updated_at >= datetime('now', '-${daysBack} days')
       AND is_archived = FALSE
       ORDER BY updated_at DESC
       LIMIT 20`,
      [user.id]
    );
  }

  // Gather recent captures if requested
  let recentCaptures: Capture[] = [];
  if (includeCaptures) {
    recentCaptures = await queryAll<Capture>(
      `SELECT id, content, capture_type, captured_at
       FROM captures
       WHERE user_id = ? AND captured_at >= datetime('now', '-${daysBack} days') AND processed = 0
       ORDER BY captured_at DESC
       LIMIT 30`,
      [user.id]
    );
  }

  // Get recent daily notes for context
  const dailyNotes = await queryAll<DailyNote & { content: string; title: string }>(
    `SELECT dn.*, n.content, n.title
     FROM daily_notes dn
     JOIN notes n ON dn.note_id = n.id
     WHERE dn.user_id = ? AND dn.date >= date('now', '-${daysBack} days')
     ORDER BY dn.date DESC
     LIMIT 7`,
    [user.id]
  );

  if (relevantNotes.length === 0 && recentCaptures.length === 0) {
    return NextResponse.json({
      message: "Not enough content to generate insights",
      insights: [],
    });
  }

  try {
    // Format context for AI - use semantically relevant notes
    const context = {
      focusNote: focusNote
        ? { title: focusNote.title, content: focusNote.content }
        : null,
      recentNotes: relevantNotes.map((n) => {
        const text = n.content;
        const NOTE_CAP = 2000;
        let content: string;
        if (text.length <= NOTE_CAP) {
          content = text;
        } else {
          const head = text.slice(0, 1400);
          const tail = text.slice(-600);
          content = `${head}\n\n… [middle omitted] …\n\n${tail}`;
        }
        return { id: n.id, title: n.title, content, type: n.note_type };
      }),
      captures: recentCaptures.map((c) => ({
        id: c.id,
        content: c.content,
        type: c.capture_type,
      })),
      dailySummaries: dailyNotes.map((d) => ({
        date: d.date,
        content: d.content.substring(0, 500),
      })),
    };

    // Fetch user guardrails for personalized insights
    let guardrails: string | undefined;
    try {
      const compiled = await getCompiledGuardrails(user.id);
      if (compiled) guardrails = compiled;
    } catch {
      // Non-fatal
    }

    // Generate insights using AI
    const aiInsights = await generateInsights(context, { guardrails });

    // ── Quality pipeline: embed → semantic dedup → diversity budget → rank ──
    // 1. Embed each candidate so we can suppress near-duplicates (the engine
    //    used to re-derive the same idea from overlapping notes — biochar x6).
    const candidates = await Promise.all(
      aiInsights.map(async (insight) => {
        let embedding: number[] | undefined;
        try {
          embedding = await generateEmbedding(
            `${insight.title}\n\n${insight.content}`
          );
        } catch {
          embedding = undefined; // dedup keeps un-embeddable candidates
        }
        return { ...insight, embedding };
      })
    );

    // 2. Load recent existing insight vectors (stored in metadata.embedding).
    const recentExisting = await queryAll<{ id: string; metadata: string }>(
      `SELECT id, metadata FROM insights
       WHERE user_id = ? AND is_dismissed = 0
         AND generated_at >= datetime('now', '-45 days')
       ORDER BY generated_at DESC LIMIT 200`,
      [user.id]
    );
    const existingVectors = recentExisting.flatMap((row) => {
      try {
        const meta = JSON.parse(row.metadata || "{}");
        if (Array.isArray(meta.embedding) && meta.embedding.length > 0) {
          return [{ id: row.id, embedding: meta.embedding as number[] }];
        }
      } catch {
        /* ignore malformed metadata */
      }
      return [];
    });

    const { kept: deduped, suppressed } = dedupeInsights(
      candidates,
      existingVectors
    );

    // 3. Diversity budget: cap insights per theme so one hot topic can't crowd
    //    out the rest of the portfolio.
    const { kept: diverse } = applyDiversityBudget(deduped, DEFAULT_MAX_PER_TYPE);

    // 4. Feedback-aware ranking from the user's historical up/down votes.
    const feedbackRows = await queryAll<{
      insight_type: string;
      feedback: "up" | "down";
    }>(
      `SELECT insight_type, feedback FROM insights
       WHERE user_id = ? AND feedback IS NOT NULL`,
      [user.id]
    );
    const typeBias = computeTypeFeedbackBias(
      feedbackRows.map((r) => ({ type: r.insight_type, feedback: r.feedback }))
    );
    const ranked = rankInsights(diverse, typeBias);

    // Store surviving insights in database
    const storedInsights: Insight[] = [];
    for (const insight of ranked) {
      const sourceNotes = insight.sourceNoteIds ? JSON.stringify(insight.sourceNoteIds) : "[]";
      const sourceCaptures = insight.sourceCaptureIds ? JSON.stringify(insight.sourceCaptureIds) : "[]";
      // Persist the embedding so future runs can dedup against this insight.
      const metadata = JSON.stringify(
        insight.embedding ? { embedding: insight.embedding } : {}
      );

      const stored = await mutate<Insight>(
        `INSERT INTO insights (user_id, insight_type, title, content, source_notes, source_captures, confidence, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
        [
          user.id,
          insight.type,
          insight.title || "",
          insight.content,
          sourceNotes,
          sourceCaptures,
          insight.confidence,
          metadata,
        ]
      );
      if (stored) {
        storedInsights.push(stored);
      }
    }

    // Cache the generated insights for 24 hours
    if (storedInsights.length > 0) {
      await setCache(user.id, cacheKey, storedInsights, {
        operation: "generate_insights",
        tier: "full_llm",
        ttlHours: 24,
      });
    }

    return NextResponse.json({
      message: `Generated ${storedInsights.length} insights`,
      insights: storedInsights,
      suppressedDuplicates: suppressed.length,
      cached: false,
      usedEmbeddings: focusNote !== null && relevantNotes.length > 0,
    });
  } catch (error) {
    console.error("Insight generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate insights" },
      { status: 500 }
    );
  }
}
