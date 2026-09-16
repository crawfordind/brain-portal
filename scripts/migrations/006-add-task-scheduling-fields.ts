import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log("Adding scheduling fields to tasks table...");

  try {
    // Add scheduled_at field
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN scheduled_at TEXT;
    `);
    console.log("✓ Added scheduled_at");

    // Add estimated_completion_date field
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN estimated_completion_date TEXT;
    `);
    console.log("✓ Added estimated_completion_date");

    // Add estimation_accuracy field (JSON)
    await db.execute(`
      ALTER TABLE tasks ADD COLUMN estimation_accuracy TEXT;
    `);
    console.log("✓ Added estimation_accuracy");

    // Add index for scheduled tasks
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
    `);
    console.log("✓ Added index on scheduled_at");

    // Add index for estimated completion
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_estimated ON tasks(estimated_completion_date);
    `);
    console.log("✓ Added index on estimated_completion_date");

    console.log("\n✅ Migration complete");
  } catch (error) {
    console.error("❌ Migration failed:", error);
    throw error;
  } finally {
    await db.close();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
