/**
 * Note templates against a real in-memory libsql database: the migration,
 * the store's scoping, series suggestions over real rows, and the MCP tools
 * over a real client/server pair.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";

const { testDb } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return { testDb: createClient({ url: ":memory:" }) };
});

vi.mock("@/lib/db/client", () => {
  const query = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r }));
  const queryOne = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null;
  return { db: testDb, query, queryAll: query, queryOne, mutate: queryOne };
});

vi.mock("@/lib/ai/embeddings", () => ({ findSimilarToText: vi.fn(async () => []) }));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { schema } from "@/lib/db/schema";
import { applyNoteSharingMigration } from "@/lib/sharing/schema";
import { applyTemplateMigration } from "@/lib/templates/schema";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  loadReadableNotes,
  loadSeriesNotes,
  recordTemplateUse,
  updateTemplate,
} from "@/lib/templates/store";
import { findSeries } from "@/lib/templates/series";
import { registerAllTools } from "@/mcp/tools";
import { createToolContext } from "@/mcp/guard";
import { resetRateLimits } from "@/mcp/rate-limit";

const OWNER = "owner";
const STRANGER = "stranger";

async function setupSchema() {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await testDb.execute(s);
  await testDb.execute("ALTER TABLE notes ADD COLUMN share_token TEXT");
  await testDb.execute("ALTER TABLE notes ADD COLUMN shared_at TEXT");
  await applyNoteSharingMigration(testDb);
  await applyTemplateMigration(testDb);
  await applyTemplateMigration(testDb); // idempotent: the build runs it every time
  await testDb.execute("PRAGMA foreign_keys = ON");
}

async function addNote(id: string, userId: string, title: string, projectId: string | null, day: string, content = "") {
  await testDb.execute({
    sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, project_id, created_at)
          VALUES (?, ?, ?, ?, ?, '', ?, ?)`,
    args: [id, userId, title, id, content, projectId, `${day} 09:00:00`],
  });
}

const OPS_BODY = "<h2>Attendees</h2><p>x</p><h2>Metrics</h2><p>y</p><h2>Action items</h2>";

async function reset() {
  for (const t of ["note_templates", "note_shares", "project_collaborators", "notes", "projects", "notification_preferences", "users"]) {
    await testDb.execute(`DELETE FROM ${t}`);
  }
  await testDb.execute(`INSERT INTO users (id, email) VALUES ('${OWNER}', 'owner@example.com'), ('${STRANGER}', 'stranger@example.com')`);
  await testDb.execute(`INSERT INTO projects (id, user_id, name, slug) VALUES ('p1', '${OWNER}', 'Northwind', 'northwind')`);
  await addNote("o1", OWNER, "Operations meeting 2026-10-06", "p1", "2026-10-06", OPS_BODY);
  await addNote("o2", OWNER, "Operations meeting 2026-10-13", "p1", "2026-10-13", OPS_BODY);
  await addNote("o3", OWNER, "Operations Meeting – Oct 20", "p1", "2026-10-20", OPS_BODY);
  await addNote("x1", OWNER, "Supplier list", "p1", "2026-10-02", "<p>one-off</p>");
  await addNote("s1", STRANGER, "Private", null, "2026-10-02", "<p>secret</p>");
}

beforeAll(setupSchema);
beforeEach(reset);

describe("template store", () => {
  it("creates, lists project-first, updates and deletes, scoped to the owner", async () => {
    const general = await createTemplate(OWNER, { name: "Standup", content: "<h2>Yesterday</h2>" });
    const ops = await createTemplate(OWNER, { name: "Ops", content: OPS_BODY, project_id: "p1", title_pattern: "Ops {{date}}" });
    await recordTemplateUse(general.id, OWNER);

    expect((await listTemplates(OWNER, "p1")).map((t) => t.id)).toEqual([ops.id, general.id]);
    expect((await listTemplates(OWNER)).map((t) => t.id)).toEqual([general.id, ops.id]);
    expect(ops.project_name).toBe("Northwind");

    await expect(getTemplate(ops.id, STRANGER)).rejects.toMatchObject({ status: 404 });
    await expect(updateTemplate(ops.id, STRANGER, { name: "x" })).rejects.toMatchObject({ status: 404 });
    await expect(deleteTemplate(ops.id, STRANGER)).rejects.toMatchObject({ status: 404 });

    const renamed = await updateTemplate(ops.id, OWNER, { name: "Weekly ops", project_id: null });
    expect(renamed.name).toBe("Weekly ops");
    expect(renamed.project_id).toBeNull();

    await deleteTemplate(ops.id, OWNER);
    expect(await listTemplates(OWNER)).toHaveLength(1);
  });

  it("refuses a project the user cannot open, and a nameless template", async () => {
    await expect(createTemplate(STRANGER, { name: "x", project_id: "p1" })).rejects.toMatchObject({ status: 404 });
    await expect(createTemplate(OWNER, { name: "  " })).rejects.toMatchObject({ status: 400 });
  });

  it("keeps the template when its project is deleted", async () => {
    const t = await createTemplate(OWNER, { name: "Ops", project_id: "p1" });
    await testDb.execute("DELETE FROM notes WHERE project_id = 'p1'");
    await testDb.execute("DELETE FROM projects WHERE id = 'p1'");
    expect((await getTemplate(t.id, OWNER)).project_id).toBeNull();
  });

  it("finds the weekly meeting in a project's real rows", async () => {
    const { notes } = await loadSeriesNotes(OWNER, "p1");
    const [series] = findSeries(notes);
    expect(series.note_ids).toEqual(["o3", "o2", "o1"]);
    expect(series.cadence).toBe("weekly");
    await expect(loadSeriesNotes(STRANGER, "p1")).rejects.toMatchObject({ status: 404 });
  });

  it("only hands over notes the user can open", async () => {
    const notes = await loadReadableNotes(["o1", "s1", "missing"], OWNER);
    expect(notes.map((n) => n.id)).toEqual(["o1"]);
  });
});

describe("over MCP", () => {
  async function connect(userId: string, scopes: string[]) {
    resetRateLimits();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(
      server,
      createToolContext(() => ({ userId, keyId: `k-${userId}`, keyName: "Claude Desktop", scopes, rateLimitPerMinute: 1000 }))
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as { content: Array<{ text: string }>; isError?: boolean };
    const text = result.content[0]?.text ?? "";
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      // plain-text error
    }
    return { isError: !!result.isError, body };
  }

  it("suggests, saves and starts this week's meeting note with variables filled", async () => {
    await testDb.execute(`INSERT INTO notification_preferences (user_id, timezone) VALUES ('${OWNER}', 'America/New_York')`);
    const agent = await connect(OWNER, ["notes:read", "notes:write"]);

    const suggested = await call(agent, "suggest_note_templates", { project_id: "p1" });
    const suggestions = suggested.body.suggestions as Array<{ label: string; note_ids: string[] }>;
    expect(suggestions[0].note_ids).toEqual(["o3", "o2", "o1"]);

    const saved = await call(agent, "create_note_template", {
      name: "Operations meeting",
      title_pattern: "Operations meeting {{date}}",
      content: "<h2>{{project}} metrics</h2><p></p>",
      project_id: "p1",
    });
    const templateId = saved.body.template_id as string;
    expect(templateId).toBeTruthy();

    const listed = await call(agent, "list_note_templates", { project_id: "p1" });
    expect((listed.body.templates as Array<{ id: string }>)[0].id).toBe(templateId);

    const made = await call(agent, "create_note_from_template", { template_id: templateId });
    expect(made.isError).toBe(false);
    const row = (await testDb.execute({ sql: "SELECT * FROM notes WHERE id = ?", args: [made.body.note_id as string] })).rows[0];
    expect(row.title).toMatch(/^Operations meeting \d{4}-\d{2}-\d{2}$/);
    expect(row.content).toBe("<h2>Northwind metrics</h2><p></p>");
    expect(row.project_id).toBe("p1");
    expect(row.source_label).toBe("Claude Desktop");
    expect((await getTemplate(templateId, OWNER)).use_count).toBe(1);

    // A covered series now ranks as covered.
    const again = await call(agent, "suggest_note_templates", { project_id: "p1" });
    expect((again.body.suggestions as Array<{ has_template: boolean }>)[0].has_template).toBe(true);
  });

  it("checks scopes and ownership", async () => {
    const t = await createTemplate(OWNER, { name: "Ops", content: "x" });
    const readOnly = await connect(OWNER, ["notes:read"]);
    expect((await call(readOnly, "create_note_from_template", { template_id: t.id })).isError).toBe(true);
    const stranger = await connect(STRANGER, ["notes:read", "notes:write"]);
    const res = await call(stranger, "create_note_from_template", { template_id: t.id });
    expect(res.isError).toBe(true);
    expect(res.body.message).toBe("Template not found");
  });
});
