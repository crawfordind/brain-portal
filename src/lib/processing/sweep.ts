/**
 * The content sweeper: every note and capture gets processed, whoever wrote it.
 *
 * Processing used to be something each write path had to remember to ask for.
 * Three did (`POST /api/notes`, `PATCH /api/notes/[id]`, `POST /api/share`),
 * and even those never asked for tags. The MCP tools, `/api/brain`, the journal,
 * daily notes, the stream's Brain Bar, skills and weekly reviews wrote notes
 * that were never embedded, never connected, never tagged, and never read for
 * contacts. The MCP server cannot enqueue anything at all: it runs outside
 * Next.js against its own client.
 *
 * So instead of patching twenty insert sites, and the twenty-first someone
 * adds next month, the queue cron asks one question at the start of every run:
 * *what content has changed since it was last processed?* The answer is read
 * from the rows themselves, so it covers every writer, including ones that do
 * not exist yet. The same rule applies to the processing state the paths above
 * already queue for: `enqueue` skips a job that is already pending, so a note
 * those routes queued does not get its embedding twice.
 *
 * `content_index_state` remembers, per row, the content hash and the
 * `updated_at` it last swept. That is what keeps it cheap:
 *
 * - **An edit re-runs the pipeline; a pin does not.** Pinning, archiving or
 *   moving a note bumps `updated_at` without changing its text. The hash says
 *   so, and the row is marked current without spending a model call.
 * - **A failure is not retried forever.** State is written when the jobs are
 *   queued, not when they succeed. A job that fails exhausts its own retries
 *   and is reported by the system health check; the next edit tries again.
 * - **Mid-edit notes are left alone** until they have been quiet for
 *   `SETTLE_MINUTES`, so contacts are not extracted from half a sentence.
 * - **Backfill is automatic and bounded.** Rows with no state yet (everything
 *   written before this existed) are swept newest-first, a few per run, and
 *   never while the queue already has a backlog.
 */

import { db, queryAll } from "@/lib/db/client";
import { hashContent } from "./cache";
import { processLocally } from "./local";
import { enqueue, type QueueJobInput } from "./queue";
import { shouldExtractContacts } from "@/lib/crm/touches";

/**
 * Bump when the pipeline gains a step existing rows should get. The tag is
 * stored per row; a row whose tag differs is swept again, newest first.
 */
export const PIPELINE_VERSION = 1;

/** Notes and captures swept per cron run. Each note is up to five jobs. */
export const NOTE_SWEEP_LIMIT = 8;
export const CAPTURE_SWEEP_LIMIT = 8;

/** A note still being typed into is not ready to be read for contacts. */
export const SETTLE_MINUTES = 3;

/** Pending jobs above which the sweep yields, so it never outruns the drain. */
export const MAX_PENDING_BACKLOG = 60;

/** Word counts that make a job worth its model call. */
const MIN_WORDS_FOR_TAGS = 20;
const MIN_WORDS_FOR_SUMMARY = 50;
const MIN_WORDS_FOR_CONTACTS = 4;

export function pipelineTag(crmAvailable: boolean): string {
  return `${PIPELINE_VERSION}${crmAvailable ? "+crm" : ""}`;
}

export interface NoteRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  content_plain: string | null;
  note_type: string | null;
  source_actor: string | null;
  updated_at: string;
  indexed_hash: string | null;
  indexed_pipeline: string | null;
}

export interface CaptureRow {
  id: string;
  user_id: string;
  content: string;
  capture_type: string | null;
  source_actor: string | null;
  created_at: string;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** The text a note's embedding is computed from. Must match the processor. */
export function noteHashInput(note: Pick<NoteRow, "title" | "content">): string {
  return `${note.title}\n\n${note.content}`;
}

/**
 * The jobs a note needs. Pure: which steps run, and in what order, is decided
 * here and tested here.
 */
export function planNotePipeline(
  note: NoteRow,
  opts: { crmAvailable: boolean }
): QueueJobInput[] {
  const text = (note.content_plain?.trim() || note.content || "").trim();
  const words = countWords(`${note.title} ${text}`);
  if (!text && !note.title?.trim()) return [];

  const base = {
    userId: note.user_id,
    entityType: "note",
    entityId: note.id,
  } as const;

  // Priorities sit below the interactive routes' (1-2) so a note the user just
  // saved is not queued behind a backfill. The embedding outranks connections
  // because connections are found by comparing embeddings.
  const jobs: QueueJobInput[] = [
    { ...base, operation: "generate_embedding", tier: "embedding", priority: 0 },
    {
      ...base,
      operation: "find_connections",
      tier: "embedding",
      priority: -1,
      metadata: { wikilinks: processLocally(note.content || "").wikilinks },
    },
  ];

  if (words >= MIN_WORDS_FOR_TAGS) {
    jobs.push({ ...base, operation: "generate_tags", tier: "fast_llm", priority: -1 });
  }
  if (words > MIN_WORDS_FOR_SUMMARY) {
    jobs.push({ ...base, operation: "generate_summary", tier: "fast_llm", priority: -1 });
  }
  if (
    opts.crmAvailable &&
    words >= MIN_WORDS_FOR_CONTACTS &&
    shouldExtractContacts({
      entityType: "note",
      noteType: note.note_type,
      sourceActor: note.source_actor,
    })
  ) {
    jobs.push({ ...base, operation: "extract-interactions", tier: "fast_llm", priority: -1 });
  }

  return jobs;
}

/**
 * The jobs a capture needs. Only contacts: captures are searched by full text,
 * not by embedding, and their tags are set when they are classified.
 */
export function planCapturePipeline(
  capture: CaptureRow,
  opts: { crmAvailable: boolean }
): QueueJobInput[] {
  if (!opts.crmAvailable) return [];
  if (countWords(capture.content || "") < MIN_WORDS_FOR_CONTACTS) return [];
  if (
    !shouldExtractContacts({
      entityType: "capture",
      captureType: capture.capture_type,
      sourceActor: capture.source_actor,
    })
  ) {
    return [];
  }
  return [
    {
      userId: capture.user_id,
      entityType: "capture",
      entityId: capture.id,
      operation: "extract-interactions",
      tier: "fast_llm",
      priority: -1,
    },
  ];
}

export interface SweepResult {
  notesQueued: number;
  capturesQueued: number;
  /** Rows whose `updated_at` moved but whose content did not. */
  unchanged: number;
  jobsQueued: number;
  errors: number;
  /** Why nothing was swept, when nothing was. */
  skipped?: "backlog" | "not_migrated";
}

async function readCapabilities(): Promise<{
  hasStateTable: boolean;
  crmAvailable: boolean;
}> {
  const result = await db.execute({
    sql: `SELECT name, sql FROM sqlite_master
          WHERE type = 'table'
          AND name IN ('processing_queue', 'content_index_state', 'entities', 'interactions')`,
    args: [],
  });
  const tables = new Map<string, string>();
  for (const row of result.rows) {
    tables.set(String(row.name), String(row.sql ?? ""));
  }
  return {
    hasStateTable: tables.has("content_index_state"),
    // Contacts need the entity layer, the CRM tables, and a queue whose CHECK
    // admits the job. Without all three the job could only fail.
    crmAvailable:
      tables.has("entities") &&
      tables.has("interactions") &&
      (tables.get("processing_queue") ?? "").includes("'extract-interactions'"),
  };
}

async function pendingBacklog(): Promise<number> {
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM processing_queue
          WHERE status = 'pending' AND attempts < max_attempts`,
    args: [],
  });
  return Number(result.rows[0]?.n) || 0;
}

async function recordState(
  entityType: "note" | "capture",
  row: { id: string; user_id: string },
  contentHash: string,
  pipeline: string,
  sourceUpdatedAt: string
): Promise<void> {
  // `source_updated_at` is the row's own timestamp as read, never "now": an
  // edit landing between the read above and this write must still be newer
  // than what is recorded here, or it would be missed.
  await db.execute({
    sql: `INSERT INTO content_index_state
            (entity_type, entity_id, user_id, content_hash, pipeline, source_updated_at, swept_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(entity_type, entity_id) DO UPDATE SET
            content_hash = excluded.content_hash,
            pipeline = excluded.pipeline,
            source_updated_at = excluded.source_updated_at,
            swept_at = excluded.swept_at`,
    args: [entityType, row.id, row.user_id, contentHash, pipeline, sourceUpdatedAt],
  });
}

async function enqueueAll(jobs: QueueJobInput[]): Promise<{ queued: number; errors: number }> {
  let queued = 0;
  let errors = 0;
  for (const job of jobs) {
    try {
      await enqueue(job);
      queued++;
    } catch (error) {
      errors++;
      console.error(
        `[sweep] Could not queue ${job.operation} for ${job.entityType} ${job.entityId}:`,
        error
      );
    }
  }
  return { queued, errors };
}

/**
 * Queue processing for every note and capture that changed since it was last
 * swept. Never throws: the caller is the queue cron, and a failed sweep must
 * not stop it draining the jobs that are already queued.
 */
export async function sweepUnprocessedContent(
  opts: { noteLimit?: number; captureLimit?: number } = {}
): Promise<SweepResult> {
  const result: SweepResult = {
    notesQueued: 0,
    capturesQueued: 0,
    unchanged: 0,
    jobsQueued: 0,
    errors: 0,
  };

  try {
    const { hasStateTable, crmAvailable } = await readCapabilities();
    if (!hasStateTable) return { ...result, skipped: "not_migrated" };
    if ((await pendingBacklog()) >= MAX_PENDING_BACKLOG) {
      return { ...result, skipped: "backlog" };
    }

    const pipeline = pipelineTag(crmAvailable);

    // ── Notes ──
    const notes = await queryAll<NoteRow>(
      `SELECT n.id, n.user_id, n.title, n.content, n.content_plain, n.note_type,
              n.source_actor, n.updated_at,
              s.content_hash AS indexed_hash, s.pipeline AS indexed_pipeline
       FROM notes n
       LEFT JOIN content_index_state s
         ON s.entity_type = 'note' AND s.entity_id = n.id
       WHERE COALESCE(n.is_archived, 0) = 0
         AND datetime(n.updated_at) <= datetime('now', ?)
         AND (
           s.entity_id IS NULL
           OR s.pipeline IS NOT ?
           OR datetime(s.source_updated_at) < datetime(n.updated_at)
         )
       ORDER BY n.updated_at DESC
       LIMIT ?`,
      [`-${SETTLE_MINUTES} minutes`, pipeline, opts.noteLimit ?? NOTE_SWEEP_LIMIT]
    );

    for (const note of notes) {
      try {
        const hash = hashContent(noteHashInput(note));
        if (note.indexed_hash === hash && note.indexed_pipeline === pipeline) {
          await recordState("note", note, hash, pipeline, note.updated_at);
          result.unchanged++;
          continue;
        }

        const { queued, errors } = await enqueueAll(
          planNotePipeline(note, { crmAvailable })
        );
        result.jobsQueued += queued;
        result.errors += errors;
        await recordState("note", note, hash, pipeline, note.updated_at);
        result.notesQueued++;
      } catch (error) {
        result.errors++;
        console.error(`[sweep] Note ${note.id} could not be swept:`, error);
      }
    }

    // ── Captures ──
    //
    // Captures have no `updated_at`; one is written once and then converted or
    // archived, so "never swept" (or swept under an older pipeline) is the
    // whole test.
    const captures = await queryAll<CaptureRow>(
      `SELECT c.id, c.user_id, c.content, c.capture_type, c.source_actor, c.created_at
       FROM captures c
       LEFT JOIN content_index_state s
         ON s.entity_type = 'capture' AND s.entity_id = c.id
       WHERE (s.entity_id IS NULL OR s.pipeline IS NOT ?)
         AND datetime(c.created_at) <= datetime('now', '-1 minutes')
       ORDER BY c.created_at DESC
       LIMIT ?`,
      [pipeline, opts.captureLimit ?? CAPTURE_SWEEP_LIMIT]
    );

    for (const capture of captures) {
      try {
        const { queued, errors } = await enqueueAll(
          planCapturePipeline(capture, { crmAvailable })
        );
        result.jobsQueued += queued;
        result.errors += errors;
        await recordState(
          "capture",
          capture,
          hashContent(capture.content || ""),
          pipeline,
          capture.created_at
        );
        result.capturesQueued++;
      } catch (error) {
        result.errors++;
        console.error(`[sweep] Capture ${capture.id} could not be swept:`, error);
      }
    }
  } catch (error) {
    result.errors++;
    console.error("[sweep] Sweep failed:", error);
  }

  return result;
}
