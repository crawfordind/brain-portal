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

  console.log("Running project collaborators migration...\n");

  const statements = [
    `CREATE TABLE IF NOT EXISTS project_collaborators (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('editor', 'viewer')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
      invited_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      invite_token TEXT,
      invite_expires_at TEXT,
      accepted_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(project_id, email)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_collab_project ON project_collaborators(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_user ON project_collaborators(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_email ON project_collaborators(email)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_token ON project_collaborators(invite_token)`,
  ];

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const statement of statements) {
    try {
      await db.execute(statement);
      successCount++;
      const match = statement.match(
        /(?:CREATE\s+(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i
      );
      if (match) {
        console.log(`  ${match[1]}`);
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes("already exists")) {
        skipCount++;
        const match = statement.match(
          /(?:CREATE\s+(?:TABLE|INDEX)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i
        );
        if (match) {
          console.log(`  ${match[1]} (exists)`);
        }
      } else {
        errorCount++;
        console.error(`  Error:`, err.message?.substring(0, 100));
      }
    }
  }

  console.log(`\nMigration complete!`);
  console.log(`  Created: ${successCount}`);
  console.log(`  Skipped: ${skipCount}`);
  if (errorCount > 0) {
    console.log(`  Errors: ${errorCount}`);
  }

  await db.close();
}

migrate().catch(console.error);
