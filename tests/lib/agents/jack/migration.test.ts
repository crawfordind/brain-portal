/**
 * The Jack runtime migration on a real in-memory database, starting from the
 * schema as it stood before it. Historical rows must stay readable and
 * untouched; pending work must land where nothing executes it, including the
 * previous deployment's cron, which is still live while `prebuild` runs this.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { applyJackRuntimeMigration, columnExists } from "@/lib/agents/jack/schema";
import { applySchema } from "../../../helpers/jack";

let db: Client;

type Row = Record<string, unknown>;
const rows = async (sql: string): Promise<Row[]> => (await db.execute(sql)).rows.map((r) => ({ ...r }));
const row = async (sql: string): Promise<Row> => (await rows(sql))[0];

async function seedLegacy() {
  await db.execute(`INSERT INTO users (id, email) VALUES ('u1', 'daniel@example.com')`);
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

describe("applyJackRuntimeMigration", () => {
  it("adds the columns and tables", async () => {
    await applyJackRuntimeMigration(db);
    for (const column of ["runtime", "jack_state", "jack_session_id"]) {
      expect(await columnExists(db, "agent_tasks", column)).toBe(true);
    }
    const tables = (await rows(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(["agent_task_runs", "agent_task_events"]));
  });

  it("parks pending work as not sent, and flags what cannot be mapped safely", async () => {
    const report = await applyJackRuntimeMigration(db);
    expect(report.legacy).toEqual({ toNeedsDispatch: 3, toNeedsReview: 2 });

    const byId = Object.fromEntries(
      (await rows(`SELECT id, runtime, jack_state, status, last_error FROM agent_tasks`)).map((r) => [r.id, r])
    );
    expect(byId.queued1).toMatchObject({ runtime: "jack", jack_state: "needs_dispatch" });
    expect(byId.withnote).toMatchObject({ jack_state: "needs_dispatch" });
    expect(byId.revise1).toMatchObject({ jack_state: "needs_dispatch", status: "awaiting_review" });
    expect(byId.running1).toMatchObject({ jack_state: "needs_review", status: "failed" });
    expect(String(byId.running1.last_error)).toMatch(/result is unknown/);
    expect(byId.orphan1).toMatchObject({ jack_state: "needs_review" });
    expect(String(byId.orphan1.last_error)).toMatch(/no longer exists/);

    const events = await rows(`SELECT agent_task_id, actor, kind FROM agent_task_events ORDER BY agent_task_id`);
    expect(events).toHaveLength(5);
    expect(events.every((e) => e.actor === "system")).toBe(true);
  });

  it("leaves history untouched and readable", async () => {
    await applyJackRuntimeMigration(db);
    expect(await rows(`SELECT id, runtime, jack_state, status FROM agent_tasks WHERE id IN ('done1','review1','failed1') ORDER BY id`)).toEqual([
      { id: "done1", runtime: null, jack_state: null, status: "approved" },
      { id: "failed1", runtime: null, jack_state: null, status: "failed" },
      { id: "review1", runtime: null, jack_state: null, status: "awaiting_review" },
    ]);
    expect(await rows(`SELECT agent_task_id, content, model_used FROM agent_task_outputs ORDER BY agent_task_id`)).toEqual([
      { agent_task_id: "done1", content: "An OpenRouter answer", model_used: "minimax/minimax-m2.7" },
      { agent_task_id: "review1", content: "Another answer", model_used: "openai/gpt-5" },
      { agent_task_id: "revise1", content: "First draft", model_used: "openai/gpt-5" },
    ]);
  });

  it("hides parked rows from every query the outgoing OpenRouter cron ran", async () => {
    await applyJackRuntimeMigration(db);
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
    await applyJackRuntimeMigration(db);
    // A row MCP inserts after the migration is new work, not legacy.
    await db.execute(`INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status)
                      VALUES ('fresh', 'u1', 'fresh', 'New', 'general', 'general', 'queued')`);

    const second = await applyJackRuntimeMigration(db);
    expect(second.legacy).toBeUndefined();
    expect(second.steps.every((s) => s.status === "skipped")).toBe(true);
    expect(await row(`SELECT runtime, jack_state FROM agent_tasks WHERE id = 'fresh'`)).toEqual({ runtime: null, jack_state: null });
    expect(await rows(`SELECT id FROM agent_task_events`)).toHaveLength(5);
  });
});
