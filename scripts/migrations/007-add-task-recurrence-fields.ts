import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function migrate() {
  console.log("Adding recurrence fields to tasks table...");

  const columns = [
    { sql: "ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT", name: "recurrence_rule" },
    { sql: "ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT", name: "recurrence_end_date" },
    { sql: "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL", name: "parent_task_id" },
  ];

  try {
    for (const col of columns) {
      try {
        await db.execute(col.sql);
        console.log(`Added ${col.name}`);
      } catch (error: any) {
        if (error.message?.includes("duplicate column")) {
          console.log(`${col.name} already exists, skipping`);
        } else {
          throw error;
        }
      }
    }

    // Add index for parent task chain lookups
    await db.execute(`
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
    `);
    console.log("Added index on parent_task_id");

    console.log("\nMigration complete");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  } finally {
    await db.close();
  }
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
