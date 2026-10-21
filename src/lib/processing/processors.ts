/**
 * Queue job processors.
 *
 * These used to live only in `scripts/process-queue.ts`, a CLI with its own
 * libsql client. That meant embeddings, summaries and tags were only ever
 * produced when somebody ran the script by hand — in production the jobs were
 * enqueued and nothing ever picked them up. The handlers live here so the
 * Vercel cron (`/api/cron/process-queue`) can run them in production. The CLI
 * keeps its own copies of the note handlers and delegates attachment jobs here.
 *
 * Each handler throws on failure; the caller records the message on the job so
 * the reason a job failed survives in `processing_queue.error_message`.
 */

import { db, queryOne } from "@/lib/db/client";
import type { Attachment } from "@/lib/db/schema";
import { runWithAiUser } from "@/lib/ai/credentials/context";
import { jobPurpose } from "@/lib/ai/usage/types";

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
 * `extract_text`, `generate_description`) used to be excluded and left to the
 * CLI, so in production every upload queued three or four jobs nothing ever
 * ran: PDFs were never read, images never described, and the stranded jobs
 * counted toward the sweeper's backlog cap until note processing stopped too.
 * sharp, pdf-parse and xlsx are now `serverExternalPackages`, so they run here.
 *
 * Attachment *embeddings* are still not computed: the `embeddings` table's
 * CHECK constraint only permits 'note', 'capture' and 'task_candidate'.
 * Attachments are found by full-text search over their filename, description
 * and extracted text instead, and a leftover attachment `generate_embedding`
 * job completes as a no-op rather than sitting in the queue forever.
 */
export const SERVERLESS_OPERATIONS = [
  "generate_embedding",
  "generate_summary",
  "generate_tags",
  "find_connections",
  "scan_for_tasks",
  "extract-interactions",
  "extract_metadata",
  "generate_thumbnail",
  "extract_text",
  "generate_description",
] as const;

const ATTACHMENT_OPERATIONS = new Set([
  "extract_metadata",
  "generate_thumbnail",
  "extract_text",
  "generate_description",
]);

/**
 * sharp's prebuilt binaries cannot decode HEIC (the HEVC codec is not
 * bundled), so an iPhone photo can be stored and opened but not thumbnailed.
 * That is a property of the file, not a failure: retrying cannot change it, and
 * reporting it would raise a background-failure alert for every iPhone photo.
 */
async function unlessUndecodable<T>(attachment: Attachment, work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (attachment.mime_type === "image/heic" || attachment.mime_type === "image/heif") {
      return null;
    }
    throw error;
  }
}

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

  const embedding = await generateEmbedding(text, job.user_id);
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
 * New contacts and touch points from a note or capture.
 *
 * The operation name was reserved by the CRM Phase 0 migration, which widened
 * the queue's CHECK for it; `scripts/migrate.ts` now widens it too.
 */
async function processExtractInteractions(job: QueueJob): Promise<void> {
  if (job.entity_type !== "note" && job.entity_type !== "capture") {
    throw new Error(`Cannot extract contacts from entity type '${job.entity_type}'`);
  }
  const { extractContactsFromSource } = await import("@/lib/crm/auto-extract");
  // null means the row was deleted while queued: nothing left to read.
  await extractContactsFromSource(job.user_id, job.entity_type, job.entity_id);
}

/**
 * Run one job. Throws with a descriptive message if the work fails, so the
 * caller can record it against the job rather than losing the reason.
 */
export async function runJob(job: QueueJob): Promise<void> {
  // Everything this job calls is the job owner's work, paid by their own AI
  // key when they have one; see credentials/context.ts.
  return runWithAiUser(job.user_id, () => runJobForOwner(job), jobPurpose(job.operation));
}

async function runJobForOwner(job: QueueJob): Promise<void> {
  if (
    job.entity_type === "attachment" &&
    (ATTACHMENT_OPERATIONS.has(job.operation) || job.operation === "generate_embedding")
  ) {
    return processAttachmentJob(job);
  }

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
    case "extract-interactions":
      return processExtractInteractions(job);
    default:
      throw new Error(`Operation '${job.operation}' is not handled by this worker`);
  }
}

// ── Attachments ───────────────────────────────────────────────────────────

/**
 * `content_plain` is what full-text search reads: the description and the
 * extracted text together. Rebuilt in SQL so neither job overwrites the
 * other's half (the CLI version set it to the description alone, erasing a
 * PDF's text).
 */
const REFRESH_CONTENT_PLAIN = `content_plain = NULLIF(trim(
  COALESCE(description, '') || char(10) || char(10) || COALESCE(extracted_text, '')
), '')`;

async function processAttachmentJob(job: QueueJob): Promise<void> {
  if (!ATTACHMENT_OPERATIONS.has(job.operation)) {
    // Attachment embeddings: nowhere to store them (see SERVERLESS_OPERATIONS).
    return;
  }

  const attachment = await queryOne<Attachment>(
    "SELECT * FROM attachments WHERE id = ? AND user_id = ?",
    [job.entity_id, job.user_id]
  );
  // Deleted since it was queued: nothing left to do, and nothing failed.
  if (!attachment) return;

  const media = await import("@/lib/processing/attachments");

  switch (job.operation) {
    case "extract_metadata": {
      if (attachment.file_type !== "image") return;
      const buffer = await media.downloadAttachment(attachment);
      const metadata = await unlessUndecodable(attachment, () => media.extractImageMetadata(buffer));
      if (!metadata) return;
      await db.execute({
        sql: `UPDATE attachments SET metadata = json_patch(COALESCE(NULLIF(metadata, ''), '{}'), ?)
              WHERE id = ?`,
        args: [JSON.stringify(metadata), attachment.id],
      });
      return;
    }

    case "generate_thumbnail": {
      if (attachment.file_type !== "image") return;
      const buffer = await media.downloadAttachment(attachment);
      const thumbnail = await unlessUndecodable(attachment, () => media.generateThumbnail(buffer));
      if (!thumbnail) return;
      await db.execute({
        sql: `UPDATE attachments SET metadata = json_patch(COALESCE(NULLIF(metadata, ''), '{}'), ?)
              WHERE id = ?`,
        args: [JSON.stringify({ thumbnail }), attachment.id],
      });
      return;
    }

    case "extract_text": {
      const buffer = await media.downloadAttachment(attachment);
      const { text, metadata } = await media.extractTextContent(attachment, buffer);
      await db.execute({
        sql: `UPDATE attachments
              SET extracted_text = ?,
                  metadata = json_patch(COALESCE(NULLIF(metadata, ''), '{}'), ?)
              WHERE id = ?`,
        args: [text || null, JSON.stringify(metadata), attachment.id],
      });
      await db.execute({
        sql: `UPDATE attachments SET ${REFRESH_CONTENT_PLAIN} WHERE id = ?`,
        args: [attachment.id],
      });
      return;
    }

    case "generate_description": {
      if (attachment.file_type !== "image") return;
      // A description the user wrote is never replaced by a generated one
      if (attachment.description?.trim()) return;
      const buffer = await media.downloadAttachment(attachment);
      const description = await media.generateImageDescription(
        buffer,
        attachment.mime_type,
        job.user_id
      );
      if (!description) return;
      await db.execute({
        sql: `UPDATE attachments SET description = ?
              WHERE id = ? AND (description IS NULL OR trim(description) = '')`,
        args: [description, attachment.id],
      });
      await db.execute({
        sql: `UPDATE attachments SET ${REFRESH_CONTENT_PLAIN} WHERE id = ?`,
        args: [attachment.id],
      });
      return;
    }
  }
}

/**
 * Move an attachment out of 'pending' once none of its jobs is waiting or
 * running: 'failed' (with the reason) when one gave up, else 'completed'.
 * Call after a job's own status has been written.
 */
export async function settleAttachmentStatus(attachmentId: string): Promise<void> {
  await db.execute({
    sql: `UPDATE attachments
          SET processing_status = CASE WHEN EXISTS (
                SELECT 1 FROM processing_queue q
                WHERE q.entity_type = 'attachment' AND q.entity_id = attachments.id
                  AND q.status = 'failed'
              ) THEN 'failed' ELSE 'completed' END,
              processing_error = (
                SELECT q.error_message FROM processing_queue q
                WHERE q.entity_type = 'attachment' AND q.entity_id = attachments.id
                  AND q.status = 'failed'
                ORDER BY q.completed_at DESC LIMIT 1
              )
          WHERE id = ?
            AND NOT EXISTS (
              SELECT 1 FROM processing_queue q
              WHERE q.entity_type = 'attachment' AND q.entity_id = attachments.id
                AND q.status IN ('pending', 'processing')
            )`,
    args: [attachmentId],
  });
}
