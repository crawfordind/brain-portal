/**
 * Schema for the delegated-task lifecycle, and the one-time handling of work
 * the earlier executor left pending.
 *
 * Additive only. `agent_tasks` is not rebuilt: its status CHECK stays as it
 * is and the precise lifecycle lives in new nullable columns (see `types.ts`).
 * Rebuilding that table would mean juggling the two tables that cascade from
 * it, which is how an earlier migration in this repository once lost rows.
 *
 * Takes a client rather than importing one, so `scripts/migrate.ts`, the
 * standalone script and the in-memory tests all run exactly this code.
 */

import type { Client } from "@libsql/client";

export interface RuntimeMigrationReport {
  steps: Array<{ label: string; status: "applied" | "skipped" }>;
  /** Present only on the first application, when legacy rows were examined. */
  legacy?: {
    /** Left for the runtime to pick up (OpenRouter keeps running them as before). */
    toQueue: number;
    toNeedsDispatch: number;
    toNeedsReview: number;
  };
}

const AGENT_TASK_COLUMNS: Array<{ name: string; ddl: string }> = [
  // The runtime that ran the work, stamped at claim time. NULL before then.
  { name: "runtime", ddl: "ALTER TABLE agent_tasks ADD COLUMN runtime TEXT" },
  // NULL = a historical row the earlier executor owned (read-only history).
  { name: "runtime_state", ddl: "ALTER TABLE agent_tasks ADD COLUMN runtime_state TEXT" },
  { name: "runtime_session_id", ddl: "ALTER TABLE agent_tasks ADD COLUMN runtime_session_id TEXT" },
];

const EVENTS_DDL = (name: string) => `CREATE TABLE IF NOT EXISTS ${name} (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      run_id TEXT,
      actor TEXT NOT NULL CHECK (actor IN ('user', 'agent', 'system')),
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`;

const CREATE_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "agent_task_runs",
    sql: `CREATE TABLE IF NOT EXISTS agent_task_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      runtime TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('initial', 'revision', 'retry')),
      idempotency_key TEXT NOT NULL UNIQUE,
      request_body TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'dispatching' CHECK (state IN (
        'dispatching', 'running', 'awaiting_approval', 'stopping',
        'completed', 'failed', 'cancelled', 'interrupted', 'lost', 'abandoned')),
      external_run_id TEXT,
      session_id TEXT,
      dispatch_attempts INTEGER NOT NULL DEFAULT 0,
      last_dispatch_error TEXT,
      approval TEXT,
      runtime_model TEXT,
      tokens_input INTEGER,
      tokens_output INTEGER,
      output_version INTEGER,
      error TEXT,
      unreachable_since TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_polled_at TEXT,
      finished_at TEXT
    )`,
  },
  {
    label: "idx_agent_task_runs_task",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_task_runs_task ON agent_task_runs(agent_task_id, created_at DESC)`,
  },
  {
    label: "idx_agent_task_runs_state",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_task_runs_state ON agent_task_runs(state, updated_at)`,
  },
  // The audit trail: what happened to a task, who did it, which run.
  { label: "agent_task_events", sql: EVENTS_DDL("agent_task_events") },
  {
    label: "idx_agent_task_events_task",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_task_events_task ON agent_task_events(agent_task_id, created_at)`,
  },
];

const POST_COLUMN_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "idx_agent_tasks_runtime",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_tasks_runtime ON agent_tasks(runtime_state, runtime, updated_at)`,
  },
];

export async function columnExists(db: Client, table: string, column: string): Promise<boolean> {
  const info = await db.execute(`PRAGMA table_info(${table})`);
  return info.rows.some((row) => row.name === column);
}

async function tableExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

async function indexExists(db: Client, name: string): Promise<boolean> {
  const res = await db.execute({
    sql: `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`,
    args: [name],
  });
  return res.rows.length > 0;
}

/** Source tables per delegation source type, for the "does the source still exist?" check. */
const SOURCE_TABLES: Record<string, string> = {
  task: "tasks",
  note: "notes",
  capture: "captures",
  thought: "captures",
  reminder: "reminders",
  insight: "insights",
};

export interface RuntimeMigrationOptions {
  /**
   * `AGENT_RUNTIME` at migration time. On `openrouter` (the default) legacy
   * pending work keeps running as it did before the upgrade; on `hermes` or
   * `off` it is parked until the user sends it, because stale work should not
   * start running on a new runtime by itself.
   */
  runtime?: string;
  log?: (message: string) => void;
}

export async function applyAgentRuntimeMigration(
  db: Client,
  options: RuntimeMigrationOptions = {}
): Promise<RuntimeMigrationReport> {
  const log = options.log ?? (() => {});
  const runtime = (options.runtime ?? "openrouter").trim().toLowerCase() || "openrouter";
  const report: RuntimeMigrationReport = { steps: [] };

  // The runs table is created by this migration and nothing else, so its
  // absence marks the first application. Legacy rows are examined exactly
  // then: running that step on every build would sweep up fresh rows that
  // MCP or heartbeat inserted moments earlier.
  const firstApplication = !(await tableExists(db, "agent_task_runs"));

  await renameEarlyDraftSchema(db, report, log);

  for (const column of AGENT_TASK_COLUMNS) {
    if (await columnExists(db, "agent_tasks", column.name)) {
      report.steps.push({ label: `agent_tasks.${column.name}`, status: "skipped" });
      log(`  agent_tasks.${column.name}... exists, skipping`);
    } else {
      await db.execute(column.ddl);
      report.steps.push({ label: `agent_tasks.${column.name}`, status: "applied" });
      log(`  agent_tasks.${column.name}... ok`);
    }
  }

  for (const { label, sql } of [...CREATE_STATEMENTS, ...POST_COLUMN_STATEMENTS]) {
    const existed = label.startsWith("idx_") ? await indexExists(db, label) : await tableExists(db, label);
    await db.execute(sql);
    report.steps.push({ label, status: existed ? "skipped" : "applied" });
    log(`  ${label}... ${existed ? "exists, skipping" : "ok"}`);
  }

  if (firstApplication) {
    report.legacy = await handleLegacyPendingWork(db, runtime, log);
  }

  return report;
}

/**
 * An earlier draft of this feature used runtime-specific names (`jack_*`
 * columns, `hermes_*` run columns, a `'jack'` event actor). A database that
 * ran that draft, for example through a preview deployment, is brought onto
 * the generic names here, keeping every row. A no-op everywhere else.
 */
async function renameEarlyDraftSchema(
  db: Client,
  report: RuntimeMigrationReport,
  log: (message: string) => void
): Promise<void> {
  const renames: Array<[string, string, string]> = [
    ["agent_tasks", "jack_state", "runtime_state"],
    ["agent_tasks", "jack_session_id", "runtime_session_id"],
    ["agent_task_runs", "hermes_run_id", "external_run_id"],
    ["agent_task_runs", "hermes_session_id", "session_id"],
  ];
  let touched = false;
  for (const [table, from, to] of renames) {
    if ((await tableExists(db, table)) && (await columnExists(db, table, from)) && !(await columnExists(db, table, to))) {
      await db.execute(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
      touched = true;
      log(`  ${table}.${from} -> ${to}... ok`);
    }
  }

  if (await columnExists(db, "agent_tasks", "runtime")) {
    const res = await db.execute(`UPDATE agent_tasks SET runtime = 'hermes' WHERE runtime = 'jack'`);
    if ((res.rowsAffected ?? 0) > 0) touched = true;
    // Parked rows never ran anywhere; the runtime is stamped when they do.
    if (await tableExists(db, "agent_task_runs")) {
      await db.execute(
        `UPDATE agent_tasks SET runtime = NULL
         WHERE runtime = 'hermes' AND NOT EXISTS (SELECT 1 FROM agent_task_runs r WHERE r.agent_task_id = agent_tasks.id)`
      );
      await db.execute(`UPDATE agent_task_runs SET runtime = 'hermes' WHERE runtime = 'jack'`);
    }
  }

  if (await indexExists(db, "idx_agent_tasks_jack")) {
    await db.execute(`DROP INDEX idx_agent_tasks_jack`);
    touched = true;
  }

  // The events table's actor CHECK named the runtime; rebuild it with the
  // generic actor. Nothing references this table, so a rebuild is safe.
  const ddl = await db.execute({
    sql: `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_task_events'`,
    args: [],
  });
  const eventsSql = String(ddl.rows[0]?.sql ?? "");
  if (eventsSql.includes("'jack'")) {
    await db.batch(
      [
        `DROP TABLE IF EXISTS agent_task_events_next`,
        EVENTS_DDL("agent_task_events_next"),
        `INSERT INTO agent_task_events_next (id, agent_task_id, user_id, run_id, actor, kind, detail, created_at)
         SELECT id, agent_task_id, user_id, run_id,
                CASE WHEN actor = 'jack' THEN 'agent' ELSE actor END,
                CASE WHEN kind = 'sent_to_jack' THEN 'sent_to_agent' ELSE kind END,
                detail, created_at
         FROM agent_task_events`,
        `DROP TABLE agent_task_events`,
        `ALTER TABLE agent_task_events_next RENAME TO agent_task_events`,
      ],
      "write"
    );
    touched = true;
    log("  agent_task_events actor... generalized");
  }

  if (touched) report.steps.push({ label: "early draft schema", status: "applied" });
}

const NEEDS_DISPATCH_QUEUED =
  "Queued before delegated tasks moved to the new runtime, and never run. Nothing was sent anywhere. Send it when you are ready.";
const NEEDS_DISPATCH_REVISION =
  "A revision requested before delegated tasks moved to the new runtime, and never run. Nothing was sent anywhere. Send it when you are ready.";
const NEEDS_REVIEW_PROCESSING =
  "Was mid-run on the earlier executor when it was replaced. Its result is unknown and nothing was saved. Send it again, or reject it.";
const NEEDS_REVIEW_MISSING_SOURCE =
  "The record this task was about no longer exists, so it cannot be sent as it was. Reject it, or send it with a fresh instruction.";
const NEEDS_REVIEW_EMPTY =
  "This task has no instruction to send. Reject it, or recreate it with one.";

/**
 * Bring work the earlier executor left pending into the lifecycle.
 *
 * Parked rows get a coarse status the *outgoing* deployment's cron never
 * selects: this runs in `prebuild`, while the previous build is still live
 * and still executes `queued`, `revision_requested` and retryable `failed`
 * rows. `failed` with the retry budget spent, or `awaiting_review` where a
 * version exists, are the two statuses that cron never touches.
 */
async function handleLegacyPendingWork(
  db: Client,
  runtime: string,
  log: (message: string) => void
): Promise<{ toQueue: number; toNeedsDispatch: number; toNeedsReview: number }> {
  const keepRunning = runtime === "openrouter";
  const res = await db.execute(
    `SELECT id, status, description, source_type, source_id, user_id
     FROM agent_tasks
     WHERE runtime_state IS NULL AND status IN ('queued', 'revision_requested', 'processing')`
  );

  let toQueue = 0;
  let toNeedsDispatch = 0;
  let toNeedsReview = 0;

  for (const row of res.rows) {
    const id = String(row.id);
    const status = String(row.status);
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const sourceType = typeof row.source_type === "string" ? row.source_type : "task";
    const sourceId = typeof row.source_id === "string" && row.source_id ? row.source_id : null;

    let state: "queued" | "needs_dispatch" | "needs_review";
    let reason: string | null;

    if (status === "processing") {
      state = "needs_review";
      reason = NEEDS_REVIEW_PROCESSING;
    } else if (!description) {
      state = "needs_review";
      reason = NEEDS_REVIEW_EMPTY;
    } else if (sourceId && SOURCE_TABLES[sourceType] && !(await sourceExists(db, sourceType, sourceId, String(row.user_id)))) {
      state = "needs_review";
      reason = NEEDS_REVIEW_MISSING_SOURCE;
    } else if (keepRunning) {
      // OpenRouter keeps running pending work, exactly as before the upgrade.
      // `queued` rows need nothing: the queue pass adopts them. A pending
      // revision is put in the queue explicitly, since adoption only takes
      // `queued` rows.
      if (status === "revision_requested") {
        await db.execute({
          sql: `UPDATE agent_tasks SET runtime_state = 'queued',
                  runtime_session_id = 'brain-portal-task-' || id
                WHERE id = ? AND runtime_state IS NULL`,
          args: [id],
        });
      }
      toQueue++;
      continue;
    } else {
      state = "needs_dispatch";
      reason = status === "revision_requested" ? NEEDS_DISPATCH_REVISION : NEEDS_DISPATCH_QUEUED;
    }

    const coarse = status === "revision_requested" ? "awaiting_review" : "failed";
    if (state === "needs_dispatch") toNeedsDispatch++;
    else toNeedsReview++;

    await db.batch(
      [
        {
          sql: `UPDATE agent_tasks
                SET runtime_state = ?, status = ?, last_error = ?,
                    retry_count = COALESCE(max_retries, 3),
                    runtime_session_id = 'brain-portal-task-' || id
                WHERE id = ? AND runtime_state IS NULL`,
          args: [state, coarse, reason, id],
        },
        {
          sql: `INSERT INTO agent_task_events (agent_task_id, user_id, actor, kind, detail)
                VALUES (?, ?, 'system', ?, ?)`,
          args: [id, String(row.user_id), state, JSON.stringify({ from_status: status, reason })],
        },
      ],
      "write"
    );
  }

  log(
    `  legacy pending work: ${toQueue} left running, ${toNeedsDispatch} parked as not sent, ${toNeedsReview} flagged for review`
  );
  return { toQueue, toNeedsDispatch, toNeedsReview };
}

async function sourceExists(db: Client, sourceType: string, sourceId: string, userId: string): Promise<boolean> {
  const table = SOURCE_TABLES[sourceType];
  try {
    const res = await db.execute({
      sql: `SELECT 1 FROM ${table} WHERE id = ? AND user_id = ? LIMIT 1`,
      args: [sourceId, userId],
    });
    return res.rows.length > 0;
  } catch {
    // The source table is missing here. Do not guess: flag it for review.
    return false;
  }
}
