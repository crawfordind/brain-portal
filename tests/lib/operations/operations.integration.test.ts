/**
 * The Operations layer against a real in-memory libsql database, seeded with a
 * small but representative workspace: a venture, contacts, projects (one live,
 * one imported and untouched, one in planning), tasks with and without
 * operational metadata, a recurring task, a capture and a failing heartbeat.
 *
 * What these pin down is the brief's guardrails: existing rows read as they
 * always did, every write is scoped to one record and the owner, sibling
 * metadata survives, and every write can be put back exactly.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => {
  const run = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows;
  return {
    db: testDb,
    query: run,
    queryAll: run,
    queryOne: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
    mutate: async (sql: string, args: unknown[] = []) => (await run(sql, args))[0] ?? null,
  };
});

import { schema } from "@/lib/db/schema";
import { applyCrmPhase0Migration } from "@/lib/crm/schema";
import { restorePatch } from "@/lib/operations/fields";
import { filterView } from "@/lib/operations/classify";
import {
  createOpsItem,
  getOperationsOverview,
  getOpsItem,
  loadOpenItems,
  updateOpsItem,
} from "@/lib/operations/queries";
import { getPortfolio, setLaneState } from "@/lib/operations/portfolio";
import { actOnCapture, listIntake } from "@/lib/operations/intake";
import { getRelationships } from "@/lib/operations/people";
import { getAutomationHealth, alertsOnly } from "@/lib/operations/automations";

const USER = "u1";
const OTHER = "u2";
const NOW = new Date("2026-10-08T15:00:00Z");

async function setupSchema() {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await testDb.execute(s);
  await applyCrmPhase0Migration(testDb);
}

const TABLES = [
  "heartbeat_logs",
  "heartbeat_tasks",
  "captures",
  "tasks",
  "notes",
  "interactions",
  "entity_edges",
  "entity_aliases",
  "entities",
  "projects",
  "users",
];

async function exec(sql: string, args: unknown[] = []) {
  await testDb.execute({ sql, args });
}

async function seed() {
  // Spawned recurrences and cross-table links make delete order fragile;
  // clearing with FKs off is a test-fixture reset, not a behaviour under test.
  await exec("PRAGMA foreign_keys = OFF");
  for (const t of TABLES) await exec(`DELETE FROM ${t}`);
  await exec("PRAGMA foreign_keys = ON");
  await exec(`INSERT INTO users (id, email) VALUES (?, 'd@example.com'), (?, 'x@example.com')`, [USER, OTHER]);

  await exec(
    `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type, metadata) VALUES
     ('v1', ?, 'Harbor Co-op', 'harborcoop', 'org', '{"is_venture":true}'),
     ('e1', ?, 'Will', 'will', 'person', '{"crm":{"relationship_stage":"vendor"}}'),
     ('e2', ?, 'Dana Reyes', 'danareyes', 'person', '{}')`,
    [USER, USER, USER]
  );

  await exec(
    `INSERT INTO projects (id, user_id, name, slug, status, venture_id, updated_at) VALUES
     ('p1', ?, 'Corner Store', 'corner-store', 'active', 'v1', '2026-10-01 10:00:00'),
     ('p2', ?, 'Old Import', 'old-import', 'active', NULL, '2025-01-01 10:00:00'),
     ('p3', ?, 'Seed Library', 'seed-library', 'planning', NULL, '2026-09-01 10:00:00')`,
    [USER, USER, USER]
  );

  await exec(
    `INSERT INTO tasks (id, user_id, project_id, content, status, priority, due_date, metadata, recurrence_rule) VALUES
     ('t1', ?, 'p1', 'Reorder register tape', 'pending', 'medium', '2026-10-01', '{"legacy":true}', NULL),
     ('t2', ?, 'p1', 'Cooler quote', 'pending', 'medium', NULL,
        '{"ops":{"kind":"waiting","counterparty":"Will","counterparty_entity_id":"e1","expected_at":"2026-10-05"}}', NULL),
     ('t3', ?, NULL, 'Which seed supplier', 'pending', 'high', '2026-10-20',
        '{"ops":{"kind":"decision","why":"spring order","options":["Supplier A","Supplier B"]}}', NULL),
     ('t4', ?, NULL, 'Water the spawn', 'pending', 'medium', '2026-10-08', '{}', 'FREQ=DAILY'),
     ('t5', ?, 'p1', 'Done already', 'completed', 'low', '2026-09-01', '{}', NULL),
     ('tx', ?, NULL, 'Someone else''s task', 'pending', 'medium', NULL, '{}', NULL)`,
    [USER, USER, USER, USER, USER, OTHER]
  );

  await exec(
    `INSERT INTO captures (id, user_id, content, capture_type, captured_at, processed) VALUES
     ('c1', ?, 'Waiting on Will for the cooler quote for the Corner Store', 'thought', '2026-10-08 09:00:00', 0),
     ('c2', ?, 'Already handled', 'thought', '2026-10-07 09:00:00', 1)`,
    [USER, USER]
  );

  await exec(
    `INSERT INTO heartbeat_tasks (id, user_id, name, description, check_type, check_source, condition, action_type, enabled, last_run_at)
     VALUES ('h1', ?, 'Stale grant check', 'Flags grant tasks with no movement', 'stale_check', 'tasks', '{}', 'create_notification', 1, datetime('now'))`,
    [USER]
  );
  for (let i = 0; i < 3; i++) {
    await exec(
      `INSERT INTO heartbeat_logs (heartbeat_task_id, user_id, status, error_message, tick_time)
       VALUES ('h1', ?, 'error', 'no such column: grant_id', datetime('now', '-${i} minutes'))`,
      [USER]
    );
  }
}

beforeAll(setupSchema);
beforeEach(seed);

describe("overview", () => {
  it("puts each seeded item where the brief says it belongs", async () => {
    const overview = await getOperationsOverview(USER, NOW);
    const ids = (key: string) => overview.sections.find((s) => s.key === key)!.items.map((i) => i.id);

    expect(overview.today).toBe("2026-10-08");
    expect(ids("today").sort()).toEqual(["t1", "t4"]);
    expect(ids("waiting")).toEqual(["t2"]);
    expect(ids("decisions")).toEqual(["t3"]);
    expect(overview.intakeCount).toBe(1);
    // Completed work and other users' tasks never appear.
    const all = overview.sections.flatMap((s) => s.items.map((i) => i.id));
    expect(all).not.toContain("t5");
    expect(all).not.toContain("tx");
  });

  it("links each item to its source record and project", async () => {
    const item = await getOpsItem(USER, "t2");
    expect(item).toMatchObject({
      href: "/tasks?task=t2",
      projectSlug: "corner-store",
      ventureName: "Harbor Co-op",
    });
  });
});

describe("updating an item", () => {
  it("relabels one task, links the contact, keeps sibling metadata, and undoes exactly", async () => {
    const result = await updateOpsItem(USER, "t1", { ops: { kind: "waiting", counterparty: "Will" } });
    expect(result.item.ops).toMatchObject({ kind: "waiting", owner: "other", counterparty_entity_id: "e1" });
    expect(result.previous).toEqual({});

    const raw = await testDb.execute("SELECT metadata, status, due_date FROM tasks WHERE id = 't1'");
    expect(JSON.parse(String(raw.rows[0].metadata)).legacy).toBe(true);

    await updateOpsItem(USER, "t1", { ops: restorePatch(result.previous) });
    const back = await getOpsItem(USER, "t1");
    expect(back!.ops).toMatchObject({ kind: "action", owner: "me", blocked: false });
    expect(back!.ops.counterparty).toBeUndefined();
    expect(back!.dueDate).toBe("2026-10-01");
  });

  it("refuses another user's task", async () => {
    await expect(updateOpsItem(USER, "tx", { ops: { kind: "decision" } })).rejects.toMatchObject({ status: 404 });
    const raw = await testDb.execute("SELECT metadata FROM tasks WHERE id = 'tx'");
    expect(raw.rows[0].metadata).toBe("{}");
  });

  it("does not link an ambiguous name to a contact", async () => {
    await exec(
      `INSERT INTO entities (id, user_id, canonical_name, normalized_key, entity_type) VALUES ('e3', ?, 'will', 'will2', 'person')`,
      [USER]
    );
    const result = await updateOpsItem(USER, "t1", { ops: { kind: "waiting", counterparty: "Will" } });
    expect(result.item.ops.counterparty_entity_id).toBeUndefined();
  });

  it("recurs a recurring task completed from Operations, like every other path", async () => {
    await updateOpsItem(USER, "t4", { status: "completed" });
    const rows = await testDb.execute("SELECT id, status FROM tasks WHERE content = 'Water the spawn' ORDER BY created_at");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.map((r: Record<string, unknown>) => r.status).sort()).toEqual(["completed", "pending"]);
  });

  it("leaves a due date that carries a time untouched when the same day is re-saved", async () => {
    await exec(`UPDATE tasks SET due_date = '2026-10-01 17:00:00' WHERE id = 't1'`);
    await updateOpsItem(USER, "t1", { dueDate: "2026-10-01" });
    const raw = await testDb.execute("SELECT due_date FROM tasks WHERE id = 't1'");
    expect(raw.rows[0].due_date).toBe("2026-10-01 17:00:00");
  });
});

describe("creating an item", () => {
  it("writes an ordinary task that every view reads back", async () => {
    const item = await createOpsItem(USER, {
      title: "Pick a cooler vendor",
      projectId: "p1",
      ops: { kind: "decision", options: ["A", "B"] },
    });
    const raw = await testDb.execute({ sql: "SELECT user_id, status, source_actor FROM tasks WHERE id = ?", args: [item.id] });
    expect(raw.rows[0]).toMatchObject({ user_id: USER, status: "pending", source_actor: null });
    expect(filterView(await loadOpenItems(USER), "decisions").map((i) => i.id)).toContain(item.id);
  });

  it("rejects a project the user does not own", async () => {
    await exec(`INSERT INTO projects (id, user_id, name, slug) VALUES ('px', ?, 'Theirs', 'theirs')`, [OTHER]);
    await expect(createOpsItem(USER, { title: "x", projectId: "px" })).rejects.toMatchObject({ status: 404 });
  });
});

describe("portfolio", () => {
  it("groups by venture, derives states, and only suggests dormancy", async () => {
    const portfolio = await getPortfolio(USER, NOW);
    expect(portfolio.lanes[0].name).toBe("Harbor Co-op");
    const projects = portfolio.lanes.flatMap((l) => l.projects);
    const byId = Object.fromEntries(projects.map((p) => [p.id, p]));

    expect(byId.p1).toMatchObject({ laneState: "active", laneStateChosen: false, health: "at_risk" });
    expect(byId.p1.nextMove?.href).toBe("/tasks?task=t1");
    expect(byId.p2).toMatchObject({ laneState: "active", looksDormant: true });
    expect(byId.p3).toMatchObject({ laneState: "future", laneStateChosen: false });

    // Nothing was written by reading.
    const raw = await testDb.execute("SELECT status, metadata FROM projects WHERE id = 'p2'");
    expect(raw.rows[0]).toMatchObject({ status: "active", metadata: "{}" });
  });

  it("sets a lane state on one project without touching its status, and undoes", async () => {
    const result = await setLaneState(USER, "p2", "reference");
    expect(result).toEqual({ previous: null, next: "reference" });
    let raw = await testDb.execute("SELECT status, metadata, updated_at FROM projects WHERE id = 'p2'");
    expect(raw.rows[0].status).toBe("active");
    expect(raw.rows[0].updated_at).toBe("2025-01-01 10:00:00");

    const after = await getPortfolio(USER, NOW);
    const p2 = after.lanes.flatMap((l) => l.projects).find((p) => p.id === "p2")!;
    expect(p2).toMatchObject({ laneState: "reference", laneStateChosen: true, looksDormant: false });

    await setLaneState(USER, "p2", result.previous);
    raw = await testDb.execute("SELECT metadata FROM projects WHERE id = 'p2'");
    expect(JSON.parse(String(raw.rows[0].metadata))).toEqual({ ops: {} });
  });
});

describe("intake", () => {
  it("proposes without writing, confirms into a linked task, and reopens", async () => {
    const intake = await listIntake(USER, NOW);
    expect(intake.total).toBe(1);
    expect(intake.items[0].proposal).toMatchObject({
      kind: "waiting",
      counterparty: "Will",
      counterpartyEntityId: "e1",
      projectId: "p1",
    });
    let capture = await testDb.execute("SELECT processed, metadata FROM captures WHERE id = 'c1'");
    expect(Number(capture.rows[0].processed)).toBe(0);

    const result = await actOnCapture(USER, "c1", {
      action: "confirm",
      input: { kind: "waiting", counterparty: "Will", counterpartyEntityId: "e1", projectId: "p1" },
    });
    expect(result.outcome).toBe("confirmed");
    if (result.outcome !== "confirmed") return;
    expect(result.item.ops).toMatchObject({ kind: "waiting", source: { type: "capture", id: "c1" } });

    capture = await testDb.execute("SELECT processed, metadata FROM captures WHERE id = 'c1'");
    expect(Number(capture.rows[0].processed)).toBe(1);
    expect(JSON.parse(String(capture.rows[0].metadata)).triage).toMatchObject({ state: "confirmed", task_id: result.item.id });

    const undone = await actOnCapture(USER, "c1", { action: "reopen" });
    expect(undone).toMatchObject({ outcome: "reopened", cancelledTaskId: result.item.id });
    capture = await testDb.execute("SELECT processed, metadata FROM captures WHERE id = 'c1'");
    expect(Number(capture.rows[0].processed)).toBe(0);
    const task = await testDb.execute({ sql: "SELECT status FROM tasks WHERE id = ?", args: [result.item.id] });
    expect(task.rows[0].status).toBe("cancelled");
  });

  it("files reference material without creating anything", async () => {
    const before = await testDb.execute("SELECT COUNT(*) AS n FROM tasks");
    await actOnCapture(USER, "c1", { action: "file", projectId: "p1" });
    const after = await testDb.execute("SELECT COUNT(*) AS n FROM tasks");
    expect(after.rows[0].n).toBe(before.rows[0].n);
    const capture = await testDb.execute("SELECT linked_projects FROM captures WHERE id = 'c1'");
    expect(JSON.parse(String(capture.rows[0].linked_projects))).toEqual(["p1"]);
  });
});

describe("relationships", () => {
  it("shows what each person owes and is owed", async () => {
    const view = await getRelationships(USER, {}, NOW);
    const will = view.rows.find((r) => r.entityId === "e1")!;
    expect(will).toMatchObject({ name: "Will", stage: "vendor", href: "/crm/e1" });
    expect(will.theyOwe.map((i) => i.id)).toEqual(["t2"]);
    expect(will.youOwe).toEqual([]);
  });

  it("keeps an unknown counterparty, marked as not in contacts", async () => {
    await updateOpsItem(USER, "t3", { ops: { kind: "waiting", counterparty: "County Office" } });
    const view = await getRelationships(USER, {}, NOW);
    expect(view.rows.find((r) => r.name === "County Office")).toMatchObject({ entityId: null, href: null });
  });
});

describe("automations", () => {
  it("surfaces a repeatedly failing rule and keeps unobservable jobs out of alerts", async () => {
    const all = await getAutomationHealth(USER);
    const rule = all.find((a) => a.id === "heartbeat:h1")!;
    expect(rule).toMatchObject({ status: "failing" });
    expect(rule.signal).toContain("no such column");
    expect(all.find((a) => a.id === "n8n")!.status).toBe("not_connected");
    const alerts = alertsOnly(all).map((a) => a.id);
    expect(alerts).toContain("heartbeat:h1");
    expect(alerts).not.toContain("n8n");
    expect(alerts).not.toContain("notifications");
  });
});
