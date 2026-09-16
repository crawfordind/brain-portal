#!/usr/bin/env tsx
/**
 * Test if we can manually insert a connection to debug the issue
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🧪 TESTING CONNECTION INSERT\n');

  // Get two notes with embeddings
  const notesResult = await db.execute({
    sql: `
      SELECT n.id, n.user_id, n.title
      FROM notes n
      INNER JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
      WHERE n.is_archived = 0
      ORDER BY n.created_at DESC
      LIMIT 2
    `,
    args: []
  });

  if (notesResult.rows.length < 2) {
    console.log('❌ Need at least 2 notes with embeddings');
    process.exit(1);
  }

  const note1 = notesResult.rows[0] as { id: string; user_id: string; title: string };
  const note2 = notesResult.rows[1] as { id: string; user_id: string; title: string };

  console.log(`📝 Note 1: ${note1.title}`);
  console.log(`📝 Note 2: ${note2.title}\n`);

  // Check if connection already exists
  const existingCheck = await db.execute({
    sql: `SELECT id FROM note_connections WHERE source_note_id = ? AND target_note_id = ?`,
    args: [note1.id, note2.id]
  });

  if (existingCheck.rows.length > 0) {
    console.log('⚠️  Connection already exists. Deleting it first...\n');
    await db.execute({
      sql: `DELETE FROM note_connections WHERE source_note_id = ? AND target_note_id = ?`,
      args: [note1.id, note2.id]
    });
  }

  // Try inserting with INSERT OR IGNORE (as used in process-queue.ts)
  console.log('🔧 Attempting INSERT OR IGNORE...\n');

  const connectionId = uuidv4();
  const insertSQL = `INSERT OR IGNORE INTO note_connections
        (id, user_id, source_note_id, target_note_id,
         connection_type, strength, embedding_similarity,
         discovery_method, is_manual, created_at)
        VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE, datetime('now'))`;

  console.log('SQL:', insertSQL);
  console.log('Args:', [
    connectionId,
    note1.user_id,
    note1.id,
    note2.id,
    0.75,  // strength
    0.75   // embedding_similarity
  ]);
  console.log();

  try {
    const result = await db.execute({
      sql: insertSQL,
      args: [
        connectionId,
        note1.user_id,
        note1.id,
        note2.id,
        0.75,  // strength
        0.75   // embedding_similarity
      ]
    });

    console.log('✅ INSERT executed successfully');
    console.log(`   Rows affected: ${result.rowsAffected}\n`);

    // Verify it was inserted
    const verifyResult = await db.execute({
      sql: `SELECT * FROM note_connections WHERE id = ?`,
      args: [connectionId]
    });

    if (verifyResult.rows.length > 0) {
      console.log('✅ Connection verified in database!');
      console.log('   Connection:', verifyResult.rows[0]);
    } else {
      console.log('❌ Connection NOT found in database after insert!');
      console.log('   This indicates INSERT OR IGNORE silently failed.\n');

      // Check for UNIQUE constraint
      const dupCheck = await db.execute({
        sql: `SELECT * FROM note_connections WHERE source_note_id = ? AND target_note_id = ?`,
        args: [note1.id, note2.id]
      });

      if (dupCheck.rows.length > 0) {
        console.log('   Found existing connection with same source/target:');
        console.log('   ', dupCheck.rows[0]);
      }
    }

  } catch (error) {
    console.error('❌ INSERT failed with error:', error);
  }

  // Check total connections
  const countResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM note_connections',
    args: []
  });
  const count = (countResult.rows[0] as { count: number }).count;
  console.log(`\n📊 Total connections in database: ${count}\n`);

  await db.close();
}

main().catch(console.error);
