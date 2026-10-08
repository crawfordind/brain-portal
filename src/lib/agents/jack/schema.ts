/**
 * Schema for running delegated tasks on Jack, and the one-time handling of
 * work the retired OpenRouter runtime left behind.
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

export interface JackMigrationReport {
  steps: Array<{ label: string; status: "applied" | "skipped" }>;
  /** Present only on the first application, when legacy rows were examined. */
  legacy?: {
    toNeedsDispatch: number;
    toNeedsReview: number;
  };
}

const AGENT_TASK_COLUMNS: Array<{ name: string; ddl: string }> = [
  // NULL = a row the retired OpenRouter runtime owned (read-only history).
  { name: "runtime", ddl: "ALTER TABLE agent_tasks ADD COLUMN runtime TEXT" },
  { name: "jack_state", ddl: "ALTER TABLE agent_tasks ADD COLUMN jack_state TEXT" },
  { name: "jack_session_id", ddl: "ALTER TABLE agent_tasks ADD COLUMN jack_session_id TEXT" },
];

const CREATE_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "agent_task_runs",
    sql: `CREATE TABLE IF NOT EXISTS agent_task_runs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      runtime TEXT NOT NULL DEFAULT 'jack',
      kind TEXT NOT NULL CHECK (kind IN ('initial', 'revision', 'retry')),
      idempotency_key TEXT NOT NULL UNIQUE,
      request_body TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'dispatching' CHECK (state IN (
        'dispatching', 'running', 'awaiting_approval', 'stopping',
        'completed', 'failed', 'cancelled', 'interrupted', 'lost', 'abandoned')),
      hermes_run_id TEXT,
      hermes_session_id TEXT,
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
  {
    // The audit trail: what happened to a task, who did it, which run.
    label: "agent_task_events",
    sql: `CREATE TABLE IF NOT EXISTS agent_task_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL,
      run_id TEXT,
      actor TEXT NOT NULL CHECK (actor IN ('user', 'jack', 'system')),
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  },
  {
    label: "idx_agent_task_events_task",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_task_events_task ON agent_task_events(agent_task_id, created_at)`,
  },
];

const POST_COLUMN_STATEMENTS: Array<{ label: string; sql: string }> = [
  {
    label: "idx_agent_tasks_jack",
    sql: `CREATE INDEX IF NOT EXISTS idx_agent_tasks_jack ON agent_tasks(runtime, jack_state, updated_at)`,
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

/** Source tables per delegation source type, for the "does the source still exist?" check. */
const SOURCE_TABLES: Record<string, string> = {
  task: "tasks",
  note: "notes",
  capture: "captures",
  thought: "captures",
  reminder: "reminders",
  insight: "insights",
};

export async function applyJackRuntimeMigration(
  db: Client,
  log: (message: string) => void = () => {}
): Promise<JackMigrationReport> {
  const report: JackMigrationReport = { steps: [] };

  // The runs table is created by this migration and nothing else, so its
  // absence marks the first application. Legacy rows are examined exactly
  // then: running that step on every build would sweep up fresh rows that
  // MCP or heartbeat inserted moments earlier and park them for no reason.
  const firstApplication = !(await tableExists(db, "agent_task_runs"));

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
    const existed =
      label.startsWith("idx_")
        ? (await db.execute({
            sql: `SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?`,
            args: [label],
          })).rows.length > 0
        : await tableExists(db, label);
    await db.execute(sql);
    report.steps.push({ label, status: existed ? "skipped" : "applied" });
    log(`  ${label}... ${existed ? "exists, skipping" : "ok"}`);
  }

  if (firstApplication) {
    report.legacy = await parkLegacyPendingWork(db, log);
  }

  return report;
}

const NEEDS_DISPATCH_QUEUED =
  "Queued under the retired OpenRouter runtime and never run. Nothing was sent anywhere. Send it to Jack when you are ready.";
const NEEDS_DISPATCH_REVISION =
  "A revision requested under the retired OpenRouter runtime and never run. Nothing was sent anywhere. Send it to Jack when you are ready.";
const NEEDS_REVIEW_PROCESSING =
  "Was mid-run on the retired OpenRouter runtime when it was switched off. Its result is unknown and nothing was saved. Send it to Jack again, or reject it.";
const NEEDS_REVIEW_MISSING_SOURCE =
  "The record this task was about no longer exists, so it cannot be sent as it was. Reject it, or send it to Jack with a fresh instruction.";
const NEEDS_REVIEW_EMPTY =
  "This task has no instruction to send. Reject it, or recreate it with one.";

/**
 * Move work the OpenRouter runtime would have picked up into states nothing
 * executes automatically. Pending work is *parked*, never auto-sent: it may be
 * stale, and Daniel decides whether Jack should do it.
 */
async function parkLegacyPendingWork(
  db: Client,
  log: (message: string) => void
): Promise<{ toNeedsDispatch: number; toNeedsReview: number }> {
  const res = await db.execute(
    `SELECT id, status, description, source_type, source_id, user_id
     FROM agent_tasks
     WHERE runtime IS NULL AND status IN ('queued', 'revision_requested', 'processing')`
  );

  let toNeedsDispatch = 0;
  let toNeedsReview = 0;

  for (const row of res.rows) {
    const id = String(row.id);
    const status = String(row.status);
    const description = typeof row.description === "string" ? row.description.trim() : "";
    const sourceType = typeof row.source_type === "string" ? row.source_type : "task";
    const sourceId = typeof row.source_id === "string" && row.source_id ? row.source_id : null;

    let state: "needs_dispatch" | "needs_review";
    let reason: string;

    if (status === "processing") {
      state = "needs_review";
      reason = NEEDS_REVIEW_PROCESSING;
    } else if (!description) {
      state = "needs_review";
      reason = NEEDS_REVIEW_EMPTY;
    } else if (sourceId && SOURCE_TABLES[sourceType] && !(await sourceExists(db, sourceType, sourceId, String(row.user_id)))) {
      state = "needs_review";
      reason = NEEDS_REVIEW_MISSING_SOURCE;
    } else {
      state = "needs_dispatch";
      reason = status === "revision_requested" ? NEEDS_DISPATCH_REVISION : NEEDS_DISPATCH_QUEUED;
    }

    // The coarse status is chosen so the *outgoing* deployment's cron cannot
    // pick the row up: this runs in `prebuild`, while the previous build is
    // still live and still executes `queued`, `revision_requested` and
    // retryable `failed` rows through OpenRouter. `failed` with its retry
    // budget spent, or `awaiting_review` where a version exists, are the two
    // statuses that cron never touches. `jack_state` is what the UI shows.
    const coarse = status === "revision_requested" ? "awaiting_review" : "failed";
    if (state === "needs_dispatch") toNeedsDispatch++;
    else toNeedsReview++;

    await db.batch(
      [
        {
          sql: `UPDATE agent_tasks
                SET runtime = 'jack', jack_state = ?, status = ?, last_error = ?,
                    retry_count = COALESCE(max_retries, 3),
                    jack_session_id = 'brain-portal-task-' || id
                WHERE id = ? AND runtime IS NULL`,
          args: [state, coarse, reason, id],
        },
        {
          sql: `INSERT INTO agent_task_events (agent_task_id, user_id, actor, kind, detail)
                VALUES (?, ?, 'system', ?, ?)`,
          args: [
            id,
            String(row.user_id),
            state,
            JSON.stringify({ from_status: status, reason }),
          ],
        },
      ],
      "write"
    );
  }

  log(`  legacy pending work: ${toNeedsDispatch} parked as not sent, ${toNeedsReview} flagged for review`);
  return { toNeedsDispatch, toNeedsReview };
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
