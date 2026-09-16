import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function cleanup() {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Cleaning up any lingering embeddings_old references...\n");

  try {
    // Try to drop the table if it exists
    await db.execute("DROP TABLE IF EXISTS embeddings_old");
    console.log("✓ Dropped embeddings_old (if it existed)");

    // Verify it's gone
    const check = await db.execute(`
      SELECT name FROM sqlite_master
      WHERE type='table' AND name='embeddings_old'
    `);

    if (check.rows.length === 0) {
      console.log("✓ Confirmed embeddings_old does not exist");
    } else {
      console.log("⚠️  embeddings_old still exists!");
    }

    // Note: ANALYZE and VACUUM are not supported by Turso HTTP API

    console.log("\n✅ Cleanup complete!");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }

  await db.close();
}

cleanup().catch(console.error);
