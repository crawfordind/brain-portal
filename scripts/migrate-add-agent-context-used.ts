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

  console.log("Adding context_used column to agent_tasks...");

  try {
    await db.execute(
      `ALTER TABLE agent_tasks ADD COLUMN context_used TEXT DEFAULT '[]'`
    );
    console.log("Done: agent_tasks.context_used added");
  } catch (error: any) {
    if (error.message?.includes("duplicate column")) {
      console.log("Column already exists, skipping");
    } else {
      console.error("Migration failed:", error);
      process.exit(1);
    }
  }

  await db.close();
}

migrate().catch(console.error);
