/**
 * Verify the link-scrape-and-embed job results
 * Run with: npx tsx scripts/verify-link-scrape.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function verifyResults() {
  console.log("========================================");
  console.log("VERIFY LINK SCRAPE RESULTS");
  console.log("========================================\n");

  // Find the test capture
  const captures = await db.execute({
    sql: "SELECT * FROM captures WHERE capture_type = 'link' ORDER BY created_at DESC LIMIT 1",
    args: [],
  });

  if (captures.rows.length === 0) {
    console.log("No link captures found.");
    await db.close();
    return;
  }

  const capture = captures.rows[0];
  console.log(`Capture ID: ${capture.id}`);
  console.log(`Content: ${capture.content}`);
  console.log(`\nMetadata:`);
  const metadata = JSON.parse(capture.metadata as string);
  console.log(JSON.stringify(metadata, null, 2));

  // Check if scrapedContent exists
  if (metadata.scrapedContent) {
    console.log("\n✓ Scraped content found:");
    console.log(`  - Title: ${metadata.title}`);
    console.log(`  - Description: ${metadata.description}`);
    console.log(`  - Word count: ${metadata.wordCount}`);
    console.log(`  - Scraped at: ${metadata.scrapedAt}`);
    console.log(`  - Content length: ${metadata.scrapedContent.length} characters`);
    console.log(`  - Content preview: ${metadata.scrapedContent.substring(0, 100)}...`);
  } else {
    console.log("\n✗ Scraped content NOT found");
  }

  // Check for embedding
  const embeddings = await db.execute({
    sql: "SELECT * FROM embeddings WHERE entity_type = 'capture' AND entity_id = ?",
    args: [capture.id],
  });

  if (embeddings.rows.length > 0) {
    console.log("\n✓ Embedding found:");
    const embedding = embeddings.rows[0];
    console.log(`  - Model: ${embedding.model}`);
    console.log(`  - Updated at: ${embedding.updated_at}`);
  } else {
    console.log("\n✗ Embedding NOT found (expected if OpenRouter API auth failed)");
  }

  // Check job status
  const jobs = await db.execute({
    sql: `SELECT * FROM processing_queue
          WHERE operation = 'link-scrape-and-embed'
          AND metadata LIKE ?
          ORDER BY scheduled_at DESC LIMIT 1`,
    args: [`%${capture.id}%`],
  });

  if (jobs.rows.length > 0) {
    const job = jobs.rows[0];
    console.log(`\nJob status: ${job.status}`);
    if (job.error_message) {
      console.log(`Error: ${job.error_message}`);
    }
  }

  await db.close();
}

verifyResults().catch(console.error);
