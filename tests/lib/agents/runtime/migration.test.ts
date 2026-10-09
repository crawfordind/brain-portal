/**
 * The delegated-task runtime migration on a real in-memory database, starting
 * from the schema as it stood before it. Historical rows must stay readable
 * and untouched. What happens to pending work depends on the runtime: on
 * OpenRouter (the default) it keeps running as it did before the upgrade; on
 * Hermes or off it is parked where nothing executes it, including the previous
 * deployment's cron, which is still live while `prebuild` runs this.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { applyAgentRuntimeMigration, columnExists } from "@/lib/agents/runtime/schema";
import { applySchema } from "../../../helpers/agent-runtime";

let db: Client;

type Row = Record<string, unknown>;
const rows = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows.map((r) => ({ ...r }));
const row = async (sql: string): Promise<Row> => (await rows(sql))[0];

async function seedLegacy() {
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'owner@example.com')`);
  await db.execute(`INSERT INTO notes (id, user_id, title, slug, content) VALUES ('n1', 'u1', 'Plan', 'plan', 'x')`);
  const insert = (id: string, status: string, extra = "", values = "") =>
    db.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status${extra})
                VALUES ('${id}', 'u1', '${id}', 'Do the thing', 'general', 'general', '${status}'${values})`);
  await insert("queued1", "queued");
  await insert("revise1", "revision_requested", ", current_version", ", 1");
  await insert("running1", "processing");
  await insert("orphan1", "queued", ", source_type, source_id", ", 'note', 'gone'");
  await insert("withnote", "queued", ", source_type, source_id", ", 'note', 'n1'");
  await insert("done1", "approved", ", current_version", ", 1");
  await insert("review1", "awaiting_review", ", current_version", ", 1");
  await insert("failed1", "failed", ", last_error", ", '402 Insufficient credits'");
  await db.execute(`INSERT INTO agent_task_outputs (agent_task_id, version_number, content, model_used)
                    VALUES ('done1', 1, 'An OpenRouter answer', 'minimax/minimax-m2.7'),
                           ('review1', 1, 'Another answer', 'openai/gpt-5'),
                           ('revise1', 1, 'First draft', 'openai/gpt-5')`);
}

beforeEach(async () => {
  db = createClient({ url: ":memory:" });
  await applySchema(db, { migrate: false });
  await seedLegacy();
});

describe("applyAgentRuntimeMigration", () => {
  it("adds the columns and tables", async () => {
    await applyAgentRuntimeMigration(db);
    expect(await columnExists(db, "agent_task_runs", "external_run_id")).toBe(true);
    for (const column of ["runtime", "runtime_state", "runtime_session_id"]) {
      expect(await columnExists(db, "agent_tasks", column)).toBe(true);
    }
    const tables = (await rows(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["agent_task_runs", "agent_task_events"]));
  });

  it("on OpenRouter, keeps pending work running and flags only what cannot be mapped safely", async () => {
    const report = await applyAgentRuntimeMigration(db, { runtime: "openrouter" });
    expect(report.legacy).toEqual({ toQueue: 3, toNeedsDispatch: 0, toNeedsReview: 2 });

    const byId = Object.fromEntries(
      (await rows(`SELECT id, runtime, runtime_state, status FROM agent_tasks`)).map((r) => [r.id, r])
    );
    // Queued rows are left for the queue pass to adopt, exactly as new MCP rows are.
    expect(byId.queued1).toMatchObject({ runtime: null, runtime_state: null, status: "queued" });
    expect(byId.withnote).toMatchObject({ runtime_state: null, status: "queued" });
    // A pending revision is queued explicitly, since adoption only takes 'queued' rows.
    expect(byId.revise1).toMatchObject({ runtime_state: "queued", status: "revision_requested" });
    // A run that was in flight has an unknown result on any runtime.
    expect(byId.running1).toMatchObject({ runtime_state: "needs_review", status: "failed" });
    expect(byId.orphan1).toMatchObject({ runtime_state: "needs_review" });
  });

  it("defaults to OpenRouter's behaviour when no runtime is given", async () => {
    const report = await applyAgentRuntimeMigration(db);
    expect(report.legacy?.toQueue).toBe(3);
  });

  it("on Hermes, parks pending work as not sent, and flags what cannot be mapped safely", async () => {
    const report = await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    expect(report.legacy).toEqual({ toQueue: 0, toNeedsDispatch: 3, toNeedsReview: 2 });

    const byId = Object.fromEntries(
      (await rows(`SELECT id, runtime, runtime_state, status, last_error FROM agent_tasks`)).map((r) => [r.id, r])
    );
    // The runtime is stamped when work actually runs, not when it is parked.
    expect(byId.queued1).toMatchObject({ runtime: null, runtime_state: "needs_dispatch" });
    expect(byId.withnote).toMatchObject({ runtime_state: "needs_dispatch" });
    expect(byId.revise1).toMatchObject({ runtime_state: "needs_dispatch", status: "awaiting_review" });
    expect(byId.running1).toMatchObject({ runtime_state: "needs_review", status: "failed" });
    expect(String(byId.running1.last_error)).toMatch(/result is unknown/);
    expect(byId.orphan1).toMatchObject({ runtime_state: "needs_review" });
    expect(String(byId.orphan1.last_error)).toMatch(/no longer exists/);

    const events = await rows(`SELECT agent_task_id, actor, kind FROM agent_task_events ORDER BY agent_task_id`);
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.actor === "system")).toBe(true);
  });

  it("parks pending work the same way when delegation is off", async () => {
    const report = await applyAgentRuntimeMigration(db, { runtime: "off" });
    expect(report.legacy).toEqual({ toQueue: 0, toNeedsDispatch: 3, toNeedsReview: 2 });
  });

  it("leaves history untouched and readable", async () => {
    await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    expect(await rows(`SELECT id, runtime, runtime_state, status FROM agent_tasks WHERE id IN ('done1','review1','failed1') ORDER BY id`)).toEqual([
      { id: "done1", runtime: null, runtime_state: null, status: "approved" },
      { id: "failed1", runtime: null, runtime_state: null, status: "failed" },
      { id: "review1", runtime: null, runtime_state: null, status: "awaiting_review" },
    ]);
    expect(await rows(`SELECT agent_task_id, content, model_used FROM agent_task_outputs ORDER BY agent_task_id`)).toEqual([
      { agent_task_id: "done1", content: "An OpenRouter answer", model_used: "minimax/minimax-m2.7" },
      { agent_task_id: "review1", content: "Another answer", model_used: "openai/gpt-5" },
      { agent_task_id: "revise1", content: "First draft", model_used: "openai/gpt-5" },
    ]);
  });

  it("on Hermes, hides parked rows from every query the outgoing OpenRouter cron ran", async () => {
    await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    // Verbatim WHERE clauses from the retired /api/cron/process-agent-queue.
    const oldCron = [
      `SELECT id FROM agent_tasks WHERE status = 'queued'`,
      `SELECT id FROM agent_tasks WHERE status = 'revision_requested'`,
      `SELECT id FROM agent_tasks WHERE status = 'processing'`,
      `SELECT id FROM agent_tasks WHERE status = 'failed'
         AND COALESCE(retry_count, 0) < COALESCE(max_retries, 3)`,
    ];
    const parked = new Set(["queued1", "revise1", "running1", "orphan1", "withnote"]);
    for (const sql of oldCron) {
      const hit = (await rows(sql)).map((r) => String(r.id)).filter((id) => parked.has(id));
      expect(hit, sql).toEqual([]);
    }
  });

  it("is idempotent, and only examines legacy rows on its first application", async () => {
    await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    // A row MCP inserts after the migration is new work, not legacy.
    await db.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                      VALUES ('fresh', 'u1', 'fresh', 'New', 'general', 'general', 'queued')`);

    const second = await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    expect(second.legacy).toBeUndefined();
    expect(second.steps.every((s) => s.status === "skipped")).toBe(true);
    expect(await row(`SELECT runtime, runtime_state FROM agent_tasks WHERE id = 'fresh'`)).toEqual({ runtime: null, runtime_state: null });
    expect(await rows(`SELECT id FROM agent_task_events`)).toHaveLength(5);
  });
});

describe("upgrading a database that ran the early draft", () => {
  /** The draft's names: jack_* task columns, hermes_* run columns, a 'jack' actor. */
  async function applyDraftSchema() {
    for (const ddl of [
      "ALTER TABLE agent_tasks ADD COLUMN runtime TEXT",
      "ALTER TABLE agent_tasks ADD COLUMN jack_state TEXT",
      "ALTER TABLE agent_tasks ADD COLUMN jack_session_id TEXT",
      `CREATE TABLE agent_task_runs (
        id TEXT PRIMARY KEY, agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, runtime TEXT NOT NULL DEFAULT 'jack',
        kind TEXT NOT NULL CHECK (kind IN ('initial', 'revision', 'retry')),
        idempotency_key TEXT NOT NULL UNIQUE, request_body TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'dispatching', hermes_run_id TEXT, hermes_session_id TEXT,
        dispatch_attempts INTEGER NOT NULL DEFAULT 0, last_dispatch_error TEXT, approval TEXT,
        runtime_model TEXT, tokens_input INTEGER, tokens_output INTEGER, output_version INTEGER,
        error TEXT, unreachable_since TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_polled_at TEXT, finished_at TEXT)`,
      `CREATE TABLE agent_task_events (
        id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        agent_task_id TEXT NOT NULL REFERENCES agent_tasks(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL, run_id TEXT,
        actor TEXT NOT NULL CHECK (actor IN ('user', 'jack', 'system')),
        kind TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
      "CREATE INDEX idx_agent_tasks_jack ON agent_tasks(runtime, jack_state, updated_at)",
    ]) {
      await db.execute(ddl);
    }
    await db.execute(`UPDATE agent_tasks SET runtime = 'jack', jack_state = 'awaiting_review' WHERE id = 'review1'`);
    await db.execute(`UPDATE agent_tasks SET runtime = 'jack', jack_state = 'needs_dispatch' WHERE id = 'queued1'`);
    await db.execute(`INSERT INTO agent_task_runs (id, agent_task_id, user_id, kind, idempotency_key, request_body, state, hermes_run_id, hermes_session_id)
                      VALUES ('r1', 'review1', 'u1', 'initial', 'k1', '{}', 'completed', 'run_9', 'brain-portal-task-review1')`);
    await db.execute(`INSERT INTO agent_task_events (agent_task_id, user_id, actor, kind)
                      VALUES ('review1', 'u1', 'user', 'sent_to_jack'), ('review1', 'u1', 'jack', 'output_ready')`);
  }

  it("renames to the generic schema and keeps every row", async () => {
    await applyDraftSchema();
    const report = await applyAgentRuntimeMigration(db, { runtime: "hermes" });

    expect(report.steps.find((s) => s.label === "early draft schema")?.status).toBe("applied");
    // Not a first application: the draft already parked its legacy rows.
    expect(report.legacy).toBeUndefined();
    expect(await columnExists(db, "agent_tasks", "jack_state")).toBe(false);
    expect(await row(`SELECT runtime, runtime_state FROM agent_tasks WHERE id = 'review1'`)).toEqual({
      runtime: "hermes",
      runtime_state: "awaiting_review",
    });
    // A parked row never ran anywhere, so it carries no runtime.
    expect(await row(`SELECT runtime, runtime_state FROM agent_tasks WHERE id = 'queued1'`)).toEqual({
      runtime: null,
      runtime_state: "needs_dispatch",
    });
    expect(await row(`SELECT runtime, external_run_id, session_id FROM agent_task_runs WHERE id = 'r1'`)).toEqual({
      runtime: "hermes",
      external_run_id: "run_9",
      session_id: "brain-portal-task-review1",
    });
    expect(await rows(`SELECT actor, kind FROM agent_task_events ORDER BY actor`)).toEqual([
      { actor: "agent", kind: "output_ready" },
      { actor: "user", kind: "sent_to_agent" },
    ]);
    const indexes = (await rows(`SELECT name FROM sqlite_master WHERE type = 'index'`)).map((r) => r.name);
    expect(indexes).not.toContain("idx_agent_tasks_jack");
    expect(indexes).toContain("idx_agent_tasks_runtime");

    // And a second run is a no-op.
    const again = await applyAgentRuntimeMigration(db, { runtime: "hermes" });
    expect(again.steps.find((s) => s.label === "early draft schema")).toBeUndefined();
  });
});
