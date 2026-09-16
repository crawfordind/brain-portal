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

  const columns = [
    {
      sql: "ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT",
      name: "recurrence_rule",
    },
    {
      sql: "ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT",
      name: "recurrence_end_date",
    },
    {
      sql: "ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL",
      name: "parent_task_id",
    },
  ];

  for (const col of columns) {
    try {
      await db.execute(col.sql);
      console.log(`Added tasks.${col.name}`);
    } catch (error: any) {
      if (error.message?.includes("duplicate column")) {
        console.log(`tasks.${col.name} already exists, skipping`);
      } else {
        console.error(`Failed to add ${col.name}:`, error);
        await db.close();
        process.exit(1);
      }
    }
  }

  console.log("\nRecurrence migration complete");
  await db.close();
}

migrate().catch(console.error);
