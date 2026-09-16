/**
 * CRM Phase 0 schema.
 *
 * The DDL lives here rather than inside the migration script so it can be
 * applied to an in-memory database by tests. `scripts/migrate-add-crm-phase-0.ts`
 * is a thin CLI over `applyCrmPhase0Migration`.
 *
 * Adds the two tables the entity graph cannot express, and widens three CHECK
 * constraints that block the design. See
 * docs/plans/2026-09-13-crm-phase-0-design.md.
 *
 *   1. contact_channels  how to reach an entity, and the inbound resolver
 *   2. interactions      what actually passed between us (vs. a mention, which
 *                        is only a reference in something the user wrote)
 *   3. entity_edges      rebuilt: CRM role vocabulary + a metadata column
 *   4. processing_queue  rebuilt: two Phase 1 operations added now so the
 *                        rebuild cost is paid once
 *   5. projects          plain ADD COLUMN venture_id (no CHECK, no rebuild)
 *
 * SQLite cannot ALTER a CHECK constraint, so 3 and 4 are create-copy-drop-rename
 * rebuilds. Each runs as one batch so a failure leaves nothing half-applied.
 * Nothing references either table by foreign key, so the rebuild is safe.
 *
 * Every step is guarded, so applying this twice is a no-op.
 */

import type { Client } from "@libsql/client";

export const CREATE_STATEMENTS: { label: string; sql: string }[] = [
  {
    label: "contact_channels table",
    sql: `CREATE TABLE IF NOT EXISTS contact_channels (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('email','phone','handle','url','address')),
      value TEXT NOT NULL,
      normalized_value TEXT NOT NULL,
      label TEXT,
      is_primary INTEGER DEFAULT 0,
      verified INTEGER DEFAULT 0,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, kind, normalized_value)
    )`,
  },
  {
    label: "idx_contact_channels_lookup",
    sql: `CREATE INDEX IF NOT EXISTS idx_contact_channels_lookup
          ON contact_channels(user_id, normalized_value)`,
  },
  {
    label: "idx_contact_channels_entity",
    sql: `CREATE INDEX IF NOT EXISTS idx_contact_channels_entity
          ON contact_channels(entity_id, kind)`,
  },
  {
    label: "interactions table",
    // venture_id is a SNAPSHOT written at insert time, never resolved by
    // walking the current part_of edge. Products move between ventures, and a
    // move must not rewrite the venture that past touches happened under.
    sql: `CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_id TEXT REFERENCES entities(id) ON DELETE CASCADE,
      venture_id TEXT REFERENCES entities(id) ON DELETE SET NULL,
      deal_id TEXT,
      direction TEXT NOT NULL DEFAULT 'in'
        CHECK (direction IN ('in','out','internal')),
      channel TEXT NOT NULL DEFAULT 'note'
        CHECK (channel IN ('email','call','sms','dm','meeting','event','note','other')),
      occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
      subject TEXT,
      body TEXT,
      source_type TEXT,
      source_id TEXT,
      dedup_key TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, dedup_key)
    )`,
  },
  {
    label: "idx_interactions_user_time",
    sql: `CREATE INDEX IF NOT EXISTS idx_interactions_user_time
          ON interactions(user_id, occurred_at DESC)`,
  },
  {
    label: "idx_interactions_entity",
    sql: `CREATE INDEX IF NOT EXISTS idx_interactions_entity
          ON interactions(entity_id, occurred_at DESC)`,
  },
  {
    label: "idx_interactions_venture",
    sql: `CREATE INDEX IF NOT EXISTS idx_interactions_venture
          ON interactions(venture_id, occurred_at DESC)`,
  },
  {
    label: "idx_interactions_source",
    sql: `CREATE INDEX IF NOT EXISTS idx_interactions_source
          ON interactions(source_type, source_id)`,
  },
];

/** Widened edge_type vocabulary plus a metadata column. */
export const ENTITY_EDGES_REBUILD = [
  `CREATE TABLE entity_edges_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    edge_type TEXT NOT NULL DEFAULT 'related' CHECK (edge_type IN (
      'related','supplies','funds','depends_on','blocks','located_in',
      'works_with','same_as','part_of',
      'partner','collaborator','customer_of','member_of',
      'advisor_to','investor_in','employed_by','reports_to','contact_at'
    )),
    strength REAL DEFAULT 0.5,
    reason TEXT,
    discovery_method TEXT DEFAULT 'co_occurrence'
      CHECK (discovery_method IN ('co_occurrence','llm','manual')),
    co_occurrence_count INTEGER DEFAULT 0,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(source_entity_id, target_entity_id, edge_type)
  )`,
  `INSERT INTO entity_edges_new
     (id, user_id, source_entity_id, target_entity_id, edge_type, strength,
      reason, discovery_method, co_occurrence_count, metadata, created_at, updated_at)
   SELECT id, user_id, source_entity_id, target_entity_id, edge_type, strength,
          reason, discovery_method, co_occurrence_count, '{}', created_at, updated_at
   FROM entity_edges`,
  `DROP TABLE entity_edges`,
  `ALTER TABLE entity_edges_new RENAME TO entity_edges`,
  `CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id)`,
  `CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id)`,
];

/** Two Phase 1 operations added now so this table is rebuilt only once. */
export const PROCESSING_QUEUE_REBUILD = [
  `CREATE TABLE processing_queue_new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN (
      'generate_embedding', 'generate_summary', 'generate_tags',
      'find_connections', 'analyze_capture', 'recompute_all',
      'scan_for_tasks', 'link-scrape-and-embed',
      'extract_metadata', 'generate_thumbnail', 'extract_text', 'generate_description',
      'create-org-from-capture', 'extract-interactions'
    )),
    tier TEXT NOT NULL CHECK (tier IN ('local', 'embedding', 'fast_llm', 'full_llm')),
    priority INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    scheduled_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    metadata TEXT DEFAULT '{}'
  )`,
  `INSERT INTO processing_queue_new
     (id, user_id, entity_type, entity_id, operation, tier, priority, status,
      attempts, max_attempts, error_message, scheduled_at, started_at,
      completed_at, metadata)
   SELECT id, user_id, entity_type, entity_id, operation, tier, priority, status,
          attempts, max_attempts, error_message, scheduled_at, started_at,
          completed_at, metadata
   FROM processing_queue`,
  `DROP TABLE processing_queue`,
  `ALTER TABLE processing_queue_new RENAME TO processing_queue`,
  `CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, scheduled_at)`,
  `CREATE INDEX IF NOT EXISTS idx_queue_entity ON processing_queue(entity_type, entity_id)`,
];

export interface MigrationStep {
  label: string;
  status: "applied" | "skipped";
}

/**
 * Apply the Phase 0 schema changes. Idempotent: each step checks whether it has
 * already run, so a re-run reports every step as "skipped" and changes nothing.
 */
export async function applyCrmPhase0Migration(
  db: Client,
  log: (message: string) => void = () => {}
): Promise<MigrationStep[]> {
  const steps: MigrationStep[] = [];

  for (const { label, sql } of CREATE_STATEMENTS) {
    // Every statement here is CREATE ... IF NOT EXISTS, so this is already safe
    // to repeat; the existence check only makes the report honest.
    const existed = await objectExists(db, label);
    await db.execute(sql);
    steps.push({ label, status: existed ? "skipped" : "applied" });
    log(`  ${label}... ${existed ? "already exists, skipping" : "ok"}`);
  }

  if (await columnExists(db, "entity_edges", "metadata")) {
    steps.push({ label: "entity_edges rebuild", status: "skipped" });
    log("  entity_edges... already widened, skipping");
  } else {
    await db.batch(ENTITY_EDGES_REBUILD, "write");
    steps.push({ label: "entity_edges rebuild", status: "applied" });
    log("  entity_edges... rebuilt");
  }

  if (await ddlContains(db, "processing_queue", "extract-interactions")) {
    steps.push({ label: "processing_queue rebuild", status: "skipped" });
    log("  processing_queue... already widened, skipping");
  } else {
    await db.batch(PROCESSING_QUEUE_REBUILD, "write");
    steps.push({ label: "processing_queue rebuild", status: "applied" });
    log("  processing_queue... rebuilt");
  }

  if (await columnExists(db, "projects", "venture_id")) {
    steps.push({ label: "projects.venture_id", status: "skipped" });
    log("  projects.venture_id... already exists, skipping");
  } else {
    await db.execute(
      `ALTER TABLE projects ADD COLUMN venture_id TEXT REFERENCES entities(id)`
    );
    steps.push({ label: "projects.venture_id", status: "applied" });
    log("  projects.venture_id... ok");
  }

  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_projects_venture ON projects(venture_id)`
  );

  return steps;
}

/** Does the table or index this statement creates already exist? */
async function objectExists(db: Client, label: string): Promise<boolean> {
  const name = label.replace(/ (table|index)$/, "");
  const res = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

export async function columnExists(
  db: Client,
  table: string,
  column: string
): Promise<boolean> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  return info.rows.some((row) => row.name === column);
}

/** True when the table's stored DDL already mentions `needle`. */
export async function ddlContains(
  db: Client,
  table: string,
  needle: string
): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [table],
  });
  const ddl = res.rows[0]?.sql;
  return typeof ddl === "string" && ddl.includes(needle);
}
