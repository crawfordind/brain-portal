#!/usr/bin/env tsx
/**
 * Repair FTS5 search index
 *
 * This script:
 * 1. Drops the corrupted notes_fts table
 * 2. Recreates it with proper schema
 * 3. Recreates all triggers
 * 4. Populates with existing notes
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function repairFTS() {
  console.log('🔧 Repairing FTS5 Search Index\n');

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    // Step 1: Drop existing FTS table and triggers
    console.log('1. Dropping corrupted FTS table and triggers...');
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_insert`);
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_delete`);
    await db.execute(`DROP TRIGGER IF EXISTS notes_fts_update`);
    await db.execute(`DROP TABLE IF EXISTS notes_fts`);
    console.log('   ✓ Dropped\n');

    // Step 2: Recreate FTS5 table
    console.log('2. Creating fresh FTS5 table...');
    await db.execute(`
      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        content_plain,
        content='notes',
        content_rowid='rowid'
      )
    `);
    console.log('   ✓ Created\n');

    // Step 3: Recreate triggers
    console.log('3. Creating synchronization triggers...');

    await db.execute(`
      CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, content_plain)
        VALUES (NEW.rowid, NEW.title, COALESCE(NEW.content_plain, ''));
      END
    `);

    await db.execute(`
      CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content_plain)
        VALUES('delete', OLD.rowid, OLD.title, COALESCE(OLD.content_plain, ''));
      END
    `);

    await db.execute(`
      CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content_plain)
        VALUES('delete', OLD.rowid, OLD.title, COALESCE(OLD.content_plain, ''));
        INSERT INTO notes_fts(rowid, title, content_plain)
        VALUES (NEW.rowid, NEW.title, COALESCE(NEW.content_plain, ''));
      END
    `);

    console.log('   ✓ Triggers created\n');

    // Step 4: Populate with existing notes
    console.log('4. Populating FTS5 index with existing notes...');
    const result = await db.execute(`
      INSERT INTO notes_fts(rowid, title, content_plain)
      SELECT rowid, title, COALESCE(content_plain, '') FROM notes
    `);
    console.log(`   ✓ Indexed ${result.rowsAffected} notes\n`);

    // Step 5: Verify
    console.log('5. Verifying index...');
    const count = await db.execute(`SELECT COUNT(*) as count FROM notes_fts`);
    const ftsCount = (count.rows[0] as { count: number }).count;
    const notesCount = await db.execute(`SELECT COUNT(*) as count FROM notes`);
    const totalNotes = (notesCount.rows[0] as { count: number }).count;

    console.log(`   Notes in database: ${totalNotes}`);
    console.log(`   Notes in FTS index: ${ftsCount}`);

    if (ftsCount === totalNotes) {
      console.log('   ✓ Index verified!\n');
    } else {
      console.log('   ⚠ Count mismatch - some notes may not be indexed\n');
    }

    console.log('✅ FTS5 repair complete!');
    console.log('\nYou can now test search at http://localhost:3000');

  } catch (error) {
    console.error('❌ Repair failed:', error);
    process.exit(1);
  } finally {
    await db.close();
  }
}

repairFTS().catch(console.error);
