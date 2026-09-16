/**
 * Test script for link-scrape-and-embed job handler
 * Run with: npx tsx scripts/test-link-scrape.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function testLinkScrapeAndEmbed() {
  console.log("========================================");
  console.log("LINK SCRAPE AND EMBED TEST");
  console.log("========================================\n");

  // Get first user for testing
  const userResult = await db.execute("SELECT id FROM users LIMIT 1");
  if (userResult.rows.length === 0) {
    console.error("No users found in database. Please create a user first.");
    return;
  }
  const userId = userResult.rows[0].id as string;
  console.log(`Using user: ${userId}\n`);

  // Create a test link capture
  const captureId = uuidv4();
  const testUrl = "https://www.example.com"; // Simple test URL
  const metadata = {
    url: testUrl,
    title: "Example Domain",
    description: "Example domain for testing",
  };

  console.log(`Creating test capture ${captureId}...`);
  await db.execute({
    sql: `INSERT INTO captures
          (id, user_id, content, capture_type, captured_at, processed, linked_notes, linked_projects, tags, metadata, created_at)
          VALUES (?, ?, ?, 'link', datetime('now'), FALSE, '[]', '[]', '[]', ?, datetime('now'))`,
    args: [captureId, userId, testUrl, JSON.stringify(metadata)],
  });
  console.log("Capture created.\n");

  // Create a processing queue job
  const jobId = uuidv4();
  const jobMetadata = {
    captureId,
    url: testUrl,
    userId,
  };

  console.log(`Creating processing queue job ${jobId}...`);
  await db.execute({
    sql: `INSERT INTO processing_queue
          (id, user_id, entity_type, entity_id, operation, tier, status, priority, max_attempts, attempts, metadata, scheduled_at)
          VALUES (?, ?, 'capture', ?, 'link-scrape-and-embed', 'embedding', 'pending', 50, 3, 0, ?, datetime('now'))`,
    args: [jobId, userId, captureId, JSON.stringify(jobMetadata)],
  });
  console.log("Job created.\n");

  console.log("Run the queue processor to process this job:");
  console.log("  npx tsx scripts/process-queue.ts\n");

  console.log("After processing, check the results:");
  console.log(`  - Capture metadata should have scrapedContent field`);
  console.log(`  - Embedding should exist in embeddings table for capture ${captureId}`);
  console.log(`  - Job status should be 'completed'\n`);

  console.log("Cleanup commands:");
  console.log(`  DELETE FROM captures WHERE id = '${captureId}';`);
  console.log(`  DELETE FROM embeddings WHERE entity_id = '${captureId}';`);
  console.log(`  DELETE FROM processing_queue WHERE id = '${jobId}';\n`);

  await db.close();
}

testLinkScrapeAndEmbed().catch(console.error);
