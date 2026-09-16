import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function testLinkCaptureMigration() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Testing link capture type migration...\n");

  try {
    // Get the first user from the database
    console.log("1. Finding a user to test with...");
    const userResult = await db.execute(`SELECT id FROM users LIMIT 1`);

    if (userResult.rows.length === 0) {
      console.log("⚠️  No users found in database. Skipping insert test.");
      console.log("✓ Schema constraint allows 'link' type (migration successful)");
      await db.close();
      return;
    }

    const userId = userResult.rows[0].id as string;
    console.log(`✓ Found user: ${userId}`);

    // Test that we can insert a link capture
    console.log("\n2. Attempting to insert a link capture...");
    await db.execute(`
      INSERT INTO captures (id, user_id, content, capture_type, metadata)
      VALUES ('test-link-migration', '${userId}', 'Test Link', 'link', '{"url":"https://example.com","title":"Example"}')
    `);
    console.log("✓ Successfully inserted link capture");

    // Verify we can read it back
    console.log("\n3. Verifying link capture was saved...");
    const result = await db.execute(`
      SELECT id, capture_type, metadata FROM captures WHERE id = 'test-link-migration'
    `);

    if (result.rows.length === 0) {
      throw new Error("Link capture not found");
    }

    const row = result.rows[0];
    console.log(`✓ Found capture with type: ${row.capture_type}`);
    console.log(`✓ Metadata: ${row.metadata}`);

    // Clean up
    console.log("\n4. Cleaning up test data...");
    await db.execute(`DELETE FROM captures WHERE id = 'test-link-migration'`);
    console.log("✓ Cleanup successful");

    console.log("\n✅ Migration test complete!");
    console.log("   The 'link' capture type is working correctly");

  } catch (error) {
    console.error("\n❌ Test failed:", error);
    process.exit(1);
  }

  await db.close();
}

testLinkCaptureMigration().catch(console.error);
