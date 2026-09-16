// Database schema for Brain Portal
// Run with: npx tsx scripts/migrate.ts

export const schema = `
-- Enable foreign keys
PRAGMA foreign_keys = ON;

-- =====================================================
-- USERS & AUTH
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  preferences TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS magic_links (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TEXT DEFAULT (datetime('now'))
);

-- =====================================================
-- PROJECTS
-- =====================================================

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'planning', 'stalled', 'completed', 'archived')),
  color TEXT DEFAULT '#0d9488',
  icon TEXT DEFAULT 'folder',
  priority INTEGER DEFAULT 0,
  parent_id TEXT REFERENCES projects(id),
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);

-- =====================================================
-- NOTES
-- =====================================================

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  content_plain TEXT,
  note_type TEXT DEFAULT 'note' CHECK (note_type IN ('note', 'daily', 'weekly', 'insight', 'journal', 'monthly_journal')),
  is_pinned BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  word_count INTEGER DEFAULT 0,
  frontmatter TEXT DEFAULT '{}',
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
CREATE INDEX IF NOT EXISTS idx_notes_project ON notes(project_id);
CREATE INDEX IF NOT EXISTS idx_notes_type ON notes(note_type);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

-- =====================================================
-- DAILY NOTES
-- =====================================================

CREATE TABLE IF NOT EXISTS daily_notes (
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
);

CREATE INDEX IF NOT EXISTS idx_daily_notes_date ON daily_notes(user_id, date);

-- =====================================================
-- JOURNAL ENTRIES
-- =====================================================

CREATE TABLE IF NOT EXISTS journal_entries (
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
);

CREATE INDEX IF NOT EXISTS idx_journal_entries_user_date ON journal_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_journal_entries_note ON journal_entries(note_id);
CREATE INDEX IF NOT EXISTS idx_journal_entries_category ON journal_entries(category);

-- =====================================================
-- MONTHLY JOURNALS
-- =====================================================

CREATE TABLE IF NOT EXISTS monthly_journals (
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
);

CREATE INDEX IF NOT EXISTS idx_monthly_journals_user ON monthly_journals(user_id, year, month);

-- =====================================================
-- WEEKLY REVIEWS
-- =====================================================

CREATE TABLE IF NOT EXISTS weekly_reviews (
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
);

CREATE INDEX IF NOT EXISTS idx_weekly_reviews_week ON weekly_reviews(user_id, year, week_number);

-- =====================================================
-- TASKS
-- =====================================================

CREATE TABLE IF NOT EXISTS tasks (
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
  agent_task_id TEXT REFERENCES agent_tasks(id),
  linked_note_ids TEXT DEFAULT '[]',
  recurrence_rule TEXT,
  recurrence_end_date TEXT,
  parent_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_scheduled ON tasks(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tasks_estimated ON tasks(estimated_completion_date);

-- =====================================================
-- TASK RECOMMENDATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS task_recommendations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source information
  source_type TEXT NOT NULL CHECK (source_type IN ('note', 'daily_note', 'capture')),
  source_id TEXT NOT NULL, -- Note: No FK constraint - preserves recommendations even if source is deleted
  source_text TEXT NOT NULL,

  -- Recommendation details
  recommended_task TEXT NOT NULL,
  confidence REAL DEFAULT 0.7,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  reasoning TEXT,

  -- User feedback
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'dismissed', 'expired')),
  user_feedback TEXT,
  feedback_at TEXT,

  -- If accepted, link to created task
  task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,

  -- Embedding for similarity search
  source_embedding_id TEXT REFERENCES embeddings(id) ON DELETE SET NULL,

  -- Expiration
  expires_at TEXT DEFAULT (datetime('now', '+30 days')),

  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_task_rec_user ON task_recommendations(user_id);
CREATE INDEX IF NOT EXISTS idx_task_rec_status ON task_recommendations(user_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_task_rec_source ON task_recommendations(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_task_rec_feedback ON task_recommendations(user_id, created_at) WHERE user_feedback IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_rec_cleanup ON task_recommendations(status, created_at);

-- =====================================================
-- REMINDERS
-- =====================================================

CREATE TABLE IF NOT EXISTS reminders (
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
);

CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status ON reminders(status);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id);

-- =====================================================
-- CAPTURES (Quick thoughts)
-- =====================================================

CREATE TABLE IF NOT EXISTS captures (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  daily_note_id TEXT REFERENCES daily_notes(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  capture_type TEXT DEFAULT 'thought' CHECK (capture_type IN ('thought', 'idea', 'followup', 'task', 'quote', 'reference', 'link')),
  captured_at TEXT DEFAULT (datetime('now')),
  processed BOOLEAN DEFAULT FALSE,
  linked_notes TEXT DEFAULT '[]',
  linked_projects TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_captures_user ON captures(user_id);
CREATE INDEX IF NOT EXISTS idx_captures_daily ON captures(daily_note_id);
CREATE INDEX IF NOT EXISTS idx_captures_date ON captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_captures_user_processed ON captures(user_id, processed, captured_at DESC);

-- =====================================================
-- AI INSIGHTS
-- =====================================================

CREATE TABLE IF NOT EXISTS insights (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id TEXT REFERENCES notes(id) ON DELETE SET NULL,
  insight_type TEXT NOT NULL CHECK (insight_type IN ('connection', 'theme', 'action', 'question', 'pattern', 'summary', 'gap', 'leverage')),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source_notes TEXT DEFAULT '[]',
  source_captures TEXT DEFAULT '[]',
  confidence REAL DEFAULT 0.8,
  is_dismissed BOOLEAN DEFAULT FALSE,
  is_actioned BOOLEAN DEFAULT FALSE,
  generated_at TEXT DEFAULT (datetime('now')),
  actioned_at TEXT,
  metadata TEXT DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id);
CREATE INDEX IF NOT EXISTS idx_insights_type ON insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_insights_dismissed ON insights(is_dismissed);
CREATE INDEX IF NOT EXISTS idx_insights_user_status ON insights(user_id, is_dismissed, is_actioned);

-- =====================================================
-- NOTE CONNECTIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS note_connections (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  connection_type TEXT DEFAULT 'related' CHECK (connection_type IN ('related', 'references', 'extends', 'contradicts', 'supports')),
  strength REAL DEFAULT 0.5,
  reason TEXT,
  is_manual BOOLEAN DEFAULT FALSE,
  embedding_similarity REAL,
  discovery_method TEXT DEFAULT 'manual' CHECK (discovery_method IN ('manual', 'llm', 'embedding', 'wikilink')),
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(source_note_id, target_note_id)
);

CREATE INDEX IF NOT EXISTS idx_connections_source ON note_connections(source_note_id);
CREATE INDEX IF NOT EXISTS idx_connections_target ON note_connections(target_note_id);

-- =====================================================
-- TAGS
-- =====================================================

-- =====================================================
-- ENTITY / KNOWLEDGE LAYER
--
-- Added by scripts/migrate-add-entity-layer.ts. Mirrored here so this module
-- stays a faithful description of the database the app actually runs against.
-- =====================================================

CREATE TABLE IF NOT EXISTS entities (
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
);

CREATE TABLE IF NOT EXISTS entity_aliases (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_key TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, normalized_key)
);

CREATE TABLE IF NOT EXISTS entity_mentions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  snippet TEXT,
  occurred_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(entity_id, source_type, source_id)
);

-- The CRM Phase 0 migration rebuilds this table to widen edge_type and add a
-- metadata column. This is the pre-CRM shape.
CREATE TABLE IF NOT EXISTS entity_edges (
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
);

CREATE INDEX IF NOT EXISTS idx_entities_user ON entities(user_id, mention_count DESC);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(user_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_aliases_key ON entity_aliases(user_id, normalized_key);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions(entity_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_source ON entity_mentions(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_source ON entity_edges(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_edges_target ON entity_edges(target_entity_id);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, slug)
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY(note_id, tag_id)
);

-- =====================================================
-- FULL-TEXT SEARCH (FTS5)
-- =====================================================

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
  title,
  content_plain,
  content='notes',
  content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS notes_fts_insert AFTER INSERT ON notes BEGIN
  INSERT INTO notes_fts(rowid, title, content_plain) VALUES (NEW.rowid, NEW.title, NEW.content_plain);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_delete AFTER DELETE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content_plain) VALUES('delete', OLD.rowid, OLD.title, OLD.content_plain);
END;

CREATE TRIGGER IF NOT EXISTS notes_fts_update AFTER UPDATE ON notes BEGIN
  INSERT INTO notes_fts(notes_fts, rowid, title, content_plain) VALUES('delete', OLD.rowid, OLD.title, OLD.content_plain);
  INSERT INTO notes_fts(rowid, title, content_plain) VALUES (NEW.rowid, NEW.title, NEW.content_plain);
END;

-- =====================================================
-- ACTIVITY LOG
-- =====================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changes TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_date ON activity_log(created_at DESC);

-- =====================================================
-- EMBEDDINGS (for semantic similarity)
-- =====================================================

CREATE TABLE IF NOT EXISTS embeddings (
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
);

CREATE INDEX IF NOT EXISTS idx_embeddings_entity ON embeddings(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_user ON embeddings(user_id);

-- =====================================================
-- AI CACHE (for response caching)
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_cache (
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
);

CREATE INDEX IF NOT EXISTS idx_ai_cache_key ON ai_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_ai_cache_user ON ai_cache(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_cache_expires ON ai_cache(expires_at);

-- =====================================================
-- PROCESSING QUEUE (for background jobs)
-- =====================================================

CREATE TABLE IF NOT EXISTS processing_queue (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN (
    'generate_embedding', 'generate_summary', 'generate_tags',
    'find_connections', 'analyze_capture', 'recompute_all',
    'scan_for_tasks', 'link-scrape-and-embed',
    'extract_metadata', 'generate_thumbnail', 'extract_text', 'generate_description'
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

CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status, priority DESC, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_queue_entity ON processing_queue(entity_type, entity_id);

-- =====================================================
-- AI AGENT DELEGATION SYSTEM
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_type TEXT UNIQUE NOT NULL CHECK (agent_type IN ('code', 'copy', 'research', 'marketing', 'analyst', 'general', 'ux', 'legal', 'finance', 'hr', 'product', 'sales', 'operations', 'security', 'data_eng', 'educator', 'strategy')),
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  model_id TEXT NOT NULL DEFAULT 'minimax/minimax-m2.5',
  icon TEXT DEFAULT '🤖',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS agent_tasks (
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
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  last_error TEXT,
  context_used TEXT DEFAULT '[]',
  source_type TEXT DEFAULT 'task',
  source_id TEXT,
  routed_by TEXT DEFAULT 'user' CHECK (routed_by IN ('user', 'auto_llm', 'auto_rule', 'heartbeat')),
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_stuck ON agent_tasks(status, updated_at)
  WHERE status = 'processing';

-- The queue worker also sweeps abandoned revisions and retryable failures.
CREATE INDEX IF NOT EXISTS idx_agent_tasks_recovery ON agent_tasks(status, updated_at)
  WHERE status IN ('queued', 'revision_requested', 'failed');

CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_type ON agent_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_task ON agent_tasks(task_id);
CREATE INDEX IF NOT EXISTS idx_agent_tasks_source ON agent_tasks(source_type, source_id);

CREATE TABLE IF NOT EXISTS agent_task_outputs (
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
);

CREATE INDEX IF NOT EXISTS idx_agent_outputs_task ON agent_task_outputs(agent_task_id, version_number DESC);

CREATE TABLE IF NOT EXISTS agent_task_feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
  output_version INTEGER NOT NULL,
  feedback_type TEXT NOT NULL CHECK (feedback_type IN ('approve', 'request_edit', 'reject')),
  feedback_text TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_agent_feedback_task ON agent_task_feedback(agent_task_id, created_at DESC);

-- =====================================================
-- CHAT CONVERSATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'New Chat',
  agent_type TEXT NOT NULL DEFAULT 'general',
  context_type TEXT NOT NULL DEFAULT 'general'
    CHECK (context_type IN ('executive', 'project', 'note', 'task', 'item', 'general')),
  context_id TEXT,
  model TEXT,
  message_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON chat_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content TEXT NOT NULL,
  agent_type TEXT,
  model_used TEXT,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id, created_at ASC);

-- =====================================================
-- PROJECT COLLABORATORS
-- =====================================================

CREATE TABLE IF NOT EXISTS project_collaborators (
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
);
CREATE INDEX IF NOT EXISTS idx_collab_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_collab_user ON project_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_collab_email ON project_collaborators(email);
CREATE INDEX IF NOT EXISTS idx_collab_token ON project_collaborators(invite_token);

-- =====================================================
-- NOTIFICATIONS
-- =====================================================

CREATE TABLE IF NOT EXISTS notifications (
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
  is_read BOOLEAN DEFAULT FALSE,
  is_emailed BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  entity_type TEXT,
  entity_id TEXT,
  action_url TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  read_at TEXT,
  archived_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(user_id, type);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = 0;
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);

-- =====================================================
-- NOTIFICATION PREFERENCES
-- =====================================================

CREATE TABLE IF NOT EXISTS notification_preferences (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Email preferences
  email_enabled BOOLEAN DEFAULT TRUE,
  email_reminders BOOLEAN DEFAULT TRUE,
  email_overdue_tasks BOOLEAN DEFAULT TRUE,
  email_daily_digest BOOLEAN DEFAULT TRUE,
  email_weekly_report BOOLEAN DEFAULT TRUE,
  email_agent_updates BOOLEAN DEFAULT TRUE,
  -- Timing preferences
  daily_digest_hour INTEGER DEFAULT 8,
  weekly_report_day INTEGER DEFAULT 1,
  quiet_hours_start INTEGER DEFAULT 22,
  quiet_hours_end INTEGER DEFAULT 7,
  timezone TEXT DEFAULT 'UTC',
  -- Thresholds
  overdue_reminder_hours INTEGER DEFAULT 2,
  due_soon_hours INTEGER DEFAULT 24,
  -- AI report preferences
  ai_digest_enabled BOOLEAN DEFAULT TRUE,
  ai_weekly_enabled BOOLEAN DEFAULT TRUE,
  -- Last processed timestamps
  last_daily_digest TEXT,
  last_weekly_report TEXT,
  last_notification_check TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_prefs_user ON notification_preferences(user_id);

-- =====================================================
-- USER GUARDRAILS (AI Interaction Profile)
-- =====================================================

CREATE TABLE IF NOT EXISTS user_guardrails (
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
);

CREATE INDEX IF NOT EXISTS idx_guardrails_user ON user_guardrails(user_id);

-- =====================================================
-- HEARTBEAT SCHEDULER
-- =====================================================

CREATE TABLE IF NOT EXISTS heartbeat_tasks (
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
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_user ON heartbeat_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_enabled ON heartbeat_tasks(enabled, schedule);
CREATE INDEX IF NOT EXISTS idx_heartbeat_tasks_owner ON heartbeat_tasks(owner);

CREATE TABLE IF NOT EXISTS heartbeat_logs (
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
);

CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_task ON heartbeat_logs(heartbeat_task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_user ON heartbeat_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_heartbeat_logs_status ON heartbeat_logs(status, created_at DESC);

-- =====================================================
-- SKILLS ARCHITECTURE
-- =====================================================

CREATE TABLE IF NOT EXISTS skills (
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
);

CREATE INDEX IF NOT EXISTS idx_skills_skill_id ON skills(skill_id);
CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active);

CREATE TABLE IF NOT EXISTS skill_executions (
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
);

CREATE INDEX IF NOT EXISTS idx_skill_exec_skill ON skill_executions(skill_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_exec_user ON skill_executions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_exec_trigger ON skill_executions(trigger_source, trigger_id);
CREATE INDEX IF NOT EXISTS idx_skill_exec_status ON skill_executions(status);
`;

// TypeScript types for the database entities
export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  preferences: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface MagicLink {
  id: string;
  email: string;
  token: string;
  expires_at: string;
  used: boolean;
  created_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'planning' | 'stalled' | 'completed' | 'archived';
  color: string;
  icon: string;
  priority: number;
  parent_id: string | null;
  /** Venture this project belongs to. Added by the CRM Phase 0 migration. */
  venture_id?: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  slug: string;
  content: string;
  content_plain: string | null;
  note_type: 'note' | 'daily' | 'weekly' | 'insight' | 'journal' | 'monthly_journal';
  is_pinned: boolean;
  is_archived: boolean;
  word_count: number;
  frontmatter: string;
  metadata: string;
  summary: string | null;
  auto_tags: string;
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  share_token: string | null;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyNote {
  id: string;
  note_id: string;
  user_id: string;
  date: string;
  morning_focus: string | null;
  reflection: string;
  mood: number | null;
  energy: number | null;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export type JournalCategory = 'general' | 'personal' | 'work' | 'health' | 'travel' | 'purchase' | 'project' | 'learning' | 'social' | 'maintenance';

export interface JournalEntry {
  id: string;
  note_id: string;
  user_id: string;
  date: string;
  entry_text: string;
  category: JournalCategory;
  tags: string;
  mood: string | null;
  location: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface MonthlyJournal {
  id: string;
  note_id: string;
  user_id: string;
  year: number;
  month: number;
  entry_count: number;
  summary: string | null;
  categories: string;
  highlights: string;
  metadata: string;
  compiled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  user_id: string;
  note_id: string | null;
  project_id: string | null;
  content: string;
  title: string | null;
  description: string | null;
  delegated_to: string | null;
  agent_task_id: string | null;
  linked_note_ids: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date: string | null;
  scheduled_at: string | null;
  estimated_completion_date: string | null;
  completed_at: string | null;
  estimation_accuracy: string | null;
  position: number;
  tags: string;
  metadata: string;
  recurrence_rule: string | null;
  recurrence_end_date: string | null;
  parent_task_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  content: string | null;
  remind_at: string;
  status: 'pending' | 'triggered' | 'dismissed' | 'snoozed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  project_id: string | null;
  tags: string;
  recurrence_rule: string | null;
  snoozed_until: string | null;
  triggered_at: string | null;
  dismissed_at: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

// Link-specific metadata interface
export interface LinkMetadata {
  url: string;
  title?: string;
  description?: string;
  favicon?: string;
  ogImage?: string;
  scrapedContent?: string;  // Full page content
  wordCount?: number;       // Word count of scraped content
  scrapedAt?: string;       // ISO timestamp
  statusCode?: number;      // HTTP response code
  error?: string;           // If fetch/scrape failed
}

export interface Capture {
  id: string;
  user_id: string;
  daily_note_id: string | null;
  content: string;
  capture_type: 'thought' | 'idea' | 'followup' | 'task' | 'quote' | 'reference' | 'link';
  captured_at: string;
  processed: boolean;
  linked_notes: string;
  linked_projects: string;
  tags: string;
  metadata: string;
  created_at: string;
}

// LinkCapture type (Capture with 'link' type - metadata must be parsed as LinkMetadata)
export interface LinkCapture extends Capture {
  capture_type: 'link';
}

// Type guard for link captures
export function isLinkCapture(capture: Capture): capture is LinkCapture {
  if (capture.capture_type !== 'link') return false;
  try {
    const meta = typeof capture.metadata === 'string'
      ? JSON.parse(capture.metadata)
      : capture.metadata;
    return !!meta?.url;
  } catch {
    return false;
  }
}

export interface Insight {
  id: string;
  user_id: string;
  note_id: string | null;
  insight_type: 'connection' | 'theme' | 'action' | 'question' | 'pattern' | 'summary' | 'gap' | 'leverage';
  title: string;
  content: string;
  source_notes: string;
  source_captures: string;
  confidence: number;
  is_dismissed: boolean;
  is_actioned: boolean;
  /** Explicit user feedback used to learn taste and bias future ranking. */
  feedback: 'up' | 'down' | null;
  generated_at: string;
  actioned_at: string | null;
  metadata: string;
}

export interface NoteConnection {
  id: string;
  user_id: string;
  source_note_id: string;
  target_note_id: string;
  connection_type: 'related' | 'references' | 'extends' | 'contradicts' | 'supports';
  strength: number;
  reason: string | null;
  is_manual: boolean;
  embedding_similarity: number | null;
  discovery_method: 'manual' | 'llm' | 'embedding' | 'wikilink';
  created_at: string;
}

// ─── Entity / knowledge layer ────────────────────────

export type EntityKind =
  | 'person'
  | 'org'
  | 'place'
  | 'project'
  | 'input'
  | 'product'
  | 'other';

export type EntityEdgeType =
  | 'related'
  | 'supplies'
  | 'funds'
  | 'depends_on'
  | 'blocks'
  | 'located_in'
  | 'works_with'
  | 'same_as'
  | 'part_of'
  // CRM roles, added by the Phase 0 migration. The edge reads
  // source -> edge_type -> target, with the person as source and the venture or
  // org as target: `Will --partner--> Sable Labs`. `supplies` predates this
  // and reads the other way (`Harbor Supply --supplies--> Northwind Farms`).
  | 'partner'
  | 'collaborator'
  | 'customer_of'
  | 'member_of'
  | 'advisor_to'
  | 'investor_in'
  | 'employed_by'
  | 'reports_to'
  | 'contact_at';

/** Roles that attach a person to a venture or organisation. */
export const ENTITY_ROLE_EDGE_TYPES = [
  'partner',
  'collaborator',
  'customer_of',
  'member_of',
  'advisor_to',
  'investor_in',
  'employed_by',
  'reports_to',
  'contact_at',
] as const satisfies readonly EntityEdgeType[];

export interface Entity {
  id: string;
  user_id: string;
  canonical_name: string;
  normalized_key: string;
  entity_type: EntityKind;
  mention_count: number;
  first_seen_at: string;
  last_seen_at: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface EntityAlias {
  id: string;
  user_id: string;
  entity_id: string;
  alias: string;
  normalized_key: string;
  created_at: string;
}

export interface EntityMention {
  id: string;
  user_id: string;
  entity_id: string;
  source_type: string;
  source_id: string;
  snippet: string | null;
  occurred_at: string | null;
  created_at: string;
}

export interface EntityEdge {
  id: string;
  user_id: string;
  source_entity_id: string;
  target_entity_id: string;
  edge_type: EntityEdgeType;
  strength: number;
  reason: string | null;
  discovery_method: 'co_occurrence' | 'llm' | 'manual';
  co_occurrence_count: number;
  /** JSON. Added by the CRM Phase 0 migration. */
  metadata: string;
  created_at: string;
  updated_at: string;
}

// =====================================================
// CRM (Phase 0)
// =====================================================

export type ContactChannelKind = 'email' | 'phone' | 'handle' | 'url' | 'address';

export interface ContactChannel {
  id: string;
  user_id: string;
  entity_id: string;
  kind: ContactChannelKind;
  /** As entered, for display. */
  value: string;
  /** Normalized for matching. This is the inbound resolver key. */
  normalized_value: string;
  label: string | null;
  is_primary: number;
  /** 1 once we have actually received from this channel. */
  verified: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export type InteractionDirection = 'in' | 'out' | 'internal';

export type InteractionChannel =
  | 'email'
  | 'call'
  | 'sms'
  | 'dm'
  | 'meeting'
  | 'event'
  | 'note'
  | 'other';

/**
 * A touch: something that actually passed between the user and a counterparty.
 *
 * Distinct from an `EntityMention`, which only records that an entity was
 * referenced in something the user wrote.
 */
export interface Interaction {
  id: string;
  user_id: string;
  /** The counterparty. Null while an inbound message is still unresolved. */
  entity_id: string | null;
  /**
   * Which venture this happened under, SNAPSHOT at insert time.
   *
   * Never resolve this by walking the product's current `part_of` edge:
   * products move between ventures, and a move must not rewrite the venture
   * that past touches, revenue and compliance context belong to.
   */
  venture_id: string | null;
  /** Phase 2. No foreign key yet. */
  deal_id: string | null;
  direction: InteractionDirection;
  channel: InteractionChannel;
  occurred_at: string;
  subject: string | null;
  body: string | null;
  source_type: string | null;
  source_id: string | null;
  /** Natural key. See src/lib/crm/dedup.ts. */
  dedup_key: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  color: string;
  usage_count: number;
  created_at: string;
}

export interface WeeklyReview {
  id: string;
  note_id: string;
  user_id: string;
  year: number;
  week_number: number;
  start_date: string;
  end_date: string;
  summary: string | null;
  stats: string;
  created_at: string;
  updated_at: string;
}

export interface Embedding {
  id: string;
  user_id: string;
  entity_type: 'note' | 'capture' | 'task_candidate' | 'attachment';
  entity_id: string;
  model: string;
  embedding: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface AICache {
  id: string;
  user_id: string;
  cache_key: string;
  operation_type: string;
  tier: 'local' | 'embedding' | 'fast_llm' | 'full_llm';
  model: string | null;
  input_hash: string;
  output: string;
  tokens_used: number;
  cost_cents: number;
  created_at: string;
  expires_at: string | null;
  hit_count: number;
  last_hit_at: string | null;
}

export interface ProcessingJob {
  id: string;
  user_id: string;
  entity_type: string;
  entity_id: string;
  operation: 'generate_embedding' | 'generate_summary' | 'generate_tags' | 'find_connections' | 'analyze_capture' | 'recompute_all' | 'scan_for_tasks' | 'extract_metadata' | 'extract_text' | 'generate_description' | 'generate_thumbnail';
  tier: 'local' | 'embedding' | 'fast_llm' | 'full_llm';
  priority: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  attempts: number;
  max_attempts: number;
  error_message: string | null;
  scheduled_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: string;
}

export interface AgentConfig {
  id: string;
  agent_type: 'code' | 'copy' | 'research' | 'marketing' | 'analyst' | 'general' | 'ux' | 'legal' | 'finance' | 'hr' | 'product' | 'sales' | 'operations' | 'security' | 'data_eng' | 'educator' | 'strategy';
  display_name: string;
  description: string;
  system_prompt: string;
  model_id: string;
  icon: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DelegationSourceType = 'task' | 'note' | 'capture' | 'reminder' | 'thought' | 'insight' | 'journal';

export interface AgentTask {
  id: string;
  user_id: string;
  task_id: string | null;
  source_type: DelegationSourceType;
  source_id: string | null;
  title: string;
  description: string;
  task_type: 'code' | 'copy' | 'research' | 'marketing' | 'analyst' | 'general' | 'ux';
  assigned_agent: 'code' | 'copy' | 'research' | 'marketing' | 'analyst' | 'general' | 'ux';
  status: 'queued' | 'processing' | 'awaiting_review' | 'revision_requested' | 'approved' | 'rejected' | 'failed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  output_format: 'markdown' | 'code' | 'plain_text' | 'structured';
  context_note_ids: string; // JSON array
  context_urls: string; // JSON array
  project_id: string | null;
  max_revisions: number;
  current_version: number;
  retry_count: number;
  max_retries: number;
  last_error: string | null;
  context_used: string; // JSON array of { id, title, similarity }
  routed_by: 'user' | 'auto_llm' | 'auto_rule' | 'heartbeat';
  created_at: string;
  updated_at: string;
}


export interface AgentTaskOutput {
  id: string;
  agent_task_id: string;
  version_number: number;
  content: string;
  content_type: string;
  model_used: string;
  tokens_input: number;
  tokens_output: number;
  processing_time_ms: number;
  summary: string | null;
  created_at: string;
}

export interface AgentTaskFeedback {
  id: string;
  agent_task_id: string;
  output_version: number;
  feedback_type: 'approve' | 'request_edit' | 'reject';
  feedback_text: string | null;
  created_at: string;
}

export interface TaskRecommendation {
  id: string;
  user_id: string;
  source_type: 'note' | 'daily_note' | 'capture';
  source_id: string;
  source_text: string;
  recommended_task: string;
  confidence: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  reasoning: string | null;
  status: 'pending' | 'accepted' | 'rejected' | 'dismissed' | 'expired';
  user_feedback: string | null;
  feedback_at: string | null;
  task_id: string | null;
  source_embedding_id: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
  metadata: string;
}

export interface ChatConversation {
  id: string;
  user_id: string;
  title: string;
  agent_type: string;
  context_type: 'executive' | 'project' | 'note' | 'task' | 'item' | 'general';
  context_id: string | null;
  model: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  agent_type: string | null;
  model_used: string | null;
  tokens_input: number;
  tokens_output: number;
  created_at: string;
}

export interface ProjectCollaborator {
  id: string;
  project_id: string;
  user_id: string | null;
  email: string;
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted';
  invited_by: string;
  invite_token: string | null;
  invite_expires_at: string | null;
  accepted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  user_id: string;
  // File metadata
  filename: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  storage_key: string;
  storage_url: string;
  // Classification
  file_type: 'image' | 'pdf' | 'audio' | 'video' | 'document' | 'other';
  // Relationships
  project_id: string | null;
  note_id: string | null;
  // Extracted content
  extracted_text: string | null;
  description: string | null;
  content_plain: string | null;
  // Processing
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  processing_error: string | null;
  content_hash: string;
  // Metadata & tags
  metadata: string;
  tags: string;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type NotificationType =
  | 'reminder_due'
  | 'task_overdue'
  | 'task_due_soon'
  | 'daily_digest'
  | 'weekly_report'
  | 'agent_complete'
  | 'agent_failed'
  | 'insight_generated'
  | 'streak_milestone'
  | 'project_stalled'
  | 'system';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  is_read: boolean;
  is_emailed: boolean;
  is_archived: boolean;
  entity_type: string | null;
  entity_id: string | null;
  action_url: string | null;
  metadata: string;
  created_at: string;
  read_at: string | null;
  archived_at: string | null;
}

export interface NotificationPreferences {
  id: string;
  user_id: string;
  email_enabled: boolean;
  email_reminders: boolean;
  email_overdue_tasks: boolean;
  email_daily_digest: boolean;
  email_weekly_report: boolean;
  email_agent_updates: boolean;
  daily_digest_hour: number;
  weekly_report_day: number;
  quiet_hours_start: number;
  quiet_hours_end: number;
  timezone: string;
  overdue_reminder_hours: number;
  due_soon_hours: number;
  ai_digest_enabled: boolean;
  ai_weekly_enabled: boolean;
  last_daily_digest: string | null;
  last_weekly_report: string | null;
  last_notification_check: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Heartbeat Scheduler ─────────────────────────────

export type HeartbeatCheckType = 'db_query' | 'rule_eval' | 'stale_check';
export type HeartbeatActionType = 'create_notification' | 'delegate_to_agent' | 'enqueue_processing' | 'execute_skill';
export type HeartbeatOwner = 'system' | 'operator' | 'user';
export type HeartbeatLogStatus = 'ok' | 'triggered' | 'error' | 'skipped';

export interface HeartbeatTask {
  id: string;
  user_id: string;
  name: string;
  description: string;
  check_type: HeartbeatCheckType;
  check_source: string; // JSON: query, rule definition, or stale check config
  condition: string; // Expression to evaluate against check result
  action_type: HeartbeatActionType;
  action_params: string; // JSON: parameters for the action
  schedule: string; // Interval shorthand: '5m', '15m', '30m', '1h', '6h', '24h'
  enabled: number; // SQLite boolean
  owner: HeartbeatOwner;
  notify_channel: 'in_app' | 'email' | 'both';
  last_run_at: string | null;
  last_result: string | null;
  run_count: number;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface HeartbeatLog {
  id: string;
  heartbeat_task_id: string;
  user_id: string;
  tick_time: string;
  status: HeartbeatLogStatus;
  items_evaluated: number;
  items_dispatched: number;
  action_taken: string | null;
  result_summary: string | null;
  error_message: string | null;
  duration_ms: number;
  created_at: string;
}

// ─── Skills Architecture ─────────────────────────────

export type SkillCategory = 'notification' | 'delegation' | 'processing' | 'analysis' | 'content' | 'integration' | 'general';
export type SkillCostTier = 'free' | 'low' | 'medium' | 'high';
export type SkillTriggerSource = 'manual' | 'heartbeat' | 'agent' | 'api' | 'system';
export type SkillExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Skill {
  id: string;
  skill_id: string;
  name: string;
  description: string;
  category: SkillCategory;
  version: string;
  is_builtin: number;
  is_active: number;
  input_schema: string; // JSON schema for input params
  config: string; // JSON: skill-specific configuration
  tags: string; // JSON array
  requires_auth: number;
  rate_limit_per_hour: number;
  estimated_cost_tier: SkillCostTier;
  created_at: string;
  updated_at: string;
}

export interface SkillExecution {
  id: string;
  skill_id: string;
  user_id: string;
  trigger_source: SkillTriggerSource;
  trigger_id: string | null;
  input_params: string; // JSON
  output: string | null; // JSON
  status: SkillExecutionStatus;
  error_message: string | null;
  duration_ms: number;
  tokens_used: number;
  cost_cents: number;
  created_at: string;
}
