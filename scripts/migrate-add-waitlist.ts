import { db } from "@/lib/db/client";

async function migrate() {
  console.log("Creating waitlist table...");

  await db.execute(`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      email       TEXT NOT NULL UNIQUE,
      source      TEXT DEFAULT 'landing',
      status      TEXT DEFAULT 'pending',
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  console.log("✓ waitlist table ready");
}

migrate().catch(console.error);
