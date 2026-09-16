import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding generic delegation columns to agent_tasks...");

  const columns = [
    {
      sql: `ALTER TABLE agent_tasks ADD COLUMN source_type TEXT DEFAULT 'task'`,
      name: "source_type",
    },
    {
      sql: `ALTER TABLE agent_tasks ADD COLUMN source_id TEXT`,
      name: "source_id",
    },
  ];

  for (const col of columns) {
    try {
      await db.execute(col.sql);
      console.log(`Done: agent_tasks.${col.name} added`);
    } catch (error: any) {
      if (error.message?.includes("duplicate column")) {
        console.log(`Column ${col.name} already exists, skipping`);
      } else {
        console.error(`Migration failed for ${col.name}:`, error);
        process.exit(1);
      }
    }
  }

  // Backfill source_type and source_id from task_id for existing records
  try {
    await db.execute(
      `UPDATE agent_tasks SET source_type = 'task', source_id = task_id WHERE task_id IS NOT NULL AND source_id IS NULL`
    );
    console.log("Backfilled source_type/source_id from existing task_id records");
  } catch (error: any) {
    console.warn("Backfill warning:", error.message);
  }

  // Create index for source entity lookups
  try {
    await db.execute(
      `CREATE INDEX IF NOT EXISTS idx_agent_tasks_source ON agent_tasks(source_type, source_id)`
    );
    console.log("Created index on agent_tasks(source_type, source_id)");
  } catch (error: any) {
    console.warn("Index creation warning:", error.message);
  }

  await db.close();
  console.log("Migration complete.");
}

migrate().catch(console.error);
