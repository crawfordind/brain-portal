#!/usr/bin/env tsx
/**
 * Test script to manually run connection finding for a single note
 * to see what's happening
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🧪 TESTING CONNECTION FINDING LOGIC\n');

  // Get a note with an embedding
  const noteResult = await db.execute({
    sql: `
      SELECT n.id, n.user_id, n.title, n.word_count
      FROM notes n
      INNER JOIN embeddings e ON e.entity_type = 'note' AND e.entity_id = n.id
      WHERE n.is_archived = 0
      ORDER BY n.word_count DESC
      LIMIT 1
    `,
    args: []
  });

  if (noteResult.rows.length === 0) {
    console.log('❌ No notes with embeddings found');
    process.exit(1);
  }

  const note = noteResult.rows[0] as { id: string; user_id: string; title: string; word_count: number };
  console.log(`📝 Testing with note: "${note.title}"`);
  console.log(`   ID: ${note.id}`);
  console.log(`   Word count: ${note.word_count}\n`);

  // Import the function
  const { findSimilarNotes } = await import("../src/lib/ai/embeddings");

  console.log('🔍 Finding similar notes (threshold: 0.6, limit: 20)...\n');

  try {
    const similarNotes = await findSimilarNotes(
      note.user_id,
      note.id,
      0.6,
      20
    );

    console.log(`✅ Found ${similarNotes.length} similar notes:\n`);

    if (similarNotes.length === 0) {
      console.log('⚠️  NO SIMILAR NOTES FOUND!');
      console.log('   This explains why no connections are being created.\n');

      // Try with a lower threshold
      console.log('🔍 Retrying with lower threshold (0.3)...\n');
      const similarNotes2 = await findSimilarNotes(
        note.user_id,
        note.id,
        0.3,
        20
      );

      console.log(`Found ${similarNotes2.length} notes with threshold 0.3:\n`);
      for (const sim of similarNotes2.slice(0, 10)) {
        console.log(`  - ${sim.title.substring(0, 50)} (similarity: ${sim.similarity.toFixed(3)})`);
      }

      if (similarNotes2.length === 0) {
        console.log('\n⚠️  EVEN WITH THRESHOLD 0.3, NO SIMILAR NOTES FOUND!');
        console.log('   Possible causes:');
        console.log('   1. Only one note has embeddings');
        console.log('   2. Embeddings are not semantically similar');
        console.log('   3. Bug in similarity calculation\n');

        // Check embedding count
        const embCount = await db.execute({
          sql: 'SELECT COUNT(*) as count FROM embeddings WHERE entity_type = ? AND user_id = ?',
          args: ['note', note.user_id]
        });
        const count = (embCount.rows[0] as { count: number }).count;
        console.log(`   Total note embeddings for this user: ${count}\n`);
      }
    } else {
      for (const sim of similarNotes) {
        console.log(`  - ${sim.title.substring(0, 50)} (similarity: ${sim.similarity.toFixed(3)})`);
      }

      console.log(`\n✅ Connection finding logic is working!`);
      console.log(`   ${similarNotes.length} connections would be created for this note.\n`);
    }

  } catch (error) {
    console.error('❌ Error finding similar notes:', error);
  }

  await db.close();
}

main().catch(console.error);
