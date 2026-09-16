/**
 * Run full Obsidian import
 * Usage: npx tsx scripts/run-import.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  // Get user
  const user = await db.execute("SELECT id FROM users LIMIT 1");
  const userId = user.rows[0].id as string;
  console.log("User ID:", userId);

  // Dynamic import after env is loaded
  const { importObsidianVault } = await import("../src/lib/import/obsidian");

  console.log("\nImporting all notes from Obsidian vault...");
  console.log("Path: /home/wicked/Documents/Personal Projects\n");

  const result = await importObsidianVault({
    vaultPath: "/home/wicked/Documents/Personal Projects",
    userId,
    mapFoldersToProjects: true,
    skipDuplicates: true,
    dryRun: false,
  });

  console.log("========================================");
  console.log("IMPORT COMPLETE");
  console.log("========================================");
  console.log("Imported:", result.imported);
  console.log("Skipped (duplicates):", result.skipped);
  console.log("Projects created:", result.projectsCreated.length);
  if (result.projectsCreated.length > 0) {
    console.log("  -", result.projectsCreated.join("\n  - "));
  }
  console.log("Errors:", result.errors.length);
  if (result.errors.length > 0) {
    console.log("Error details:");
    for (const err of result.errors.slice(0, 10)) {
      console.log("  -", err);
    }
  }

  // Show some imported notes
  if (result.notes.length > 0) {
    console.log("\nSample imported notes:");
    for (const note of result.notes.slice(0, 10)) {
      console.log(`  - ${note.title} (${note.folder})`);
    }
    if (result.notes.length > 10) {
      console.log(`  ... and ${result.notes.length - 10} more`);
    }
  }

  // Check queue status
  const queueStats = await db.execute(`
    SELECT operation, COUNT(*) as count
    FROM processing_queue
    WHERE status = 'pending'
    GROUP BY operation
  `);

  console.log("\nProcessing queue (pending jobs):");
  let totalPending = 0;
  for (const row of queueStats.rows) {
    const r = row as { operation: string; count: number };
    console.log("  ", r.operation + ":", r.count);
    totalPending += r.count;
  }
  console.log("  Total pending:", totalPending);

  // Check total notes in db
  const noteCount = await db.execute({
    sql: "SELECT COUNT(*) as count FROM notes WHERE user_id = ?",
    args: [userId],
  });
  console.log("\nTotal notes in database:", (noteCount.rows[0] as { count: number }).count);

  await db.close();
}

main().catch(console.error);
