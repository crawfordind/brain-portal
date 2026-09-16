import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { queryOne, queryAll, db } from "@/lib/db/client";
import {
  dequeue,
  completeJob,
  failJob,
  getQueueStats,
  cleanupOldJobs,
} from "@/lib/processing/queue";
import { embedNote } from "@/lib/ai/embeddings";
import { complete } from "@/lib/ai/client";
import type { Note, Capture, ProcessingJob } from "@/lib/db/schema";

// GET /api/process - Get queue stats
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  if (action === "stats") {
    const stats = await getQueueStats();
    return NextResponse.json({ stats });
  }

  // Get pending jobs for current user
  const pendingJobs = await queryAll<ProcessingJob>(
    `SELECT * FROM processing_queue
     WHERE user_id = ?
     AND status IN ('pending', 'processing')
     ORDER BY priority DESC, scheduled_at ASC
     LIMIT 50`,
    [user.id]
  );

  return NextResponse.json({ jobs: pendingJobs });
}

// POST /api/process - Process jobs or trigger processing
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { action, tier, maxJobs = 5 } = body;

    if (action === "run") {
      // Process pending jobs
      const results: { jobId: string; operation: string; success: boolean; error?: string }[] = [];
      let processed = 0;

      while (processed < maxJobs) {
        const job = await dequeue(tier);
        if (!job) break;

        try {
          await processJob(job);
          await completeJob(job.id);
          results.push({
            jobId: job.id,
            operation: job.operation,
            success: true,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          await failJob(job.id, errorMessage);
          results.push({
            jobId: job.id,
            operation: job.operation,
            success: false,
            error: errorMessage,
          });
        }

        processed++;
      }

      return NextResponse.json({
        success: true,
        processed,
        results,
      });
    }

    if (action === "cleanup") {
      const deleted = await cleanupOldJobs(7);
      return NextResponse.json({
        success: true,
        message: `Deleted ${deleted} old jobs`,
        deleted,
      });
    }

    return NextResponse.json(
      { error: "Invalid action. Use 'run' or 'cleanup'" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Process error:", error);
    return NextResponse.json(
      { error: "Failed to process jobs" },
      { status: 500 }
    );
  }
}

/**
 * Process a single job based on its operation type
 */
async function processJob(job: ProcessingJob): Promise<void> {
  switch (job.operation) {
    case "generate_embedding":
      await processEmbeddingJob(job);
      break;
    case "generate_summary":
      await processSummaryJob(job);
      break;
    case "generate_tags":
      await processTagsJob(job);
      break;
    case "find_connections":
      await processConnectionsJob(job);
      break;
    case "analyze_capture":
      await processAnalyzeCaptureJob(job);
      break;
    default:
      throw new Error(`Unknown operation: ${job.operation}`);
  }
}

async function processEmbeddingJob(job: ProcessingJob): Promise<void> {
  if (job.entity_type === "note") {
    const note = await queryOne<Note>(
      `SELECT id, title, content FROM notes WHERE id = ?`,
      [job.entity_id]
    );
    if (!note) throw new Error("Note not found");
    await embedNote(job.user_id, note.id, note.content, note.title);
  } else if (job.entity_type === "capture") {
    // Captures can also be embedded
    const capture = await queryOne<Capture>(
      `SELECT id, content FROM captures WHERE id = ?`,
      [job.entity_id]
    );
    if (!capture) throw new Error("Capture not found");
    await embedNote(job.user_id, capture.id, capture.content, "Capture");
  }
}

async function processSummaryJob(job: ProcessingJob): Promise<void> {
  const note = await queryOne<Note>(
    `SELECT id, title, content FROM notes WHERE id = ?`,
    [job.entity_id]
  );
  if (!note) throw new Error("Note not found");

  // Generate summary using LLM
  const summary = await complete(
    `Summarize this note in 1-2 sentences. Lead with the core point, then its significance. No preamble.\n\nTitle: ${note.title}\n\nContent:\n${note.content.substring(0, 2000)}`,
    {
      system: "Summarize notes. Output the summary only — no intro, no meta-commentary, no 'This note...' openings.",
      maxTokens: 150,
      temperature: 0.3,
    }
  );

  // Store summary
  await db.execute({
    sql: `UPDATE notes SET summary = ? WHERE id = ?`,
    args: [summary.trim(), note.id],
  });
}

async function processTagsJob(job: ProcessingJob): Promise<void> {
  const note = await queryOne<Note>(
    `SELECT id, title, content FROM notes WHERE id = ?`,
    [job.entity_id]
  );
  if (!note) throw new Error("Note not found");

  // Generate tags using LLM
  const response = await complete(
    `Extract 3-5 topic tags for this note. Tags should be specific enough to be useful for search and filtering — not generic. Return a JSON array of lowercase strings only.\n\nTitle: ${note.title}\n\nContent:\n${note.content.substring(0, 2000)}`,
    {
      system: "Extract topic tags. Output only a valid JSON array: [\"tag1\", \"tag2\"]. No explanation, no other text.",
      maxTokens: 100,
      temperature: 0.3,
    }
  );

  // Parse and store tags
  try {
    const tags = JSON.parse(response.trim());
    if (Array.isArray(tags)) {
      await db.execute({
        sql: `UPDATE notes SET auto_tags = ? WHERE id = ?`,
        args: [JSON.stringify(tags), note.id],
      });
    }
  } catch {
    // If parsing fails, try to extract tags from the response
    const tagMatch = response.match(/\[[\s\S]*\]/);
    if (tagMatch) {
      try {
        const tags = JSON.parse(tagMatch[0]);
        await db.execute({
          sql: `UPDATE notes SET auto_tags = ? WHERE id = ?`,
          args: [JSON.stringify(tags), note.id],
        });
      } catch {
        throw new Error("Failed to parse tags from response");
      }
    }
  }
}

async function processConnectionsJob(job: ProcessingJob): Promise<void> {
  const { findSimilarNotes } = await import("@/lib/ai/embeddings");
  const { v4: uuidv4 } = await import("uuid");

  // Get source note
  const note = await queryOne<Note>(
    "SELECT id, title, content FROM notes WHERE id = ?",
    [job.entity_id]
  );

  if (!note) {
    throw new Error("Note not found");
  }

  // Delete existing auto-generated connections (preserves manual connections)
  await db.execute({
    sql: `DELETE FROM note_connections
          WHERE (source_note_id = ? OR target_note_id = ?)
          AND is_manual = FALSE
          AND user_id = ?`,
    args: [job.entity_id, job.entity_id, job.user_id]
  });

  // Find similar notes using embeddings
  const similarNotes = await findSimilarNotes(
    job.user_id,
    job.entity_id,
    0.6, // Threshold
    20   // Max connections
  );

  // Batch-insert embedding connections
  if (similarNotes.length > 0) {
    const stmts = similarNotes.map(similar => ({
      sql: `INSERT OR IGNORE INTO note_connections
            (id, user_id, source_note_id, target_note_id,
             connection_type, strength, embedding_similarity,
             discovery_method, is_manual, created_at)
            VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE, datetime('now'))`,
      args: [
        uuidv4(),
        job.user_id,
        job.entity_id,
        similar.id,
        similar.similarity,
        similar.similarity
      ]
    }));
    await db.batch(stmts);
  }

  // Batch-resolve wikilinks in a single query instead of N+1
  const metadata = job.metadata ? JSON.parse(job.metadata) : {};
  if (metadata.wikilinks && Array.isArray(metadata.wikilinks) && metadata.wikilinks.length > 0) {
    const wikilinks: string[] = metadata.wikilinks;
    const titlePlaceholders = wikilinks.map(() => "?").join(",");
    const slugs = wikilinks.map((w: string) => w.toLowerCase().replace(/\s+/g, '-'));
    const slugPlaceholders = slugs.map(() => "?").join(",");

    const targetNotes = await queryAll<{ id: string }>(
      `SELECT id FROM notes
       WHERE user_id = ?
       AND (title IN (${titlePlaceholders}) OR slug IN (${slugPlaceholders}))
       AND id != ?`,
      [job.user_id, ...wikilinks, ...slugs, job.entity_id]
    );

    if (targetNotes.length > 0) {
      const stmts = targetNotes.map(target => ({
        sql: `INSERT OR IGNORE INTO note_connections
              (id, user_id, source_note_id, target_note_id,
               connection_type, strength, discovery_method, is_manual, created_at)
              VALUES (?, ?, ?, ?, 'references', 1.0, 'wikilink', TRUE, datetime('now'))`,
        args: [uuidv4(), job.user_id, job.entity_id, target.id]
      }));
      await db.batch(stmts);
    }
  }

  // Mark note as processed
  await db.execute({
    sql: `UPDATE notes SET processing_status = 'completed' WHERE id = ?`,
    args: [job.entity_id],
  });
}

async function processAnalyzeCaptureJob(job: ProcessingJob): Promise<void> {
  const capture = await queryOne<Capture>(
    `SELECT id, content, capture_type FROM captures WHERE id = ?`,
    [job.entity_id]
  );
  if (!capture) throw new Error("Capture not found");

  // Analyze capture and potentially reclassify
  const response = await complete(
    `Analyze this capture and determine its type. Return JSON with "type" (one of: thought, idea, followup, task, quote, reference) and "summary" (1 sentence).\n\nContent: ${capture.content}`,
    {
      system: "You are a helpful assistant. Output only valid JSON like {\"type\": \"idea\", \"summary\": \"...\"}.",
      maxTokens: 100,
      temperature: 0.3,
    }
  );

  try {
    const analysis = JSON.parse(response.trim());
    // Update capture if type changed
    if (analysis.type && analysis.type !== capture.capture_type) {
      await db.execute({
        sql: `UPDATE captures SET capture_type = ? WHERE id = ?`,
        args: [analysis.type, capture.id],
      });
    }
  } catch {
    // Ignore parsing errors for analysis
  }
}
