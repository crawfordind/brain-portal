/**
 * Whiteboards against a real in-memory libsql database, so the actual SQL
 * runs: access through projects and note shares, the item writes, and the
 * agent path over a real MCP client/server pair.
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

// The chat's item loader also looks for related notes; there is no index here.
vi.mock("@/lib/ai/embeddings", () => ({ findSimilarToText: vi.fn(async () => []) }));

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { schema } from "@/lib/db/schema";
import { applyNoteSharingMigration } from "@/lib/sharing/schema";
import { shareNote } from "@/lib/sharing/store";
import { applyWhiteboardMigration } from "@/lib/whiteboards/schema";
import {
  addItems,
  convertItemsToTasks,
  getBoardForTarget,
  groupItems,
  listBoards,
  projectWorkspace,
  readBoard,
  saveBoardAsNote,
  writeItems,
} from "@/lib/whiteboards/store";
import { frameOf } from "@/lib/whiteboards/layout";
import { loadChatItem } from "@/lib/chat/item-context";
import { registerAllTools } from "@/mcp/tools";
import { createToolContext } from "@/mcp/guard";
import { resetRateLimits } from "@/mcp/rate-limit";

const OWNER = "owner";
const EDITOR = "editor";
const VIEWER = "viewer";
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
  await applyWhiteboardMigration(testDb);
  // Idempotent: the build runs it every time.
  await applyWhiteboardMigration(testDb);
  await testDb.execute("PRAGMA foreign_keys = ON");
}

async function reset() {
  for (const t of [
    "whiteboard_items",
    "whiteboards",
    "note_shares",
    "notifications",
    "tasks",
    "project_collaborators",
    "notes",
    "projects",
    "users",
  ]) {
    await testDb.execute(`DELETE FROM ${t}`);
  }
  await testDb.execute(`INSERT INTO users (id, email) VALUES
    ('${OWNER}', 'owner@example.com'),
    ('${EDITOR}', 'editor@example.com'),
    ('${VIEWER}', 'viewer@example.com'),
    ('${STRANGER}', 'stranger@example.com')`);
  await testDb.execute(`INSERT INTO projects (id, user_id, name, slug) VALUES ('p1', '${OWNER}', 'Northwind launch', 'northwind-launch')`);
  await testDb.execute(`INSERT INTO project_collaborators (project_id, user_id, email, role, status, invited_by) VALUES
    ('p1', '${EDITOR}', 'editor@example.com', 'editor', 'accepted', '${OWNER}'),
    ('p1', '${VIEWER}', 'viewer@example.com', 'viewer', 'accepted', '${OWNER}')`);
  await addNote("n1", OWNER, "plan", "Plan", "p1");
  await addNote("n2", OWNER, "risks", "Risks", "p1");
  await addNote("n3", OWNER, "private", "Private diary", null);
}

async function addNote(id: string, userId: string, slug: string, title: string, projectId: string | null) {
  await testDb.execute({
    sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, project_id) VALUES (?, ?, ?, ?, '', '', ?)`,
    args: [id, userId, title, slug, projectId],
  });
}

const sticky = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: "sticky", text: id, x: 0, y: 0, ...extra });

beforeAll(setupSchema);
beforeEach(reset);

describe("whose board it is", () => {
  it("is created once, owned by the project's owner, even when a collaborator opens it first", async () => {
    const [a, b] = await Promise.all([
      getBoardForTarget({ scope: "project", id: "p1" }, EDITOR, { create: true }),
      getBoardForTarget({ scope: "project", id: "p1" }, OWNER, { create: true }),
    ]);
    expect(a.board!.id).toBe(b.board!.id);
    expect(a.board!.user_id).toBe(OWNER);
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM whiteboards")).rows[0].n).toBe(1);
  });

  it("a viewer can read but not start or change a board", async () => {
    await expect(getBoardForTarget({ scope: "project", id: "p1" }, VIEWER, { create: true })).rejects.toMatchObject({ status: 403 });
    const { board } = await getBoardForTarget({ scope: "project", id: "p1" }, OWNER, { create: true });
    await writeItems(board!.id, OWNER, { upserts: [sticky("wi_aaaaaa")] });
    const view = await readBoard(board!.id, VIEWER);
    expect(view.items).toHaveLength(1);
    expect(view.access.role).toBe("viewer");
    await expect(writeItems(board!.id, VIEWER, { upserts: [sticky("wi_bbbbbb")] })).rejects.toMatchObject({ status: 403 });
  });

  it("is invisible to someone without access, as if it did not exist", async () => {
    const { board } = await getBoardForTarget({ scope: "project", id: "p1" }, OWNER, { create: true });
    await expect(readBoard(board!.id, STRANGER)).rejects.toMatchObject({ status: 404 });
    await expect(getBoardForTarget({ scope: "note", id: "n3" }, STRANGER)).rejects.toMatchObject({ status: 404 });
  });

  it("a note's board follows the note's share", async () => {
    await expect(getBoardForTarget({ scope: "note", id: "n3" }, STRANGER)).rejects.toMatchObject({ status: 404 });
    await shareNote({ ownerId: OWNER, noteId: "n3", email: "stranger@example.com", permission: "edit", origin: { via: "app" } });
    const { board, access } = await getBoardForTarget({ scope: "note", id: "n3" }, STRANGER, { create: true });
    expect(access.role).toBe("editor");
    expect(board!.user_id).toBe(OWNER);
  });

  it("goes when its note or project goes", async () => {
    const note = await getBoardForTarget({ scope: "note", id: "n1" }, OWNER, { create: true });
    await writeItems(note.board!.id, OWNER, { upserts: [sticky("wi_aaaaaa")] });
    await testDb.execute("DELETE FROM notes WHERE id = 'n1'");
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM whiteboard_items")).rows[0].n).toBe(0);
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM whiteboards")).rows[0].n).toBe(0);
  });
});

describe("writing items", () => {
  async function projectBoard() {
    return (await getBoardForTarget({ scope: "project", id: "p1" }, OWNER, { create: true })).board!;
  }

  it("bumps the version, stamps each item, and reads back only what changed", async () => {
    const board = await projectBoard();
    const first = await writeItems(board.id, OWNER, { upserts: [sticky("wi_aaaaaa"), sticky("wi_bbbbbb")] });
    expect(first.version).toBe(1);
    const second = await writeItems(board.id, EDITOR, { upserts: [sticky("wi_bbbbbb", { text: "edited" })] });
    expect(second.version).toBe(2);

    const since = await readBoard(board.id, OWNER, 1);
    expect(since.items.map((i) => i.id)).toEqual(["wi_bbbbbb"]);
    expect(since.ids!.sort()).toEqual(["wi_aaaaaa", "wi_bbbbbb"]);
    expect((await readBoard(board.id, OWNER, 2)).items).toEqual([]);
  });

  it("is idempotent: a retried save does not duplicate", async () => {
    const board = await projectBoard();
    await writeItems(board.id, OWNER, { upserts: [sticky("wi_aaaaaa")] });
    await writeItems(board.id, OWNER, { upserts: [sticky("wi_aaaaaa")] });
    expect((await readBoard(board.id, OWNER)).items).toHaveLength(1);
  });

  it("refuses an id that belongs to another board, and keeps the rest of the batch", async () => {
    const board = await projectBoard();
    const other = (await getBoardForTarget({ scope: "note", id: "n3" }, OWNER, { create: true })).board!;
    await writeItems(other.id, OWNER, { upserts: [sticky("wi_private", { text: "secret" })] });

    const result = await writeItems(board.id, EDITOR, { upserts: [sticky("wi_private", { text: "hijack" }), sticky("wi_cccccc")] });
    expect(result.applied).toEqual(["wi_cccccc"]);
    expect(result.errors[0]).toMatchObject({ id: "wi_private" });
    expect((await readBoard(other.id, OWNER)).items[0].text).toBe("secret");
  });

  it("only joins connectors to items on this board", async () => {
    const board = await projectBoard();
    const result = await writeItems(board.id, OWNER, {
      upserts: [
        sticky("wi_aaaaaa"),
        { id: "wi_arrow1", kind: "connector", from_item_id: "wi_aaaaaa", to_item_id: "wi_nowhere" },
      ],
    });
    expect(result.applied).toEqual(["wi_aaaaaa"]);
    expect(result.errors[0].error).toMatch(/not on this whiteboard/);
  });

  it("deleting an item takes its connectors with it", async () => {
    const board = await projectBoard();
    await writeItems(board.id, OWNER, {
      upserts: [sticky("wi_aaaaaa"), sticky("wi_bbbbbb"), { id: "wi_arrow1", kind: "connector", from_item_id: "wi_aaaaaa", to_item_id: "wi_bbbbbb" }],
    });
    const result = await writeItems(board.id, OWNER, { deletes: ["wi_aaaaaa"] });
    expect(result.deleted.sort()).toEqual(["wi_aaaaaa", "wi_arrow1"]);
    expect((await readBoard(board.id, OWNER)).items.map((i) => i.id)).toEqual(["wi_bbbbbb"]);
  });

  it("cards show a live note or task, and never one the viewer could not open", async () => {
    const board = await projectBoard();
    await testDb.execute(`INSERT INTO notes (id, user_id, title, slug, content) VALUES ('n9', '${STRANGER}', 'Not yours', 'x', '')`);
    const result = await writeItems(board.id, EDITOR, {
      upserts: [
        { id: "wi_card01", kind: "card", ref_type: "note", ref_id: "n2" },
        { id: "wi_card02", kind: "card", ref_type: "note", ref_id: "n9" },
      ],
    });
    expect(result.applied).toEqual(["wi_card01"]);
    await testDb.execute("UPDATE notes SET title = 'Risks v2' WHERE id = 'n2'");
    const view = await readBoard(board.id, VIEWER);
    expect(view.refs["note:n2"]).toMatchObject({ title: "Risks v2", slug: "risks" });
  });
});

describe("agent-shaped operations", () => {
  it("adds frames and stickies by name, inside the frame, without overlap", async () => {
    const result = await addItems({ scope: "project", id: "p1" }, OWNER, [
      { kind: "sticky", text: "Late parts", frame: "risks" },
      { kind: "frame", text: "Risks", ref: "risks" },
      { kind: "sticky", text: "Price rise", frame: "risks", ref: "price" },
      { kind: "sticky", text: "Loose" },
      { kind: "connector", from: "price", to: "wi_doesnotexist" },
    ]);
    expect(result.created).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
    const view = await readBoard(result.board.id, OWNER);
    const frame = view.items.find((i) => i.kind === "frame")!;
    // Sized for its two stickies, not the 760×520 default.
    expect(frame.w).toBeLessThan(760);
    expect(frame.h).toBeLessThan(520);
    for (const text of ["Late parts", "Price rise"]) {
      expect(frameOf(view.items.find((i) => i.text === text)!, view.items)?.id).toBe(frame.id);
    }
    expect(frameOf(view.items.find((i) => i.text === "Loose")!, view.items)).toBeNull();
  });

  it("groups items into themed frames", async () => {
    const { board } = await addItems({ scope: "project", id: "p1" }, OWNER, [
      { kind: "sticky", text: "a", ref: "a" },
      { kind: "sticky", text: "b", ref: "b" },
      { kind: "sticky", text: "c", ref: "c" },
    ]);
    const ids = (await readBoard(board.id, OWNER)).items.map((i) => i.id);
    const result = await groupItems(board.id, OWNER, [
      { title: "First", item_ids: ids.slice(0, 2) },
      { title: "Second", item_ids: [ids[2], "wi_unknown"] },
    ]);
    expect(result.frames.map((f) => [f.title, f.count])).toEqual([["First", 2], ["Second", 1]]);
    const view = await readBoard(board.id, OWNER);
    const second = view.items.find((i) => i.kind === "frame" && i.text === "Second")!;
    expect(frameOf(view.items.find((i) => i.id === ids[2])!, view.items)?.id).toBe(second.id);
  });

  it("turns stickies into tasks in the project, linked back to the board", async () => {
    const { board, created } = await addItems({ scope: "note", id: "n1" }, EDITOR, [
      { kind: "sticky", text: "Book the venue\nAsk about parking" },
      { kind: "frame", text: "Not a task" },
    ]);
    const result = await convertItemsToTasks(board.id, EDITOR, created.map((c) => c.id));
    expect(result.tasks).toHaveLength(1);
    const task = (await testDb.execute(`SELECT * FROM tasks WHERE id = '${result.tasks[0].id}'`)).rows[0];
    expect(task).toMatchObject({ title: "Book the venue", description: "Ask about parking", project_id: "p1", note_id: "n1" });
    const view = await readBoard(board.id, OWNER);
    const card = view.items.find((i) => i.kind === "card")!;
    expect(card).toMatchObject({ ref_type: "task", ref_id: task.id });
    expect(view.refs[`task:${task.id}`]).toMatchObject({ title: "Book the venue", status: "pending" });
  });

  it("saves the board as a note in the same project", async () => {
    const { board } = await addItems({ scope: "project", id: "p1" }, OWNER, [
      { kind: "frame", text: "Goals", ref: "g" },
      { kind: "sticky", text: "Ship it", frame: "g" },
    ]);
    const note = await saveBoardAsNote(board.id, OWNER);
    const row = (await testDb.execute(`SELECT content, project_id FROM notes WHERE id = '${note.id}'`)).rows[0];
    expect(row.project_id).toBe("p1");
    expect(row.content).toContain("## Goals");
    expect(row.content).toContain("- Ship it");
  });
});

describe("the project's whiteboard space", () => {
  it("lists the project board first and one tab per note", async () => {
    await addItems({ scope: "note", id: "n2" }, OWNER, [{ kind: "sticky", text: "x" }]);
    const ws = await projectWorkspace("p1", VIEWER);
    expect(ws.tabs[0]).toMatchObject({ scope: "project", title: "Northwind launch", board_id: null });
    expect(ws.tabs.slice(1).map((t) => t.title)).toEqual(["Risks", "Plan"]);
    expect(ws.tabs[1]).toMatchObject({ item_count: 1 });
    await expect(projectWorkspace("p1", STRANGER)).rejects.toMatchObject({ status: 404 });
  });

  it("lists boards a collaborator can open", async () => {
    await addItems({ scope: "project", id: "p1" }, OWNER, [{ kind: "sticky", text: "x" }]);
    await addItems({ scope: "note", id: "n3" }, OWNER, [{ kind: "sticky", text: "private" }]);
    expect((await listBoards(EDITOR)).map((b) => b.title)).toEqual(["Northwind launch"]);
    expect((await listBoards(OWNER)).length).toBe(2);
  });

  it("can be the subject of a chat, read as an outline", async () => {
    const { board } = await addItems({ scope: "project", id: "p1" }, OWNER, [{ kind: "sticky", text: "Hire a designer" }]);
    const item = await loadChatItem(EDITOR, { type: "whiteboard", id: board.id });
    expect(item).toMatchObject({ label: "Project whiteboard", title: "Northwind launch", projectName: "Northwind launch" });
    expect(item!.body).toContain("Hire a designer");
    expect(await loadChatItem(STRANGER, { type: "whiteboard", id: board.id })).toBeNull();
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
    return { isError: !!result.isError, text, body };
  }

  it("an agent fills a project board, and the items say who wrote them", async () => {
    const agent = await connect(OWNER, ["whiteboards:read", "whiteboards:write"]);
    const added = await call(agent, "add_whiteboard_items", {
      project_id: "p1",
      items: [
        { kind: "frame", text: "Options", ref: "opts" },
        { kind: "sticky", text: "Build", frame: "opts", ref: "build" },
        { kind: "sticky", text: "Buy", frame: "opts", ref: "buy", color: "blue" },
        { kind: "connector", from: "build", to: "buy", text: "vs" },
        { kind: "card", ref_type: "note", ref_id: "n1" },
      ],
    });
    expect(added.isError).toBe(false);
    expect((added.body.added as unknown[]).length).toBe(5);
    expect(added.body.open_url).toMatch(/\/projects\/northwind-launch\/whiteboard$/);

    const read = await call(agent, "get_whiteboard", { project_id: "p1", include_items: true });
    expect(read.body.outline).toContain('Frame "Options"');
    expect(read.body.outline).toContain('"Build" → "Buy" (vs)');
    expect(read.body.outline).toContain("[note] Plan (note n1)");
    const items = read.body.items as Array<{ written_by?: string }>;
    expect(items.every((i) => i.written_by === "Claude Desktop")).toBe(true);

    const row = (await testDb.execute("SELECT source_actor FROM whiteboard_items LIMIT 1")).rows[0];
    expect(row.source_actor).toBe("mcp_key");
  });

  it("reports a board that does not exist yet instead of creating it on read", async () => {
    const agent = await connect(OWNER, ["whiteboards:read"]);
    const read = await call(agent, "get_whiteboard", { note_id: "plan" });
    expect(read.body).toMatchObject({ exists: false, title: "Plan" });
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM whiteboards")).rows[0].n).toBe(0);
  });

  it("a read-only key cannot write, and converting needs the target scope too", async () => {
    const reader = await connect(OWNER, ["whiteboards:read"]);
    const denied = await call(reader, "add_whiteboard_items", { project_id: "p1", items: [{ kind: "sticky", text: "x" }] });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/whiteboards:write/);

    const writer = await connect(OWNER, ["whiteboards:read", "whiteboards:write"]);
    const added = await call(writer, "add_whiteboard_items", { project_id: "p1", items: [{ kind: "sticky", text: "Call Dana" }] });
    const board = added.body.board_id as string;
    const id = (added.body.added as Array<{ id: string }>)[0].id;
    const convert = await call(writer, "convert_whiteboard_items", { board_id: board, to: "tasks", item_ids: [id] });
    expect(convert.isError).toBe(true);
    expect(convert.text).toMatch(/tasks:write/);
    expect((await testDb.execute("SELECT COUNT(*) AS n FROM tasks")).rows[0].n).toBe(0);
  });

  it("organises, updates and deletes", async () => {
    const agent = await connect(OWNER, ["*"]);
    const added = await call(agent, "add_whiteboard_items", {
      project_id: "p1",
      items: [{ kind: "sticky", text: "a" }, { kind: "sticky", text: "b" }, { kind: "sticky", text: "c" }],
    });
    const board = added.body.board_id as string;
    const ids = (added.body.added as Array<{ id: string }>).map((a) => a.id);

    const grouped = await call(agent, "organize_whiteboard", { board_id: board, groups: [{ title: "All", item_ids: ids }] });
    expect(grouped.body.frames).toHaveLength(1);

    const updated = await call(agent, "update_whiteboard_items", { board_id: board, items: [{ id: ids[0], color: "green", text: "A!" }] });
    expect(updated.body.updated).toEqual([ids[0]]);
    const view = await readBoard(board, OWNER);
    expect(view.items.find((i) => i.id === ids[0])).toMatchObject({ color: "green", text: "A!", kind: "sticky" });

    const deleted = await call(agent, "delete_whiteboard_items", { board_id: board, item_ids: [ids[1]] });
    expect(deleted.body.deleted).toEqual([ids[1]]);

    const list = await call(agent, "list_whiteboards", { project_id: "p1" });
    expect(list.body.count).toBe(1);
  });
});
