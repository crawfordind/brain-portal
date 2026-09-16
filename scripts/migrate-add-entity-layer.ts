/**
 * Migration: Add the entity / knowledge layer
 *
 * The note-to-note graph now sits on top of a canonical entity graph:
 *   - entities         canonical people/orgs/places/projects/inputs
 *   - entity_aliases   surface variants that resolve to one entity
 *   - entity_mentions  where each entity was mentioned (for timelines)
 *   - entity_edges     typed relationships (supplies, funds, depends_on, ...)
 *
 * This is what lets the app reason about the *entity* instead of the string —
 * e.g. "Northwind" fragmented across 13 notes becomes one node with 13 mentions.
 *
 * Run with: npx tsx scripts/migrate-add-entity-layer.ts
 */

import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const STATEMENTS: { label: string; sql: string }[] = [
  {
    label: "entities table",
    sql: `CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'other'
        CHECK (entity_type IN ('person','org','place','project','input','product','other')),
      mention_count INTEGER DEFAULT 0,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, normalized_key)
    )`,
  },
  {
    label: "entity_aliases table",
    sql: `CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, normalized_key)
    )`,
  },
  {
    label: "entity_mentions table",
    sql: `CREATE TABLE IF NOT EXISTS entity_mentions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      snippet TEXT,
      occurred_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_id, source_type, source_id)
    )`,
  },
  {
    label: "entity_edges table",
    sql: `CREATE TABLE IF NOT EXISTS entity_edges (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL DEFAULT 'related'
        CHECK (edge_type IN ('related','supplies','funds','depends_on','blocks','located_in','works_with','same_as','part_of')),
      strength REAL DEFAULT 0.5,
      reason TEXT,
      discovery_method TEXT DEFAULT 'co_occurrence'
        CHECK (discovery_method IN ('co_occurrence','llm','manual')),
      co_occurrence_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_entity_id, target_entity_id, edge_type)
    )`,
  },
  {
    label: "idx_entities_user",
    sql: `CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id, mention_count DESC)`,
  },
  {
    label: "idx_entities_type",
    sql: `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(user_id, entity_type)`,
  },
  {
    label: "idx_entity_aliases_key",
    sql: `CREATE INDEX IF NOT EXISTS idx_entity_aliases_key ON entity_aliases(user_id, normalized_key)`,
  },
  {
    label: "idx_entity_mentions_entity",
    sql: `CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id, occurred_at)`,
  },
  {
    label: "idx_entity_mentions_source",
    sql: `CREATE INDEX IF NOT EXISTS idx_entity_mentions_source ON entity_mentions(source_type, source_id)`,
  },
  {
    label: "idx_entity_edges_source",
    sql: `CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id)`,
  },
  {
    label: "idx_entity_edges_target",
    sql: `CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id)`,
  },
];

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("Error: TURSO_DATABASE_URL is not defined");
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Adding entity / knowledge layer...\n");

  for (const { label, sql } of STATEMENTS) {
    process.stdout.write(`  ${label}... `);
    try {
      await db.execute(sql);
      console.log("✓");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists")) {
        console.log("already exists, skipping");
      } else {
        throw e;
      }
    }
  }

  console.log("\n✓ Entity layer migration complete.");
}

migrate().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
