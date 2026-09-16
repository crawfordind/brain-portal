/**
 * Queue job processors.
 *
 * These used to live only in `scripts/process-queue.ts`, a CLI with its own
 * libsql client. That meant embeddings, summaries and tags were only ever
 * produced when somebody ran the script by hand — in production the jobs were
 * enqueued and nothing ever picked them up. The handlers live here so the
 * Vercel cron (`/api/cron/process-queue`) can run them in production. The CLI
 * keeps its own copies for now because it also handles the attachment media
 * operations excluded below.
 *
 * Each handler throws on failure; the caller records the message on the job so
 * the reason a job failed survives in `processing_queue.error_message`.
 */

import { db, queryOne } from "@/lib/db/client";

export interface QueueJob {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  tier: string;
  metadata: string | null;
}

interface NoteRow {
  id: string;
  title: string;
  content: string;
}

/**
 * Operations this module can run inside a serverless function.
 *
 * Attachment media operations (`extract_metadata`, `generate_thumbnail`,
 * `extract_text`, `generate_description`) are deliberately absent: they pull in
 * sharp, pdf-parse, xlsx and the S3 client, none of which are declared as
 * `serverExternalPackages` in next.config.ts. Attachment *embeddings* are
 * excluded for a different reason: the `embeddings` table's CHECK constraint
 * only permits 'note', 'capture' and 'task_candidate', so an attachment vector
 * has nowhere to go until that schema is widened. All of it stays with the CLI
 * (`npx tsx scripts/process-queue.ts`).
 */
export const SERVERLESS_OPERATIONS = [
  "generate_embedding",
  "generate_summary",
  "generate_tags",
  "find_connections",
  "scan_for_tasks",
] as const;

async function getNote(entityId: string): Promise<NoteRow> {
  const note = await queryOne<NoteRow>(
    "SELECT id, title, content FROM notes WHERE id = ?",
    [entityId]
  );
  if (!note) {
    throw new Error(`Note ${entityId} not found`);
  }
  return note;
}

async function processNoteEmbedding(job: QueueJob): Promise<void> {
  const { generateEmbedding, storeEmbedding } = await import("@/lib/ai/embeddings");
  const { hashContent } = await import("@/lib/processing/cache");

  const note = await getNote(job.entity_id);
  const text = `${note.title}\n\n${note.content}`;

  const embedding = await generateEmbedding(text);
  await storeEmbedding(job.user_id, "note", job.entity_id, embedding, hashContent(text));
}

async function processSummary(job: QueueJob): Promise<void> {
  const { processSummary: genSummary } = await import("@/lib/ai/tiers");

  const note = await getNote(job.entity_id);
  const result = await genSummary(job.user_id, note.title, note.content);

  await db.execute({
    sql: "UPDATE notes SET summary = ? WHERE id = ?",
    args: [result.result, job.entity_id],
  });
}

async function processTags(job: QueueJob): Promise<void> {
  const { processTags: genTags } = await import("@/lib/ai/tiers");

  const note = await getNote(job.entity_id);
  const result = await genTags(job.user_id, note.title, note.content);

  await db.execute({
    sql: "UPDATE notes SET auto_tags = ? WHERE id = ?",
    args: [JSON.stringify(result.result), job.entity_id],
  });
}

async function processConnections(job: QueueJob): Promise<void> {
  const { findSimilarNotes } = await import("@/lib/ai/embeddings");
  const { v4: uuidv4 } = await import("uuid");

  await getNote(job.entity_id);

  // Drop the previous auto-generated set so a re-run reflects the current
  // content. Manual connections are left alone.
  await db.execute({
    sql: `DELETE FROM note_connections
          WHERE (source_note_id = ? OR target_note_id = ?)
          AND is_manual = FALSE
          AND user_id = ?`,
    args: [job.entity_id, job.entity_id, job.user_id],
  });

  const similarNotes = await findSimilarNotes(job.user_id, job.entity_id, 0.6, 20);

  for (const similar of similarNotes) {
    await db.execute({
      sql: `INSERT OR IGNORE INTO note_connections
            (id, user_id, source_note_id, target_note_id,
             connection_type, strength, embedding_similarity,
             discovery_method, is_manual, created_at)
            VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE, datetime('now'))`,
      args: [uuidv4(), job.user_id, job.entity_id, similar.id, similar.similarity, similar.similarity],
    });
  }

  const metadata = JSON.parse(job.metadata || "{}");
  if (Array.isArray(metadata.wikilinks)) {
    for (const wikilink of metadata.wikilinks) {
      if (typeof wikilink !== "string") continue;

      const target = await queryOne<{ id: string }>(
        `SELECT id FROM notes
         WHERE user_id = ? AND (title = ? OR slug = ?) AND id != ?`,
        [job.user_id, wikilink, wikilink.toLowerCase().replace(/\s+/g, "-"), job.entity_id]
      );
      if (!target) continue;

      await db.execute({
        sql: `INSERT OR IGNORE INTO note_connections
              (id, user_id, source_note_id, target_note_id,
               connection_type, strength, discovery_method, is_manual, created_at)
              VALUES (?, ?, ?, ?, 'references', 1.0, 'wikilink', TRUE, datetime('now'))`,
        args: [uuidv4(), job.user_id, job.entity_id, target.id],
      });
    }
  }

  await db.execute({
    sql: "UPDATE notes SET processing_status = 'completed' WHERE id = ?",
    args: [job.entity_id],
  });
}

const SCANNABLE_SOURCES = ["note", "daily_note", "capture"] as const;
type ScannableSource = (typeof SCANNABLE_SOURCES)[number];

function isScannableSource(value: string): value is ScannableSource {
  return (SCANNABLE_SOURCES as readonly string[]).includes(value);
}

async function processScanForTasks(job: QueueJob): Promise<void> {
  if (!isScannableSource(job.entity_type)) {
    throw new Error(`Cannot scan entity type '${job.entity_type}' for tasks`);
  }
  const { scanForTasks } = await import("@/lib/recommendations/scanner");
  await scanForTasks(job.user_id, job.entity_type, job.entity_id);
}

/**
 * Run one job. Throws with a descriptive message if the work fails, so the
 * caller can record it against the job rather than losing the reason.
 */
export async function runJob(job: QueueJob): Promise<void> {
  switch (job.operation) {
    case "generate_embedding":
      return processNoteEmbedding(job);
    case "generate_summary":
      return processSummary(job);
    case "generate_tags":
      return processTags(job);
    case "find_connections":
      return processConnections(job);
    case "scan_for_tasks":
      return processScanForTasks(job);
    default:
      throw new Error(`Operation '${job.operation}' is not handled by this worker`);
  }
}
