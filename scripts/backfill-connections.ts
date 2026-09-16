#!/usr/bin/env tsx
/**
 * Backfill script to create connections for existing notes
 *
 * This script:
 * 1. Finds all notes with embeddings
 * 2. Enqueues find_connections jobs for each note
 * 3. Processes the queue to generate connections
 *
 * Usage:
 *   tsx scripts/backfill-connections.ts [--user-id=<id>] [--dry-run]
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { extractWikilinks } from "../src/lib/processing/local";
import { v4 as uuidv4 } from "uuid";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

interface Note {
  id: string;
  user_id: string;
  title: string;
  content: string;
}

interface Embedding {
  note_id: string;
}

async function main() {
  const args = process.argv.slice(2);
  const userId = args.find(a => a.startsWith('--user-id='))?.split('=')[1];
  const dryRun = args.includes('--dry-run');

  console.log('🔗 Backfilling Note Connections\n');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`User filter: ${userId || 'ALL USERS'}\n`);

  // Step 1: Find notes with embeddings
  let sql = `
    SELECT DISTINCT n.id, n.user_id, n.title, n.content
    FROM notes n
    INNER JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
    WHERE n.is_archived = FALSE
  `;
  const args_query: string[] = [];

  if (userId) {
    sql += ' AND n.user_id = ?';
    args_query.push(userId);
  }

  sql += ' ORDER BY n.created_at ASC';

  const result = await db.execute({ sql, args: args_query });
  const notes = result.rows as unknown as Note[];

  console.log(`📊 Found ${notes.length} notes with embeddings\n`);

  if (notes.length === 0) {
    console.log('No notes to process. Exiting.');
    process.exit(0);
  }

  // Step 2: Check existing connections
  const existingResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM note_connections' + (userId ? ' WHERE user_id = ?' : ''),
    args: userId ? [userId] : []
  });
  const existingCount = (existingResult.rows[0] as { count: number }).count;
  console.log(`📈 Current connections: ${existingCount}\n`);

  if (dryRun) {
    console.log('DRY RUN - Would enqueue jobs for:');
    for (const note of notes.slice(0, 5)) {
      console.log(`  - ${note.title} (${note.id})`);
    }
    if (notes.length > 5) {
      console.log(`  ... and ${notes.length - 5} more`);
    }
    console.log('\nRun without --dry-run to execute.');
    process.exit(0);
  }

  // Step 3: Enqueue connection discovery jobs
  console.log('⏳ Enqueueing connection discovery jobs...\n');

  let enqueued = 0;
  for (const note of notes) {
    try {
      // Extract wikilinks from content
      const wikilinks = extractWikilinks(note.content || '');

      // Insert job directly into processing_queue
      const jobId = uuidv4();
      await db.execute({
        sql: `INSERT INTO processing_queue
              (id, user_id, entity_type, entity_id, operation, tier, priority, status, metadata, scheduled_at)
              VALUES (?, ?, 'note', ?, 'find_connections', 'embedding', 0, 'pending', ?, datetime('now'))`,
        args: [jobId, note.user_id, note.id, JSON.stringify({ wikilinks })]
      });

      enqueued++;
      if (enqueued % 10 === 0) {
        process.stdout.write(`  Enqueued ${enqueued}/${notes.length} jobs...\r`);
      }
    } catch (error) {
      console.error(`\n  ❌ Failed to enqueue job for ${note.title}:`, error);
    }
  }

  console.log(`\n✅ Enqueued ${enqueued} connection discovery jobs\n`);

  // Step 4: Instructions for processing
  console.log('📝 Next steps:\n');
  console.log('  Run the queue processor to create connections:');
  console.log('    tsx scripts/process-queue.ts\n');
  console.log('  Or use the API:');
  console.log('    POST http://localhost:3000/api/process\n');
  console.log('  Monitor progress:');
  console.log('    SELECT COUNT(*) FROM note_connections;\n');

  await db.close();
  process.exit(0);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
