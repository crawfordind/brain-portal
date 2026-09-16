import { createClient } from "@libsql/client";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

async function migrate() {
  if (!process.env.TURSO_DATABASE_URL) {
    // This runs as `prebuild`, so a hard exit here means `npm run build` fails
    // on any machine without database credentials — including CI, which only
    // needs to know the code compiles. Skip instead, loudly. A real deployment
    // sets the variable and gets the migration; nobody gets a silent no-op
    // they mistook for a successful migration.
    if (process.env.SKIP_MIGRATIONS === "true" || process.env.CI === "true") {
      console.warn(
        "TURSO_DATABASE_URL is not set — skipping migrations.\n" +
          "This is expected in CI. Set it before deploying."
      );
      return;
    }

    console.error("Error: TURSO_DATABASE_URL is not defined");
    console.error(
      "Copy .env.example to .env.local and fill it in, or set " +
        "SKIP_MIGRATIONS=true to build without a database."
    );
    process.exit(1);
  }

  const db = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  console.log("Running migrations...\n");

  // Execute each statement individually for better error handling
  const statements = [
    // Users & Auth
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT UNIQUE NOT NULL,
      display_name TEXT,
      avatar_url TEXT,
      preferences TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS magic_links (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      email TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    // Projects
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'planning', 'stalled', 'completed', 'archived')),
      color TEXT DEFAULT '#6366f1',
      icon TEXT DEFAULT 'folder',
      priority INTEGER DEFAULT 0,
      parent_id TEXT REFERENCES projects(id),
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    )`,

    // Notes
    `CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      slug TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      content_plain TEXT,
      note_type TEXT DEFAULT 'note' CHECK (note_type IN ('note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal')),
      is_pinned INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      word_count INTEGER DEFAULT 0,
      frontmatter TEXT DEFAULT '{}',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    )`,

    // Daily Notes
    `CREATE TABLE IF NOT EXISTS daily_notes (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      morning_focus TEXT,
      reflection TEXT DEFAULT '{}',
      mood INTEGER CHECK (mood BETWEEN 1 AND 5),
      energy INTEGER CHECK (energy BETWEEN 1 AND 5),
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, date)
    )`,

    // Weekly Reviews
    `CREATE TABLE IF NOT EXISTS weekly_reviews (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      week_number INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      summary TEXT,
      stats TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, year, week_number)
    )`,

    // Journal Entries
    `CREATE TABLE IF NOT EXISTS journal_entries (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      entry_text TEXT NOT NULL,
      category TEXT DEFAULT 'general' CHECK (category IN ('general', 'personal', 'work', 'health', 'travel', 'purchase', 'project', 'learning', 'social', 'maintenance')),
      tags TEXT DEFAULT '[]',
      mood TEXT,
      location TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    // Monthly Journals
    `CREATE TABLE IF NOT EXISTS monthly_journals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      entry_count INTEGER DEFAULT 0,
      summary TEXT,
      categories TEXT DEFAULT '{}',
      highlights TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      compiled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, year, month)
    )`,

    // Tasks
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT REFERENCES notes(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      due_date TEXT,
      scheduled_at TEXT,
      estimated_completion_date TEXT,
      completed_at TEXT,
      estimation_accuracy TEXT,
      position INTEGER DEFAULT 0,
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      title TEXT,
      description TEXT,
      delegated_to TEXT,
      agent_task_id TEXT,
      linked_note_ids TEXT DEFAULT '[]',
      recurrence_rule TEXT,
      recurrence_end_date TEXT,
      parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    // Task Recommendations
    `CREATE TABLE IF NOT EXISTS task_recommendations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL CHECK (source_type IN ('note', 'daily_note', 'capture')),
      source_id TEXT NOT NULL,
      source_text TEXT NOT NULL,
      recommended_task TEXT NOT NULL,
      confidence REAL DEFAULT 0.7,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      reasoning TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dismissed', 'expired')),
      user_feedback TEXT,
      feedback_at TEXT,
      task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
      source_embedding_id TEXT REFERENCES embeddings(id) ON DELETE SET NULL,
      expires_at TEXT DEFAULT (datetime('now', '+30 days')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}'
    )`,

    // Reminders
    `CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      remind_at TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'triggered', 'dismissed', 'snoozed')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      tags TEXT DEFAULT '[]',
      recurrence_rule TEXT,
      snoozed_until TEXT,
      triggered_at TEXT,
      dismissed_at TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    // Captures
    `CREATE TABLE IF NOT EXISTS captures (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      daily_note_id TEXT REFERENCES daily_notes(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      capture_type TEXT DEFAULT 'thought' CHECK (capture_type IN ('thought', 'idea', 'followup', 'task', 'quote', 'reference')),
      captured_at TEXT DEFAULT (datetime('now')),
      processed INTEGER DEFAULT 0,
      linked_notes TEXT DEFAULT '[]',
      linked_projects TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    // Insights
    `CREATE TABLE IF NOT EXISTS insights (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
      insight_type TEXT NOT NULL CHECK (insight_type IN ('connection', 'theme', 'action', 'question', 'pattern', 'summary', 'gap', 'leverage')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      source_notes TEXT DEFAULT '[]',
      source_captures TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.8,
      is_dismissed INTEGER DEFAULT 0,
      is_actioned INTEGER DEFAULT 0,
      feedback TEXT CHECK (feedback IN ('up', 'down')),
      generated_at TEXT DEFAULT (datetime('now')),
      actioned_at TEXT,
      metadata TEXT DEFAULT '{}'
    )`,

    // Note Connections
    `CREATE TABLE IF NOT EXISTS note_connections (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      connection_type TEXT DEFAULT 'related' CHECK (connection_type IN ('related', 'references', 'extends', 'contradicts', 'supports')),
      strength REAL DEFAULT 0.5,
      reason TEXT,
      is_manual INTEGER DEFAULT 0,
      embedding_similarity REAL,
      discovery_method TEXT DEFAULT 'manual' CHECK (discovery_method IN ('manual', 'llm', 'embedding', 'wikilink')),
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_note_id, target_note_id)
    )`,

    // Entity / Knowledge Layer
    `CREATE TABLE IF NOT EXISTS entities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      canonical_name TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'other' CHECK (entity_type IN ('person','org','place','project','input','product','other')),
      mention_count INTEGER DEFAULT 0,
      first_seen_at TEXT DEFAULT (datetime('now')),
      last_seen_at TEXT DEFAULT (datetime('now')),
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, normalized_key)
    )`,
    `CREATE TABLE IF NOT EXISTS entity_aliases (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      alias TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, normalized_key)
    )`,
    `CREATE TABLE IF NOT EXISTS entity_mentions (
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
    `CREATE TABLE IF NOT EXISTS entity_edges (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      target_entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
      edge_type TEXT NOT NULL DEFAULT 'related' CHECK (edge_type IN ('related','supplies','funds','depends_on','blocks','located_in','works_with','same_as','part_of')),
      strength REAL DEFAULT 0.5,
      reason TEXT,
      discovery_method TEXT DEFAULT 'co_occurrence' CHECK (discovery_method IN ('co_occurrence','llm','manual')),
      co_occurrence_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(source_entity_id, target_entity_id, edge_type)
    )`,

    // Tags
    `CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      color TEXT DEFAULT '#6b7280',
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, slug)
    )`,

    `CREATE TABLE IF NOT EXISTS note_tags (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY(note_id, tag_id)
    )`,

    // Activity Log
    `CREATE TABLE IF NOT EXISTS activity_log (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      changes TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(user_id, date)`,
    `CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date ON journal_entries(user_id, date)`,
    `CREATE INDEX IF NOT EXISTS idx_journal_entries_note ON journal_entries(note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_journal_entries_category ON journal_entries(category)`,
    `CREATE INDEX IF NOT EXISTS idx_monthly_journals_user ON monthly_journals(user_id, year, month)`,
    `CREATE INDEX IF NOT EXISTS idx_weekly_reviews_week ON weekly_reviews(user_id, year, week_number)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_delegated ON tasks(delegated_to) WHERE delegated_to IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_task_rec_user ON task_recommendations(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_task_rec_status ON task_recommendations(user_id, status, expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_task_rec_source ON task_recommendations(source_type, source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_task_rec_feedback ON task_recommendations(user_id, created_at) WHERE user_feedback IS NOT NULL`,
    `CREATE INDEX IF NOT EXISTS idx_task_rec_cleanup ON task_recommendations(status, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at)`,
    `CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_captures_daily ON captures(daily_note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_captures_date ON captures(captured_at)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_type ON insights(insight_type)`,
    `CREATE INDEX IF NOT EXISTS idx_connections_source ON note_connections(source_note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_connections_target ON note_connections(target_note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id, mention_count DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(user_id, entity_type)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_aliases_key ON entity_aliases(user_id, normalized_key)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_mentions_source ON entity_mentions(source_type, source_id)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(created_at DESC)`,

    // FTS5 for full-text search
    `CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(title, content_plain, content='notes', content_rowid='rowid')`,

    // FTS5 triggers to keep notes_fts in sync with notes table
    `CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content_plain) VALUES (NEW.rowid, NEW.title, COALESCE(NEW.content_plain, ''));
    END`,

    `CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content_plain) VALUES('delete', OLD.rowid, OLD.title, COALESCE(OLD.content_plain, ''));
    END`,

    `CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content_plain) VALUES('delete', OLD.rowid, OLD.title, COALESCE(OLD.content_plain, ''));
      INSERT INTO notes_fts(rowid, title, content_plain) VALUES (NEW.rowid, NEW.title, COALESCE(NEW.content_plain, ''));
    END`,

    // =====================================================
    // EMBEDDINGS (for semantic similarity)
    // =====================================================
    `CREATE TABLE IF NOT EXISTS embeddings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL CHECK (entity_type IN ('note', 'capture', 'task_candidate')),
      entity_id TEXT NOT NULL,
      model TEXT DEFAULT 'text-embedding-3-small',
      embedding TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(entity_type, entity_id)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id)`,

    // =====================================================
    // AI CACHE (for response caching)
    // =====================================================
    `CREATE TABLE IF NOT EXISTS ai_cache (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cache_key TEXT NOT NULL UNIQUE,
      operation_type TEXT NOT NULL,
      tier TEXT NOT NULL CHECK (tier IN ('local', 'embedding', 'fast_llm', 'full_llm')),
      model TEXT,
      input_hash TEXT NOT NULL,
      output TEXT NOT NULL,
      tokens_used INTEGER DEFAULT 0,
      cost_cents REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      hit_count INTEGER DEFAULT 0,
      last_hit_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_cache_user ON ai_cache(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at)`,

    // =====================================================
    // PROCESSING QUEUE (for background jobs)
    // =====================================================
    `CREATE TABLE IF NOT EXISTS processing_queue (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN (
        'generate_embedding', 'generate_summary', 'generate_tags',
        'find_connections', 'analyze_capture', 'recompute_all',
        'scan_for_tasks', 'extract_metadata', 'extract_text',
        'generate_description', 'generate_thumbnail', 'link-scrape-and-embed'
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
    `CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, scheduled_at)`,
    `CREATE INDEX IF NOT EXISTS idx_queue_entity ON processing_queue(entity_type, entity_id)`,

    // =====================================================
    // ATTACHMENTS (File & Image Management)
    // =====================================================
    `CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

      -- File metadata
      filename TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      storage_key TEXT NOT NULL,
      storage_url TEXT NOT NULL,

      -- Classification
      file_type TEXT NOT NULL CHECK (file_type IN ('image', 'pdf', 'audio', 'video', 'document', 'other')),

      -- Relationships
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,

      -- Extracted content
      extracted_text TEXT,
      description TEXT,
      content_plain TEXT,

      -- Processing
      processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
      processing_error TEXT,
      content_hash TEXT NOT NULL,

      -- Metadata & tags
      metadata TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',

      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),

      UNIQUE(user_id, storage_key)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_attachments_user ON attachments(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_project ON attachments(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_note ON attachments(note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_type ON attachments(file_type)`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(content_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_attachments_status ON attachments(processing_status)`,

    // FTS5 for attachments
    `CREATE VIRTUAL TABLE IF NOT EXISTS attachments_fts USING fts5(
      filename, description, content_plain, tags,
      content='attachments', content_rowid='rowid'
    )`,

    // Triggers to keep attachments FTS in sync
    `CREATE TRIGGER IF NOT EXISTS attachments_fts_insert AFTER INSERT ON attachments BEGIN
      INSERT INTO attachments_fts(rowid, filename, description, content_plain, tags)
      VALUES (NEW.rowid, NEW.filename, NEW.description, NEW.content_plain, NEW.tags);
    END`,

    `CREATE TRIGGER IF NOT EXISTS attachments_fts_delete AFTER DELETE ON attachments BEGIN
      INSERT INTO attachments_fts(attachments_fts, rowid, filename, description, content_plain, tags)
      VALUES('delete', OLD.rowid, OLD.filename, OLD.description, OLD.content_plain, OLD.tags);
    END`,

    `CREATE TRIGGER IF NOT EXISTS attachments_fts_update AFTER UPDATE ON attachments BEGIN
      INSERT INTO attachments_fts(attachments_fts, rowid, filename, description, content_plain, tags)
      VALUES('delete', OLD.rowid, OLD.filename, OLD.description, OLD.content_plain, OLD.tags);
      INSERT INTO attachments_fts(rowid, filename, description, content_plain, tags)
      VALUES (NEW.rowid, NEW.filename, NEW.description, NEW.content_plain, NEW.tags);
    END`,

    // =====================================================
    // AI AGENT DELEGATION SYSTEM
    // =====================================================
    `CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_type TEXT UNIQUE NOT NULL CHECK (agent_type IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux', 'legal', 'finance', 'hr', 'product', 'sales', 'operations', 'security', 'data_eng', 'educator', 'strategy')),
      display_name TEXT NOT NULL,
      description TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      model_id TEXT NOT NULL DEFAULT 'x-ai/grok-4.1-fast',
      icon TEXT DEFAULT '🤖',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      task_type TEXT NOT NULL CHECK (task_type IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux', 'legal', 'finance', 'hr', 'product', 'sales', 'operations', 'security', 'data_eng', 'educator', 'strategy')),
      assigned_agent TEXT NOT NULL CHECK (assigned_agent IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux', 'legal', 'finance', 'hr', 'product', 'sales', 'operations', 'security', 'data_eng', 'educator', 'strategy')),
      status TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'awaiting_review', 'revision_requested', 'approved', 'rejected', 'failed')),
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      output_format TEXT DEFAULT 'markdown' CHECK (output_format IN ('markdown', 'code', 'plain_text', 'structured')),
      context_note_ids TEXT DEFAULT '[]',
      context_urls TEXT DEFAULT '[]',
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      max_revisions INTEGER DEFAULT 5,
      current_version INTEGER DEFAULT 0,
      context_used TEXT DEFAULT '[]',
      source_type TEXT DEFAULT 'task',
      source_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_type ON agent_tasks(task_type)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_task ON agent_tasks(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_source ON agent_tasks(source_type, source_id)`,

    `CREATE TABLE IF NOT EXISTS agent_task_outputs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_type TEXT DEFAULT 'markdown',
      model_used TEXT NOT NULL,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      processing_time_ms INTEGER DEFAULT 0,
      summary TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(agent_task_id, version_number)
    )`,

    `CREATE INDEX IF NOT EXISTS idx_agent_outputs_task ON agent_task_outputs(agent_task_id, version_number DESC)`,

    `CREATE TABLE IF NOT EXISTS agent_task_feedback (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      output_version INTEGER NOT NULL,
      feedback_type TEXT NOT NULL CHECK (feedback_type IN ('approve', 'request_edit', 'reject')),
      feedback_text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,

    `CREATE INDEX IF NOT EXISTS idx_agent_feedback_task ON agent_task_feedback(agent_task_id, created_at DESC)`,

    // =====================================================
    // CHAT CONVERSATIONS
    // =====================================================
    `CREATE TABLE IF NOT EXISTS chat_conversations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT DEFAULT 'New Chat',
      agent_type TEXT NOT NULL DEFAULT 'general',
      context_type TEXT NOT NULL DEFAULT 'general'
        CHECK (context_type IN ('executive', 'project', 'note', 'task', 'general')),
      context_id TEXT,
      model TEXT,
      message_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations(user_id, updated_at DESC)`,

    `CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
      content TEXT NOT NULL,
      agent_type TEXT,
      model_used TEXT,
      tokens_input INTEGER DEFAULT 0,
      tokens_output INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at ASC)`,

    // =====================================================
    // PROJECT COLLABORATORS
    // =====================================================
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

    // =====================================================
    // NOTIFICATIONS
    // =====================================================
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN (
        'reminder_due', 'task_overdue', 'task_due_soon',
        'daily_digest', 'weekly_report',
        'agent_complete', 'agent_failed',
        'insight_generated', 'streak_milestone',
        'project_stalled', 'system'
      )),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
      is_read INTEGER DEFAULT 0,
      is_emailed INTEGER DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      entity_type TEXT,
      entity_id TEXT,
      action_url TEXT,
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      read_at TEXT,
      archived_at TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, type)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id)`,

    // =====================================================
    // NOTIFICATION PREFERENCES
    // =====================================================
    `CREATE TABLE IF NOT EXISTS notification_preferences (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email_enabled INTEGER DEFAULT 1,
      email_reminders INTEGER DEFAULT 1,
      email_overdue_tasks INTEGER DEFAULT 1,
      email_daily_digest INTEGER DEFAULT 1,
      email_weekly_report INTEGER DEFAULT 1,
      email_agent_updates INTEGER DEFAULT 1,
      daily_digest_hour INTEGER DEFAULT 8,
      weekly_report_day INTEGER DEFAULT 1,
      quiet_hours_start INTEGER DEFAULT 22,
      quiet_hours_end INTEGER DEFAULT 7,
      timezone TEXT DEFAULT 'UTC',
      overdue_reminder_hours INTEGER DEFAULT 2,
      due_soon_hours INTEGER DEFAULT 24,
      ai_digest_enabled INTEGER DEFAULT 1,
      ai_weekly_enabled INTEGER DEFAULT 1,
      last_daily_digest TEXT,
      last_weekly_report TEXT,
      last_notification_check TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id)`,

    // =====================================================
    // HEARTBEAT SCHEDULER
    // =====================================================
    `CREATE TABLE IF NOT EXISTS heartbeat_tasks (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      check_type TEXT NOT NULL CHECK (check_type IN ('db_query', 'rule_eval', 'stale_check')),
      check_source TEXT NOT NULL,
      condition TEXT NOT NULL,
      action_type TEXT NOT NULL CHECK (action_type IN ('create_notification', 'delegate_to_agent', 'enqueue_processing', 'execute_skill')),
      action_params TEXT DEFAULT '{}',
      schedule TEXT NOT NULL DEFAULT '30m',
      enabled INTEGER DEFAULT 1,
      owner TEXT NOT NULL DEFAULT 'user' CHECK (owner IN ('system', 'operator', 'user')),
      notify_channel TEXT DEFAULT 'in_app' CHECK (notify_channel IN ('in_app', 'email', 'both')),
      last_run_at TEXT,
      last_result TEXT,
      run_count INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, name)
    )`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_user ON heartbeat_tasks(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_enabled ON heartbeat_tasks(enabled, schedule)`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_owner ON heartbeat_tasks(owner)`,

    `CREATE TABLE IF NOT EXISTS heartbeat_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      heartbeat_task_id TEXT NOT NULL REFERENCES heartbeat_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tick_time TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL CHECK (status IN ('ok', 'triggered', 'error', 'skipped')),
      items_evaluated INTEGER DEFAULT 0,
      items_dispatched INTEGER DEFAULT 0,
      action_taken TEXT,
      result_summary TEXT,
      error_message TEXT,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_task ON heartbeat_logs(heartbeat_task_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_user ON heartbeat_logs(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_status ON heartbeat_logs(status, created_at DESC)`,

    // =====================================================
    // SKILLS ARCHITECTURE
    // =====================================================
    `CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      skill_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'general' CHECK (category IN ('notification', 'delegation', 'processing', 'analysis', 'content', 'integration', 'general')),
      version TEXT NOT NULL DEFAULT '1.0.0',
      is_builtin INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      input_schema TEXT NOT NULL DEFAULT '{}',
      config TEXT DEFAULT '{}',
      tags TEXT DEFAULT '[]',
      requires_auth INTEGER DEFAULT 0,
      rate_limit_per_hour INTEGER DEFAULT 60,
      estimated_cost_tier TEXT DEFAULT 'free' CHECK (estimated_cost_tier IN ('free', 'low', 'medium', 'high')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skills_skill_id ON skills(skill_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category)`,
    `CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active)`,

    `CREATE TABLE IF NOT EXISTS skill_executions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      skill_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      trigger_source TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_source IN ('manual', 'heartbeat', 'agent', 'api', 'system')),
      trigger_id TEXT,
      input_params TEXT DEFAULT '{}',
      output TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
      error_message TEXT,
      duration_ms INTEGER DEFAULT 0,
      tokens_used INTEGER DEFAULT 0,
      cost_cents REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_executions(skill_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_exec_user ON skill_executions(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_exec_trigger ON skill_executions(trigger_source, trigger_id)`,
    `CREATE INDEX IF NOT EXISTS idx_skill_exec_status ON skill_executions(status)`,

    // =====================================================
    // USER GUARDRAILS (AI interaction preferences)
    // =====================================================
    `CREATE TABLE IF NOT EXISTS user_guardrails (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      -- Identity: who the user is (role, expertise, context)
      personal_context TEXT DEFAULT '',
      -- Beliefs: core values, worldview, principles
      beliefs TEXT DEFAULT '',
      -- Communication style: how AI should respond
      communication_style TEXT DEFAULT '',
      -- Topics to always emphasize (JSON array)
      topics_to_emphasize TEXT DEFAULT '[]',
      -- Topics to avoid (JSON array)
      topics_to_avoid TEXT DEFAULT '[]',
      -- Custom instructions: free-form additional directives
      custom_instructions TEXT DEFAULT '',
      -- System-managed: auto-learned preferences from interactions
      learned_context TEXT DEFAULT '{}',
      -- Evolution tracking
      interaction_count INTEGER DEFAULT 0,
      last_evolved_at TEXT,
      evolution_version INTEGER DEFAULT 0,
      -- Active toggle
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_guardrails_user ON user_guardrails(user_id)`,

    // =====================================================
    // WAITLIST
    // =====================================================
    `CREATE TABLE IF NOT EXISTS waitlist (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      email TEXT NOT NULL UNIQUE,
      source TEXT DEFAULT 'landing',
      status TEXT DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    // MCP API Keys (auth for the Model Context Protocol server / HTTP transport)
    `CREATE TABLE IF NOT EXISTS mcp_api_keys (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT DEFAULT '["*"]',
      is_active BOOLEAN DEFAULT TRUE,
      rate_limit_per_minute INTEGER DEFAULT 60,
      last_used_at TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_hash ON mcp_api_keys(key_hash)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_user ON mcp_api_keys(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mcp_keys_active ON mcp_api_keys(is_active, expires_at)`,
  ];

  // Additional ALTER statements for adding columns to existing tables
  const alterStatements = [
    // Add new columns to notes table
    `ALTER TABLE notes ADD COLUMN summary TEXT`,
    `ALTER TABLE notes ADD COLUMN auto_tags TEXT DEFAULT '[]'`,
    `ALTER TABLE notes ADD COLUMN processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed'))`,
    // Add new columns to note_connections table
    `ALTER TABLE note_connections ADD COLUMN embedding_similarity REAL`,
    `ALTER TABLE note_connections ADD COLUMN discovery_method TEXT DEFAULT 'manual' CHECK (discovery_method IN ('manual', 'llm', 'embedding'))`,
    // Add metadata column to daily_notes table for auto-scan tracking
    `ALTER TABLE daily_notes ADD COLUMN metadata TEXT DEFAULT '{}'`,
    // Add is_pinned column to attachments table
    `ALTER TABLE attachments ADD COLUMN is_pinned INTEGER DEFAULT 0`,
    // Add sharing columns to notes table
    `ALTER TABLE notes ADD COLUMN share_token TEXT`,
    `ALTER TABLE notes ADD COLUMN shared_at TEXT`,
    // Add new columns to tasks table for AI delegation
    `ALTER TABLE tasks ADD COLUMN title TEXT`,
    `ALTER TABLE tasks ADD COLUMN description TEXT`,
    `ALTER TABLE tasks ADD COLUMN delegated_to TEXT`,
    `ALTER TABLE tasks ADD COLUMN agent_task_id TEXT REFERENCES agent_tasks(id) ON DELETE SET NULL`,
    `ALTER TABLE tasks ADD COLUMN linked_note_ids TEXT DEFAULT '[]'`,
    // Add retry tracking columns to agent_tasks table
    `ALTER TABLE agent_tasks ADD COLUMN retry_count INTEGER DEFAULT 0`,
    `ALTER TABLE agent_tasks ADD COLUMN max_retries INTEGER DEFAULT 3`,
    `ALTER TABLE agent_tasks ADD COLUMN last_error TEXT`,
    // Add bidirectional link from agent_tasks to tasks
    `ALTER TABLE agent_tasks ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE`,
    // Add context_used to agent_tasks for Context Briefcase
    `ALTER TABLE agent_tasks ADD COLUMN context_used TEXT DEFAULT '[]'`,
    // Add recurrence support to tasks
    `ALTER TABLE tasks ADD COLUMN recurrence_rule TEXT`,
    `ALTER TABLE tasks ADD COLUMN recurrence_end_date TEXT`,
    `ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`,
    // Add summary column to agent_task_outputs for quick-review summaries
    `ALTER TABLE agent_task_outputs ADD COLUMN summary TEXT`,
    // Add generic delegation columns to agent_tasks (source_type/source_id for any entity type)
    `ALTER TABLE agent_tasks ADD COLUMN source_type TEXT DEFAULT 'task'`,
    `ALTER TABLE agent_tasks ADD COLUMN source_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_source ON agent_tasks(source_type, source_id)`,
    // Add routed_by column to agent_tasks for routing audit
    `ALTER TABLE agent_tasks ADD COLUMN routed_by TEXT DEFAULT 'user'`,
    // Queue-worker recovery sweep (abandoned revisions + retryable failures)
    `CREATE INDEX IF NOT EXISTS idx_agent_tasks_recovery ON agent_tasks(status, updated_at)`,
  ];

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  // Run CREATE statements
  for (const statement of statements) {
    try {
      await db.execute(statement);
      successCount++;

      // Extract name for logging
      const match = statement.match(/(?:CREATE\s+(?:TABLE|INDEX|VIRTUAL TABLE)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i);
      if (match) {
        console.log(`✓ ${match[1]}`);
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes("already exists")) {
        skipCount++;
        const match = statement.match(/(?:CREATE\s+(?:TABLE|INDEX|VIRTUAL TABLE)\s+(?:IF NOT EXISTS\s+)?)([\w_]+)/i);
        if (match) {
          console.log(`○ ${match[1]} (exists)`);
        }
      } else {
        errorCount++;
        console.error(`✗ Error:`, err.message?.substring(0, 100));
      }
    }
  }

  // Run ALTER statements (for adding columns to existing tables)
  console.log("\nApplying schema updates...");
  for (const statement of alterStatements) {
    try {
      await db.execute(statement);
      successCount++;
      // Extract column name for logging
      const match = statement.match(/ADD COLUMN (\w+)/i);
      if (match) {
        console.log(`✓ Added column: ${match[1]}`);
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes("duplicate column name")) {
        skipCount++;
        const match = statement.match(/ADD COLUMN (\w+)/i);
        if (match) {
          console.log(`○ ${match[1]} (exists)`);
        }
      } else {
        errorCount++;
        console.error(`✗ ALTER Error:`, err.message?.substring(0, 100));
      }
    }
  }

  // Create unique index for share_token (must happen after ALTER statements)
  console.log("\nCreating additional indexes...");
  try {
    await db.execute(`CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_share_token ON notes(share_token) WHERE share_token IS NOT NULL`);
    console.log(`✓ idx_notes_share_token`);
    successCount++;
  } catch (error: unknown) {
    const err = error as Error;
    if (err.message?.includes("already exists")) {
      console.log(`○ idx_notes_share_token (exists)`);
      skipCount++;
    } else {
      console.error(`✗ Index Error:`, err.message?.substring(0, 100));
      errorCount++;
    }
  }

  // =====================================================
  // Data migrations - for schema changes that require table recreation
  // =====================================================
  console.log("\nApplying data migrations...");

  // Migration: Update processing_queue CHECK constraint to include new attachment operations
  //
  // We detect whether the migration is needed by inspecting the stored DDL in
  // sqlite_master rather than probing with a test INSERT — the probe fails the
  // FOREIGN KEY check on user_id before the CHECK constraint is ever evaluated.
  try {
    const schemaRow = await db.execute(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'processing_queue'`
    );
    const existingSql = (schemaRow.rows[0]?.sql as string | undefined) || "";
    const requiredOps = [
      "extract_metadata",
      "extract_text",
      "generate_description",
      "generate_thumbnail",
      "link-scrape-and-embed",
    ];
    const needsMigration = existingSql.length > 0 && requiredOps.some(
      (op) => !existingSql.includes(`'${op}'`)
    );

    if (!needsMigration) {
      console.log(`○ processing_queue constraint (already updated)`);
    } else {
      console.log(`↻ Migrating processing_queue table...`);

      // Disable FK checks for the entire recreation so the copy doesn't fail on
      // rows whose user_id references a deleted user.
      await db.execute(`PRAGMA foreign_keys = OFF`);

      try {
        await db.execute(`
          CREATE TABLE processing_queue_new (
            id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
            user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK (operation IN (
              'generate_embedding', 'generate_summary', 'generate_tags',
              'find_connections', 'analyze_capture', 'recompute_all',
              'scan_for_tasks', 'extract_metadata', 'extract_text',
              'generate_description', 'generate_thumbnail', 'link-scrape-and-embed'
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
          )
        `);

        await db.execute(`INSERT INTO processing_queue_new SELECT * FROM processing_queue`);
        await db.execute(`DROP TABLE processing_queue`);
        await db.execute(`ALTER TABLE processing_queue_new RENAME TO processing_queue`);

        await db.execute(`CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, scheduled_at)`);
        await db.execute(`CREATE INDEX IF NOT EXISTS idx_queue_entity ON processing_queue(entity_type, entity_id)`);

        console.log(`✓ Migrated processing_queue table with new operations`);
        successCount++;
      } finally {
        await db.execute(`PRAGMA foreign_keys = ON`);
      }
    }
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`✗ Migration Error:`, err.message);
    errorCount++;
  }

  // Backfill agent_tasks: set source_id from task_id for existing records
  console.log("\nBackfilling agent_tasks source_type/source_id...");
  try {
    const backfillAgentResult = await db.execute(`
      UPDATE agent_tasks SET source_type = 'task', source_id = task_id
      WHERE task_id IS NOT NULL AND source_id IS NULL
    `);
    console.log(`✓ Backfilled ${backfillAgentResult.rowsAffected} agent_tasks source references`);
  } catch (error: unknown) {
    const err = error as Error;
    if (!err.message?.includes("no such column")) {
      console.error(`✗ Agent tasks backfill error:`, err.message);
    }
  }

  // Add compound indexes for hot-path query patterns
  console.log("\nAdding compound indexes...");
  const compoundIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_tasks_user_status ON tasks(user_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_notes_user_archived ON notes(user_id, is_archived)`,
    `CREATE INDEX IF NOT EXISTS idx_captures_user_processed ON captures(user_id, processed)`,
    `CREATE INDEX IF NOT EXISTS idx_collab_project_status ON project_collaborators(project_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_connections_user_source ON note_connections(user_id, source_note_id)`,
    `CREATE INDEX IF NOT EXISTS idx_connections_user_target ON note_connections(user_id, target_note_id)`,
  ];
  for (const idx of compoundIndexes) {
    try {
      await db.execute(idx);
      const match = idx.match(/idx_[\w]+/);
      console.log(`✓ ${match?.[0]}`);
      successCount++;
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes("already exists")) {
        skipCount++;
      } else {
        errorCount++;
        console.error(`✗ Index Error:`, err.message?.substring(0, 100));
      }
    }
  }

  // Backfill existing tasks: content -> title
  console.log("\nBackfilling task titles...");
  try {
    const backfillResult = await db.execute(`
      UPDATE tasks SET title = content WHERE title IS NULL
    `);
    console.log(`✓ Backfilled ${backfillResult.rowsAffected} task titles`);
  } catch (error: unknown) {
    const err = error as Error;
    if (!err.message?.includes("no such column")) {
      console.error(`✗ Backfill error:`, err.message);
    }
  }

  // Populate FTS5 index with existing notes
  console.log(`\nPopulating FTS5 search index...`);
  try {
    // Clear existing FTS5 data (in case of re-run)
    await db.execute(`DELETE FROM notes_fts WHERE 1=1`);

    // Populate from notes table
    const result = await db.execute(`
      INSERT INTO notes_fts(rowid, title, content_plain)
      SELECT rowid, title, COALESCE(content_plain, '') FROM notes
    `);
    console.log(`✓ Indexed ${result.rowsAffected} notes for full-text search`);
  } catch (error: unknown) {
    const err = error as Error;
    console.error(`✗ FTS5 population error:`, err.message);
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
