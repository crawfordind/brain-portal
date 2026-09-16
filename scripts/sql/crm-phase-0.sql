-- ============================================================================
-- Brain Portal: CRM Phase 0 migration, as raw SQL for the Turso shell.
--
-- PREFER THE SCRIPT. `npm run migrate:crm-phase-0` does exactly this with
-- every step guarded, so it is safe to re-run and reports what it skipped.
-- This file exists for when you only have a SQL console.
--
--   turso db shell <your-db> < scripts/sql/crm-phase-0.sql
--
-- Sections 1 and 2 are safe to run any number of times.
-- Sections 3 and 4 REBUILD a table (SQLite cannot ALTER a CHECK constraint).
-- They are NOT safe to run twice, so each is preceded by a check query. Run the
-- check, and skip the section if it says SKIP.
-- ============================================================================


-- ============================================================================
-- 1. New tables and indexes. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS contact_channels (
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
  );

CREATE INDEX IF NOT EXISTS idx_contact_channels_lookup
      ON contact_channels(user_id, normalized_value);

CREATE INDEX IF NOT EXISTS idx_contact_channels_entity
      ON contact_channels(entity_id, kind);

CREATE TABLE IF NOT EXISTS interactions (
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
  );

CREATE INDEX IF NOT EXISTS idx_interactions_user_time
      ON interactions(user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_interactions_entity
      ON interactions(entity_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_interactions_venture
      ON interactions(venture_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_interactions_source
      ON interactions(source_type, source_id);

-- ============================================================================
-- 2. projects.venture_id. Safe to re-run, but the ADD COLUMN will report
--    "duplicate column name: venture_id" if it is already there. That error is
--    harmless; the CREATE INDEX after it still applies.
-- ============================================================================

ALTER TABLE projects ADD COLUMN venture_id TEXT REFERENCES entities(id);

CREATE INDEX IF NOT EXISTS idx_projects_venture ON projects(venture_id);


-- ============================================================================
-- 3. entity_edges rebuild: adds the CRM role vocabulary (partner,
--    collaborator, customer_of, ...) and a metadata column.
--
--    Without this, a contact cannot be given a role at a venture: the CHECK
--    constraint rejects every role edge type. `part_of` already exists, so
--    moving PRODUCTS between ventures works without it; attaching PEOPLE does
--    not.
--
--    CHECK FIRST -- run this one line:
--
--      SELECT CASE WHEN sql LIKE '%partner%' THEN 'SKIP section 3'
--                  ELSE 'RUN section 3' END
--      FROM sqlite_master WHERE type='table' AND name='entity_edges';
--
--    Existing rows are copied. Nothing references entity_edges by foreign key,
--    so the drop is safe.
-- ============================================================================

CREATE TABLE entity_edges_new (
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
  );

INSERT INTO entity_edges_new
   (id, user_id, source_entity_id, target_entity_id, edge_type, strength,
    reason, discovery_method, co_occurrence_count, metadata, created_at, updated_at)
  SELECT id, user_id, source_entity_id, target_entity_id, edge_type, strength,
        reason, discovery_method, co_occurrence_count, '{}', created_at, updated_at
  FROM entity_edges;

DROP TABLE entity_edges;

ALTER TABLE entity_edges_new RENAME TO entity_edges;

CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id);

CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id);

-- ============================================================================
-- 4. processing_queue rebuild: adds the two Phase 1 operations, so the rebuild
--    cost is paid once rather than again next phase. Nothing in Phase 0 needs
--    it, so this section is OPTIONAL right now -- but running it later means
--    rebuilding the table again.
--
--    CHECK FIRST -- run this one line:
--
--      SELECT CASE WHEN sql LIKE '%extract-interactions%' THEN 'SKIP section 4'
--                  ELSE 'RUN section 4' END
--      FROM sqlite_master WHERE type='table' AND name='processing_queue';
--
--    Queued and in-flight jobs are copied. Prefer a quiet moment: a job claimed
--    by a cron run mid-rebuild would be lost.
-- ============================================================================

CREATE TABLE processing_queue_new (
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
  );

INSERT INTO processing_queue_new
   (id, user_id, entity_type, entity_id, operation, tier, priority, status,
    attempts, max_attempts, error_message, scheduled_at, started_at,
    completed_at, metadata)
  SELECT id, user_id, entity_type, entity_id, operation, tier, priority, status,
        attempts, max_attempts, error_message, scheduled_at, started_at,
        completed_at, metadata
  FROM processing_queue;

DROP TABLE processing_queue;

ALTER TABLE processing_queue_new RENAME TO processing_queue;

CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_queue_entity ON processing_queue(entity_type, entity_id);


-- ============================================================================
-- 5. Verify. All five rows should read OK.
-- ============================================================================

SELECT 'contact_channels' AS check_name,
       CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END AS status
  FROM sqlite_master WHERE type='table' AND name='contact_channels'
UNION ALL
SELECT 'interactions',
       CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END
  FROM sqlite_master WHERE type='table' AND name='interactions'
UNION ALL
SELECT 'projects.venture_id',
       CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END
  FROM pragma_table_info('projects') WHERE name='venture_id'
UNION ALL
SELECT 'entity_edges roles',
       CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END
  FROM sqlite_master
 WHERE type='table' AND name='entity_edges' AND sql LIKE '%partner%'
UNION ALL
SELECT 'entity_edges.metadata',
       CASE WHEN COUNT(*) = 1 THEN 'OK' ELSE 'MISSING' END
  FROM pragma_table_info('entity_edges') WHERE name='metadata';
