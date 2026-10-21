/**
 * Process all pending jobs in the queue
 * Run with: npx tsx scripts/process-queue.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

interface Job {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  operation: string;
  tier: string;
  status: string;
  metadata: string | null;
}

interface Note {
  id: string;
  title: string;
  content: string;
}

interface Capture {
  id: string;
  user_id: string;
  daily_note_id: string | null;
  content: string;
  capture_type: string;
  captured_at: string;
  processed: boolean;
  linked_notes: string;
  linked_projects: string;
  tags: string;
  metadata: string;
  created_at: string;
}

async function getQueueStats() {
  const stats = await db.execute(`
    SELECT operation, status, COUNT(*) as count
    FROM processing_queue
    GROUP BY operation, status
    ORDER BY operation, status
  `);
  return stats.rows as unknown as { operation: string; status: string; count: number }[];
}

async function processEmbedding(job: Job): Promise<boolean> {
  // Dynamic import to avoid issues
  const { generateEmbedding, storeEmbedding } = await import("../src/lib/ai/embeddings");
  const { hashContent } = await import("../src/lib/processing/cache");

  // Get the note
  const noteResult = await db.execute({
    sql: "SELECT id, title, content FROM notes WHERE id = ?",
    args: [job.entity_id],
  });

  if (noteResult.rows.length === 0) {
    console.log(`    Note ${job.entity_id} not found, skipping`);
    return false;
  }

  const note = noteResult.rows[0] as unknown as Note;
  const text = `${note.title}\n\n${note.content}`;

  try {
    const embedding = await generateEmbedding(text);
    const contentHash = hashContent(text);
    await storeEmbedding(job.user_id, "note", job.entity_id, embedding, contentHash);
    return true;
  } catch (error) {
    console.error(`    Error generating embedding for ${note.title}:`, error);
    return false;
  }
}

async function processSummary(job: Job): Promise<boolean> {
  const { processSummary: genSummary } = await import("../src/lib/ai/tiers");

  // Get the note
  const noteResult = await db.execute({
    sql: "SELECT id, title, content FROM notes WHERE id = ?",
    args: [job.entity_id],
  });

  if (noteResult.rows.length === 0) {
    console.log(`    Note ${job.entity_id} not found, skipping`);
    return false;
  }

  const note = noteResult.rows[0] as unknown as Note;

  try {
    const result = await genSummary(job.user_id, note.title, note.content);

    // Update the note with the summary
    await db.execute({
      sql: "UPDATE notes SET summary = ? WHERE id = ?",
      args: [result.result, job.entity_id],
    });

    return true;
  } catch (error) {
    console.error(`    Error generating summary for ${note.title}:`, error);
    return false;
  }
}

async function processTags(job: Job): Promise<boolean> {
  const { processTags: genTags } = await import("../src/lib/ai/tiers");

  // Get the note
  const noteResult = await db.execute({
    sql: "SELECT id, title, content FROM notes WHERE id = ?",
    args: [job.entity_id],
  });

  if (noteResult.rows.length === 0) {
    console.log(`    Note ${job.entity_id} not found, skipping`);
    return false;
  }

  const note = noteResult.rows[0] as unknown as Note;

  try {
    const result = await genTags(job.user_id, note.title, note.content);

    // Update the note with auto_tags
    await db.execute({
      sql: "UPDATE notes SET auto_tags = ? WHERE id = ?",
      args: [JSON.stringify(result.result), job.entity_id],
    });

    return true;
  } catch (error) {
    console.error(`    Error generating tags for ${note.title}:`, error);
    return false;
  }
}

async function processConnections(job: Job): Promise<boolean> {
  console.log(`  🔗 Processing connections for note ${job.entity_id}`);

  try {
    const { findSimilarNotes } = await import("../src/lib/ai/embeddings");
    const { v4: uuidv4 } = await import("uuid");

    // Get source note
    const noteResult = await db.execute({
      sql: "SELECT id, title, content FROM notes WHERE id = ?",
      args: [job.entity_id],
    });

    if (noteResult.rows.length === 0) {
      console.log(`    Note ${job.entity_id} not found, skipping`);
      return false;
    }

    const sourceNote = noteResult.rows[0];

    // Delete existing auto-generated connections for this note (preserves manual connections)
    console.log(`    Cleaning up old auto-generated connections...`);
    await db.execute({
      sql: `DELETE FROM note_connections
            WHERE (source_note_id = ? OR target_note_id = ?)
            AND is_manual = FALSE
            AND user_id = ?`,
      args: [job.entity_id, job.entity_id, job.user_id]
    });

    // Find similar notes using embeddings (threshold 0.6 = moderately similar)
    console.log(`    Finding similar notes with embedding similarity...`);
    const similarNotes = await findSimilarNotes(
      job.user_id,
      job.entity_id,
      0.6, // Threshold for connection
      20   // Max connections
    );

    console.log(`    Found ${similarNotes.length} similar notes`);

    // Create connections for each similar note
    let connectionsCreated = 0;
    for (const similar of similarNotes) {
      try {
        const connectionId = uuidv4();
        await db.execute({
          sql: `INSERT OR IGNORE INTO note_connections
                (id, user_id, source_note_id, target_note_id,
                 connection_type, strength, embedding_similarity,
                 discovery_method, is_manual, created_at)
                VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE, datetime('now'))`,
          args: [
            connectionId,
            job.user_id,
            job.entity_id,
            similar.id,
            similar.similarity,
            similar.similarity
          ]
        });
        connectionsCreated++;
      } catch (error) {
        // Likely duplicate connection, ignore
        console.log(`      Skipped duplicate connection to ${similar.id}`);
      }
    }

    console.log(`    Created ${connectionsCreated} embedding-based connections`);

    // Process wikilinks if present in metadata
    const metadata = JSON.parse(job.metadata || '{}');
    if (metadata.wikilinks && Array.isArray(metadata.wikilinks)) {
      console.log(`    Processing ${metadata.wikilinks.length} wikilinks`);

      let wikilinksConnected = 0;
      for (const wikilink of metadata.wikilinks) {
        // Find target note by title or slug
        const targetNote = await db.execute({
          sql: `SELECT id FROM notes
                WHERE user_id = ?
                AND (title = ? OR slug = ?)
                AND id != ?`,
          args: [
            job.user_id,
            wikilink,
            wikilink.toLowerCase().replace(/\s+/g, '-'),
            job.entity_id
          ]
        });

        if (targetNote.rows.length > 0) {
          const targetId = targetNote.rows[0].id as string;
          try {
            const connectionId = uuidv4();
            await db.execute({
              sql: `INSERT OR IGNORE INTO note_connections
                    (id, user_id, source_note_id, target_note_id,
                     connection_type, strength, discovery_method, is_manual, created_at)
                    VALUES (?, ?, ?, ?, 'references', 1.0, 'wikilink', TRUE, datetime('now'))`,
              args: [connectionId, job.user_id, job.entity_id, targetId]
            });
            wikilinksConnected++;
            console.log(`      Connected to [[${wikilink}]]`);
          } catch (error) {
            // Duplicate, ignore
          }
        } else {
          console.log(`      Wikilink [[${wikilink}]] target not found`);
        }
      }

      console.log(`    Created ${wikilinksConnected} wikilink connections`);
    }

    // Mark note as having connections processed
    await db.execute({
      sql: `UPDATE notes SET processing_status = 'completed' WHERE id = ?`,
      args: [job.entity_id],
    });

    console.log(`  ✅ Connection processing complete (${connectionsCreated + (metadata.wikilinks?.length || 0)} total connections)`);
    return true;
  } catch (error) {
    console.error(`  ❌ Error processing connections:`, error);
    return false;
  }
}

/**
 * Attachment jobs run through the same handlers as the production cron, so
 * the two can never disagree about what a job does. Throws on failure.
 */
async function processAttachmentJob(job: Job): Promise<boolean> {
  const { runJob } = await import("../src/lib/processing/processors");
  await runJob(job);
  return true;
}

async function settleAttachment(job: Job): Promise<void> {
  if (job.entity_type !== "attachment") return;
  const { settleAttachmentStatus } = await import("../src/lib/processing/processors");
  await settleAttachmentStatus(job.entity_id).catch((error) =>
    console.error(`    Could not settle attachment ${job.entity_id}:`, error)
  );
}

async function processLinkScrapeAndEmbed(job: Job): Promise<boolean> {
  const { scrapeFullContent } = await import("../src/lib/services/link-scraper");
  const { generateEmbedding, storeEmbedding } = await import("../src/lib/ai/embeddings");
  const { hashContent } = await import("../src/lib/processing/cache");

  // Validate entity type
  if (job.entity_type !== "capture") {
    console.error(`    Invalid entity type for link-scrape-and-embed: ${job.entity_type}`);
    return false;
  }

  // Extract metadata from job
  const metadata = JSON.parse(job.metadata || '{}');
  const { captureId, url, userId } = metadata;

  if (!captureId || !url || !userId) {
    console.log(`    Missing required metadata (captureId, url, userId), skipping`);
    return false;
  }

  // Get the capture
  const captureResult = await db.execute({
    sql: "SELECT * FROM captures WHERE id = ?",
    args: [captureId],
  });

  if (captureResult.rows.length === 0) {
    console.log(`    Capture ${captureId} not found, skipping`);
    return false;
  }

  const capture = captureResult.rows[0] as unknown as Capture;

  try {
    // 1. Scrape full content
    console.log(`    Scraping content from ${url}...`);
    const scraped = await scrapeFullContent(url);

    // 2. Update capture metadata with scraped content
    const existingMetadata = JSON.parse(capture.metadata || '{}');
    const updatedMetadata = {
      ...existingMetadata,
      ...scraped
    };

    await db.execute({
      sql: "UPDATE captures SET metadata = ? WHERE id = ?",
      args: [JSON.stringify(updatedMetadata), captureId],
    });

    console.log(`    Scraped ${scraped.wordCount} words from ${scraped.title || url}`);

    // 3. Generate embedding from title + description + scraped content
    // Filter out empty values
    const embeddingText = [
      updatedMetadata.title,
      updatedMetadata.description,
      scraped.content
    ].filter(Boolean).join('\n\n');

    if (!embeddingText.trim()) {
      console.log(`    No text content to embed for ${captureId}, skipping embedding`);
      return true; // Not an error, just no content
    }

    console.log(`    Generating embedding for ${captureId}...`);
    const embedding = await generateEmbedding(embeddingText);
    const contentHash = hashContent(embeddingText);
    await storeEmbedding(userId, "capture", captureId, embedding, contentHash);

    console.log(`    Successfully processed link capture ${captureId}`);
    return true;
  } catch (error) {
    console.error(`    Error processing link capture ${captureId} (${url}):`, error);
    return false;
  }
}

async function markJobCompleted(jobId: string) {
  await db.execute({
    sql: "UPDATE processing_queue SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
    args: [jobId],
  });
}

async function markJobFailed(jobId: string, error: string) {
  await db.execute({
    sql: `UPDATE processing_queue
          SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'pending' END,
              error_message = ?,
              attempts = attempts + 1
          WHERE id = ?`,
    args: [error, jobId],
  });
}

async function processJobs(operation: string, limit: number = 50) {
  console.log(`\nProcessing ${operation} jobs (limit: ${limit})...`);

  const jobs = await db.execute({
    sql: `SELECT * FROM processing_queue
          WHERE operation = ? AND status = 'pending'
          ORDER BY priority DESC, scheduled_at ASC
          LIMIT ?`,
    args: [operation, limit],
  });

  const jobList = jobs.rows as unknown as Job[];
  console.log(`  Found ${jobList.length} jobs`);

  let success = 0;
  let failed = 0;

  for (const job of jobList) {
    // Mark as processing
    await db.execute({
      sql: "UPDATE processing_queue SET status = 'processing', started_at = datetime('now') WHERE id = ?",
      args: [job.id],
    });

    let result = false;
    try {
      switch (operation) {
        case "generate_embedding":
          // Attachment embeddings are a no-op there (see SERVERLESS_OPERATIONS)
          if (job.entity_type === "attachment") {
            result = await processAttachmentJob(job);
          } else {
            result = await processEmbedding(job);
          }
          break;
        case "generate_summary":
          result = await processSummary(job);
          break;
        case "generate_tags":
          result = await processTags(job);
          break;
        case "find_connections":
          result = await processConnections(job);
          break;
        case "scan_for_tasks": {
          const { scanForTasks } = await import("../src/lib/recommendations/scanner");
          const scanResult = await scanForTasks(
            job.user_id,
            job.entity_type,
            job.entity_id
          );
          console.log(`    Scanned ${job.entity_type}:${job.entity_id} - Found ${scanResult.recommendationCount} recommendations`);
          result = true;
          break;
        }
        case "extract_metadata":
          result = await processAttachmentJob(job);
          break;
        case "generate_thumbnail":
          result = await processAttachmentJob(job);
          break;
        case "extract_text":
          result = await processAttachmentJob(job);
          break;
        case "generate_description":
          result = await processAttachmentJob(job);
          break;
        case "link-scrape-and-embed":
          result = await processLinkScrapeAndEmbed(job);
          break;
        default:
          console.log(`    Unknown operation: ${operation}`);
      }

      if (result) {
        await markJobCompleted(job.id);
        success++;
        process.stdout.write(".");
      } else {
        await markJobFailed(job.id, "Processing returned false");
        failed++;
        process.stdout.write("x");
      }
    } catch (error) {
      await markJobFailed(job.id, String(error));
      failed++;
      process.stdout.write("x");
    }

    await settleAttachment(job);
  }

  console.log(`\n  Completed: ${success}, Failed: ${failed}`);
  return { success, failed };
}

async function main() {
  console.log("========================================");
  console.log("QUEUE PROCESSOR");
  console.log("========================================");

  // Show initial stats
  console.log("\nInitial queue status:");
  const initialStats = await getQueueStats();
  for (const row of initialStats) {
    console.log(`  ${row.operation} (${row.status}): ${row.count}`);
  }

  // Process attachment metadata (local - free)
  await processJobs("extract_metadata", 100);

  // Process attachment thumbnails (local - free)
  await processJobs("generate_thumbnail", 100);

  // Process attachment text extraction (embedding/fast_llm tier)
  await processJobs("extract_text", 50);

  // Process attachment descriptions (fast_llm tier)
  await processJobs("generate_description", 50);

  // Process link scraping and embeddings (embedding tier)
  await processJobs("link-scrape-and-embed", 50);

  // Process embeddings first (they're needed for connections)
  await processJobs("generate_embedding", 200);

  // Process summaries
  await processJobs("generate_summary", 100);

  // Process tags
  await processJobs("generate_tags", 100);

  // Process connections
  await processJobs("find_connections", 200);

  // Process task recommendations
  await processJobs("scan_for_tasks", 50);

  // Show final stats
  console.log("\n========================================");
  console.log("FINAL STATUS");
  console.log("========================================");
  const finalStats = await getQueueStats();
  for (const row of finalStats) {
    console.log(`  ${row.operation} (${row.status}): ${row.count}`);
  }

  // Update processing status on notes
  await db.execute(`
    UPDATE notes SET processing_status = 'completed'
    WHERE id IN (
      SELECT DISTINCT entity_id FROM processing_queue
      WHERE entity_type = 'note' AND status = 'completed'
    )
  `);

  // Update processing status on attachments
  await db.execute(`
    UPDATE attachments SET processing_status = 'completed'
    WHERE id IN (
      SELECT DISTINCT entity_id FROM processing_queue
      WHERE entity_type = 'attachment' AND status = 'completed'
    )
  `);

  console.log("\nDone!");
  await db.close();
}

main().catch(console.error);
