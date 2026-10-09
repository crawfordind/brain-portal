/**
 * Notifications for delegated work, through the real scan on an in-memory
 * database, named with the configured display name.
 *
 * The user hears when the agent pauses for an approval (once per request),
 * when it finishes, and when it fails. Work the migration parked, or that is
 * simply waiting for a runtime to be configured, is not reported as a failure.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => {
  const run = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: Record<string, unknown>) => ({ ...r }));
  return {
    db: testDb,
    query: run,
    queryAll: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    mutate: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
  };
});
vi.mock("@/lib/notifications/emails", () => ({ sendNotificationEmail: vi.fn().mockResolvedValue(false) }));

import { runNotificationScan } from "@/lib/notifications/engine";
import { applySchema, resetData } from "../../../helpers/agent-runtime";

const insertTask = (id: string, status: string, runtime: string | null, runtimeState: string | null, title = id) =>
  testDb.execute({
    sql: `INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, runtime, runtime_state, last_error)
          VALUES (?, 'u1', ?, 'd', 'general', 'general', ?, ?, ?, 'some reason')`,
    args: [id, title, status, runtime, runtimeState],
  });

type Row = Record<string, unknown>;

async function notifications(): Promise<Row[]> {
  const res = await testDb.execute(`SELECT type, title, entity_type, entity_id, priority FROM notifications ORDER BY title`);
  return res.rows.map((r: Row) => ({ ...r }));
}

beforeAll(async () => {
  await applySchema(testDb);
});

beforeEach(async () => {
  await testDb.execute("DELETE FROM notifications");
  await resetData(testDb);
});

describe("delegated-task notifications", () => {
  it("alerts once per approval request, at high priority", async () => {
    await insertTask("t1", "processing", "hermes", "awaiting_approval", "Venue research");
    await testDb.execute(`INSERT INTO agent_task_runs (agent_task_id, user_id, runtime, kind, idempotency_key, request_body, state, approval)
                          VALUES ('t1', 'u1', 'hermes', 'initial', 'k1', '{}', 'awaiting_approval', '{"requestId":"req-1","description":"create a note"}')`);

    await runNotificationScan("u1");
    await runNotificationScan("u1");

    const rows = (await notifications()).filter((n: Row) => n.entity_type === "agent_task_approval");
    expect(rows).toEqual([
      expect.objectContaining({ title: "Agent needs your approval: Venue research", entity_id: "t1:req-1", priority: "high" }),
    ]);
  });

  it("says the agent finished, and failed, in its display name", async () => {
    await insertTask("done", "awaiting_review", "hermes", "awaiting_review", "Draft");
    await insertTask("bad", "failed", "hermes", "failed", "Broken");
    await runNotificationScan("u1");
    const titles = (await notifications()).map((n: Row) => n.title);
    expect(titles).toContain("Agent finished: Draft");
    expect(titles).toContain('Agent couldn\'t finish "Broken"');
  });

  it("does not report parked or not-yet-sent work as failed or finished", async () => {
    await insertTask("parked", "failed", "hermes", "needs_dispatch", "Parked");
    await insertTask("flagged", "failed", "hermes", "needs_review", "Flagged");
    await insertTask("revfail", "awaiting_review", "hermes", "failed", "Revision failed");
    await runNotificationScan("u1");
    const titles = (await notifications()).map((n: Row) => String(n.title));
    expect(titles.some((t: string) => /Parked|Flagged/.test(t))).toBe(false);
    expect(titles).not.toContain("Agent finished: Revision failed");
  });

  it("uses AGENT_DISPLAY_NAME when the operator sets one, on either runtime", async () => {
    vi.stubEnv("AGENT_DISPLAY_NAME", "Robin");
    try {
      await insertTask("done", "awaiting_review", "openrouter", "awaiting_review", "Draft");
      await runNotificationScan("u1");
      expect((await notifications()).map((n: Row) => n.title)).toContain("Robin finished: Draft");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("keeps the historical wording for tasks from before the lifecycle", async () => {
    await insertTask("old", "failed", null, null, "Old one");
    await runNotificationScan("u1");
    expect((await notifications()).map((n: Row) => n.title)).toContain('AI general couldn\'t finish "Old one"');
  });
});
