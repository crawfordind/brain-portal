/**
 * Notifications for Jack work, through the real scan on an in-memory database.
 *
 * Daniel hears when Jack pauses for an approval (once per request), when Jack
 * finishes, and when Jack fails. Work the migration parked, or that is simply
 * waiting for Jack to be connected, is not reported as a failure.
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
import { applySchema, resetData } from "../../../helpers/jack";

const insertTask = (id: string, status: string, runtime: string | null, jackState: string | null, title = id) =>
  testDb.execute({
    sql: `INSERT INTO agent_tasks (id, user_id, title, description, task_type, assigned_agent, status, runtime, jack_state, last_error)
          VALUES (?, 'u1', ?, 'd', 'general', 'general', ?, ?, ?, 'some reason')`,
    args: [id, title, status, runtime, jackState],
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

describe("Jack notifications", () => {
  it("alerts once per approval request, at high priority", async () => {
    await insertTask("t1", "processing", "jack", "awaiting_approval", "Venue research");
    await testDb.execute(`INSERT INTO agent_task_runs (agent_task_id, user_id, kind, idempotency_key, request_body, state, approval)
                          VALUES ('t1', 'u1', 'initial', 'k1', '{}', 'awaiting_approval', '{"requestId":"req-1","description":"create a note"}')`);

    await runNotificationScan("u1");
    await runNotificationScan("u1");

    const rows = (await notifications()).filter((n: Row) => n.entity_type === "agent_task_approval");
    expect(rows).toEqual([
      expect.objectContaining({ title: "Jack needs your approval: Venue research", entity_id: "t1:req-1", priority: "high" }),
    ]);
  });

  it("says Jack finished, and Jack failed, in Jack's name", async () => {
    await insertTask("done", "awaiting_review", "jack", "awaiting_review", "Draft");
    await insertTask("bad", "failed", "jack", "failed", "Broken");
    await runNotificationScan("u1");
    const titles = (await notifications()).map((n: Row) => n.title);
    expect(titles).toContain("Jack finished: Draft");
    expect(titles).toContain('Jack couldn\'t finish "Broken"');
  });

  it("does not report parked or not-yet-sent work as failed or finished", async () => {
    await insertTask("parked", "failed", "jack", "needs_dispatch", "Parked");
    await insertTask("flagged", "failed", "jack", "needs_review", "Flagged");
    await insertTask("revfail", "awaiting_review", "jack", "failed", "Revision failed");
    await runNotificationScan("u1");
    const titles = (await notifications()).map((n: Row) => String(n.title));
    expect(titles.some((t: string) => /Parked|Flagged/.test(t))).toBe(false);
    expect(titles).not.toContain("Jack finished: Revision failed");
  });

  it("keeps the historical wording for OpenRouter-era tasks", async () => {
    await insertTask("old", "failed", null, null, "Old one");
    await runNotificationScan("u1");
    expect((await notifications()).map((n: Row) => n.title)).toContain('AI general couldn\'t finish "Old one"');
  });
});
