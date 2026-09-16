#!/usr/bin/env tsx
/**
 * Diagnostic script to investigate why connections aren't showing in the knowledge graph
 *
 * This script checks:
 * 1. How many notes exist
 * 2. How many embeddings exist
 * 3. How many connections exist
 * 4. Processing queue status
 * 5. Sample of notes without connections
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🔍 KNOWLEDGE GRAPH CONNECTION DIAGNOSTIC\n');
  console.log('=' .repeat(60) + '\n');

  // 1. Count notes
  const notesResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM notes WHERE is_archived = 0',
    args: []
  });
  const noteCount = (notesResult.rows[0] as { count: number }).count;
  console.log(`📝 Total active notes: ${noteCount}`);

  // 2. Count embeddings for notes
  const embeddingsResult = await db.execute({
    sql: `SELECT COUNT(*) as count FROM embeddings WHERE entity_type = 'note'`,
    args: []
  });
  const embeddingCount = (embeddingsResult.rows[0] as { count: number }).count;
  console.log(`🧠 Note embeddings: ${embeddingCount} (${Math.round(embeddingCount/noteCount*100)}% of notes)`);

  // 3. Count connections
  const connectionsResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM note_connections',
    args: []
  });
  const connectionCount = (connectionsResult.rows[0] as { count: number }).count;
  console.log(`🔗 Total connections: ${connectionCount}\n`);

  // 4. Processing queue status
  console.log('📊 PROCESSING QUEUE STATUS\n');
  const queueResult = await db.execute({
    sql: `
      SELECT operation, status, COUNT(*) as count
      FROM processing_queue
      GROUP BY operation, status
      ORDER BY operation, status
    `,
    args: []
  });

  if (queueResult.rows.length === 0) {
    console.log('  No jobs in queue\n');
  } else {
    const queueStats = queueResult.rows as { operation: string; status: string; count: number }[];
    for (const stat of queueStats) {
      console.log(`  ${stat.operation.padEnd(25)} [${stat.status.padEnd(10)}]: ${stat.count}`);
    }
    console.log();
  }

  // 5. Check for pending connection jobs
  const pendingConnectionsResult = await db.execute({
    sql: `
      SELECT COUNT(*) as count
      FROM processing_queue
      WHERE operation = 'find_connections' AND status = 'pending'
    `,
    args: []
  });
  const pendingConnections = (pendingConnectionsResult.rows[0] as { count: number }).count;
  console.log(`⏳ Pending connection jobs: ${pendingConnections}\n`);

  // 6. Sample notes without embeddings
  const notesWithoutEmbeddings = await db.execute({
    sql: `
      SELECT n.id, n.title, n.word_count, n.created_at
      FROM notes n
      LEFT JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
      WHERE n.is_archived = 0 AND e.id IS NULL
      ORDER BY n.created_at DESC
      LIMIT 5
    `,
    args: []
  });

  if (notesWithoutEmbeddings.rows.length > 0) {
    console.log('📋 NOTES WITHOUT EMBEDDINGS (sample)\n');
    for (const note of notesWithoutEmbeddings.rows as any[]) {
      console.log(`  - ${note.title.substring(0, 50)} (${note.word_count} words, created ${note.created_at})`);
    }
    console.log();
  }

  // 7. Sample notes with embeddings but no connections
  const notesWithoutConnections = await db.execute({
    sql: `
      SELECT n.id, n.title, n.word_count, n.created_at
      FROM notes n
      INNER JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
      LEFT JOIN note_connections nc ON (nc.source_note_id = n.id OR nc.target_note_id = n.id)
      WHERE n.is_archived = 0 AND nc.id IS NULL
      ORDER BY n.created_at DESC
      LIMIT 10
    `,
    args: []
  });

  if (notesWithoutConnections.rows.length > 0) {
    console.log('🔍 NOTES WITH EMBEDDINGS BUT NO CONNECTIONS (sample)\n');
    for (const note of notesWithoutConnections.rows as any[]) {
      console.log(`  - ${note.title.substring(0, 50)} (${note.word_count} words)`);
    }
    console.log();
  }

  // 8. Check if embeddings table has the old schema (note_id instead of entity_id)
  const embeddingSchemaCheck = await db.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type='table' AND name='embeddings'`,
    args: []
  });
  const embeddingSchema = (embeddingSchemaCheck.rows[0] as any)?.sql || '';
  const hasOldSchema = embeddingSchema.includes('note_id');

  if (hasOldSchema) {
    console.log('⚠️  WARNING: Embeddings table uses old schema (note_id column)\n');
    console.log('   This may cause issues with the connection finding logic.\n');
  }

  // 9. Connection type breakdown
  if (connectionCount > 0) {
    console.log('📈 CONNECTION TYPE BREAKDOWN\n');
    const typeBreakdown = await db.execute({
      sql: `
        SELECT connection_type, discovery_method, COUNT(*) as count
        FROM note_connections
        GROUP BY connection_type, discovery_method
        ORDER BY count DESC
      `,
      args: []
    });
    for (const row of typeBreakdown.rows as any[]) {
      console.log(`  ${row.connection_type.padEnd(15)} (${row.discovery_method.padEnd(10)}): ${row.count}`);
    }
    console.log();
  }

  // 10. Summary and recommendations
  console.log('=' .repeat(60) + '\n');
  console.log('💡 DIAGNOSIS & RECOMMENDATIONS\n');

  if (noteCount === 0) {
    console.log('  ❌ No notes found. Create some notes first!\n');
  } else if (embeddingCount === 0) {
    console.log('  ⚠️  No embeddings generated yet.');
    console.log('     Run: npm run db:migrate && npx tsx scripts/process-queue.ts\n');
  } else if (embeddingCount < noteCount) {
    console.log(`  ⚠️  Only ${embeddingCount}/${noteCount} notes have embeddings.`);
    console.log('     Run: npx tsx scripts/process-queue.ts\n');
  } else if (connectionCount === 0) {
    console.log('  ⚠️  Embeddings exist but no connections created!');
    console.log('     This is the ROOT CAUSE of the empty knowledge graph.\n');

    if (pendingConnections === 0) {
      console.log('  🔧 FIX: Enqueue connection jobs with:');
      console.log('     npx tsx scripts/backfill-connections.ts\n');
      console.log('     Then run:');
      console.log('     npx tsx scripts/process-queue.ts\n');
    } else {
      console.log('  🔧 FIX: Process pending connection jobs:');
      console.log('     npx tsx scripts/process-queue.ts\n');
    }
  } else if (connectionCount < noteCount) {
    console.log(`  ⚙️  Connections exist (${connectionCount}) but may be incomplete.`);
    console.log('     Consider running backfill to ensure all notes are connected:');
    console.log('     npx tsx scripts/backfill-connections.ts\n');
  } else {
    console.log('  ✅ Connections look healthy!');
    console.log('     If the graph still appears empty, check:');
    console.log('     - Frontend graph component is loading data correctly');
    console.log('     - /api/graph endpoint returns data');
    console.log('     - Browser console for errors\n');
  }

  await db.close();
}

main().catch(console.error);
