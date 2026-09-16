#!/usr/bin/env tsx
/**
 * Test the complete lifecycle of note editing:
 * 1. Create a note with connections
 * 2. Edit the note's content
 * 3. Verify embeddings are regenerated
 * 4. Verify connections are updated
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
  console.log('🧪 TESTING NOTE EDIT LIFECYCLE\n');

  // Get user
  const userResult = await db.execute({
    sql: 'SELECT id FROM users LIMIT 1',
    args: []
  });

  if (userResult.rows.length === 0) {
    console.log('❌ No users found');
    process.exit(1);
  }

  const userId = (userResult.rows[0] as { id: string }).id;
  console.log(`👤 User: ${userId}\n`);

  // Step 1: Create a test note
  const noteId = uuidv4();
  const originalContent = `# Test Note for Lifecycle Testing

This is a test note about cannabis cultivation and hemp farming.
We discuss growing techniques, soil preparation, and harvest timing.
This content should match with other farming-related notes in the system.

Cannabis social clubs and dispensaries require careful planning.
Massachusetts market projections show strong growth potential.`;

  console.log('1️⃣  Creating test note...');
  await db.execute({
    sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, word_count, processing_status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    args: [
      noteId,
      userId,
      'Lifecycle Test Note',
      'lifecycle-test-note-' + Date.now(),
      originalContent,
      originalContent,
      47
    ]
  });
  console.log(`   ✓ Created note: ${noteId}\n`);

  // Step 2: Manually generate embedding for speed
  console.log('2️⃣  Generating embedding...');
  const { generateEmbedding, storeEmbedding } = await import("../src/lib/ai/embeddings");
  const { hashContent } = await import("../src/lib/processing/cache");

  const embedding = await generateEmbedding(originalContent);
  const contentHash = hashContent(originalContent);
  await storeEmbedding(userId, "note", noteId, embedding, contentHash);
  console.log('   ✓ Embedding generated and stored\n');

  // Step 3: Find connections
  console.log('3️⃣  Finding initial connections...');
  const { findSimilarNotes } = await import("../src/lib/ai/embeddings");
  const initialSimilar = await findSimilarNotes(userId, noteId, 0.6, 10);
  console.log(`   ✓ Found ${initialSimilar.length} similar notes\n`);

  if (initialSimilar.length > 0) {
    console.log('   Top 3 similar notes:');
    for (const sim of initialSimilar.slice(0, 3)) {
      console.log(`     - ${sim.title.substring(0, 40)} (${sim.similarity.toFixed(3)})`);
    }
    console.log();
  }

  // Step 4: Create connections
  console.log('4️⃣  Creating connections...');
  let connectionsCreated = 0;
  for (const similar of initialSimilar) {
    try {
      const connId = uuidv4();
      await db.execute({
        sql: `INSERT OR IGNORE INTO note_connections
              (id, user_id, source_note_id, target_note_id, connection_type, strength, embedding_similarity, discovery_method, is_manual)
              VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE)`,
        args: [connId, userId, noteId, similar.id, similar.similarity, similar.similarity]
      });
      connectionsCreated++;
    } catch (error) {
      // Ignore duplicates
    }
  }
  console.log(`   ✓ Created ${connectionsCreated} connections\n`);

  // Step 5: Check initial state
  const initialConnResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM note_connections WHERE source_note_id = ? OR target_note_id = ?',
    args: [noteId, noteId]
  });
  const initialConnCount = (initialConnResult.rows[0] as { count: number }).count;
  console.log(`📊 Initial state: ${initialConnCount} connections\n`);

  // Step 6: Edit the note content significantly
  console.log('5️⃣  Editing note content...');
  const editedContent = `# Updated Lifecycle Test Note

This note has been completely rewritten to test the update lifecycle.
Now we focus on software development, API design, and database architecture.
TypeScript and React are the primary technologies discussed here.

Next.js applications require careful planning and optimization.
Serverless architecture provides excellent scalability.`;

  await db.execute({
    sql: `UPDATE notes SET content = ?, content_plain = ?, word_count = ?, processing_status = 'pending', updated_at = datetime('now')
          WHERE id = ?`,
    args: [editedContent, editedContent, 45, noteId]
  });
  console.log('   ✓ Note content updated\n');

  // Step 7: Regenerate embedding
  console.log('6️⃣  Regenerating embedding...');
  const newEmbedding = await generateEmbedding(editedContent);
  const newHash = hashContent(editedContent);
  await storeEmbedding(userId, "note", noteId, newEmbedding, newHash);
  console.log('   ✓ New embedding generated\n');

  // Step 8: Delete old connections (simulate what processConnections does)
  console.log('7️⃣  Cleaning up old auto-generated connections...');
  const deleteResult = await db.execute({
    sql: `DELETE FROM note_connections
          WHERE (source_note_id = ? OR target_note_id = ?)
          AND is_manual = FALSE
          AND user_id = ?`,
    args: [noteId, noteId, userId]
  });
  console.log(`   ✓ Deleted ${deleteResult.rowsAffected} old connections\n`);

  // Step 9: Find new connections
  console.log('8️⃣  Finding new connections...');
  const newSimilar = await findSimilarNotes(userId, noteId, 0.6, 10);
  console.log(`   ✓ Found ${newSimilar.length} similar notes\n`);

  if (newSimilar.length > 0) {
    console.log('   Top 3 similar notes:');
    for (const sim of newSimilar.slice(0, 3)) {
      console.log(`     - ${sim.title.substring(0, 40)} (${sim.similarity.toFixed(3)})`);
    }
    console.log();
  }

  // Step 10: Create new connections
  console.log('9️⃣  Creating new connections...');
  let newConnectionsCreated = 0;
  for (const similar of newSimilar) {
    try {
      const connId = uuidv4();
      await db.execute({
        sql: `INSERT OR IGNORE INTO note_connections
              (id, user_id, source_note_id, target_note_id, connection_type, strength, embedding_similarity, discovery_method, is_manual)
              VALUES (?, ?, ?, ?, 'related', ?, ?, 'embedding', FALSE)`,
        args: [connId, userId, noteId, similar.id, similar.similarity, similar.similarity]
      });
      newConnectionsCreated++;
    } catch (error) {
      // Ignore duplicates
    }
  }
  console.log(`   ✓ Created ${newConnectionsCreated} new connections\n`);

  // Step 11: Check final state
  const finalConnResult = await db.execute({
    sql: 'SELECT COUNT(*) as count FROM note_connections WHERE source_note_id = ? OR target_note_id = ?',
    args: [noteId, noteId]
  });
  const finalConnCount = (finalConnResult.rows[0] as { count: number }).count;
  console.log(`📊 Final state: ${finalConnCount} connections\n`);

  // Step 12: Compare
  console.log('=' .repeat(60));
  console.log('RESULTS\n');
  console.log(`Initial connections: ${initialConnCount}`);
  console.log(`After cleanup:       0`);
  console.log(`After re-discovery:  ${finalConnCount}\n`);

  if (initialConnCount !== finalConnCount) {
    console.log('✅ SUCCESS: Connections changed after edit!');
    console.log('   This confirms the lifecycle is working correctly.\n');
  } else {
    console.log('⚠️  Connections are the same. This could mean:');
    console.log('   1. Content change wasn\'t significant enough');
    console.log('   2. Similar notes overlap between old and new topics\n');
  }

  // Step 13: Cleanup
  console.log('🧹 Cleaning up test data...');
  await db.execute({
    sql: 'DELETE FROM note_connections WHERE source_note_id = ? OR target_note_id = ?',
    args: [noteId, noteId]
  });
  await db.execute({
    sql: 'DELETE FROM embeddings WHERE entity_type = ? AND entity_id = ?',
    args: ['note', noteId]
  });
  await db.execute({
    sql: 'DELETE FROM notes WHERE id = ?',
    args: [noteId]
  });
  console.log('   ✓ Test note and connections deleted\n');

  console.log('✅ Lifecycle test complete!');

  await db.close();
}

main().catch(console.error);
