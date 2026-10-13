/**
 * Account-to-account note sharing, against a real in-memory libsql database so
 * the actual SQL runs — including over a real MCP client/server pair, which is
 * how "share this with my work account" arrives in practice.
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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { schema } from "@/lib/db/schema";
import { applyNoteSharingMigration } from "@/lib/sharing/schema";
import { getNoteAccess, redactForViewer } from "@/lib/sharing/access";
import {
  getSavedRecipients,
  leaveShare,
  listNoteShares,
  listSharedWithMe,
  revokeShare,
  setSavedRecipients,
  shareNote,
  updateSharePermission,
} from "@/lib/sharing/store";
import { registerAllTools } from "@/mcp/tools";
import { createToolContext } from "@/mcp/guard";
import { resetRateLimits } from "@/mcp/rate-limit";

const OWNER = "owner";
const WORK = "work";
const STRANGER = "stranger";
const app = { via: "app" as const };

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
  // Idempotent: the build runs it every time.
  await applyNoteSharingMigration(testDb);
  await testDb.execute("PRAGMA foreign_keys = ON");
}

async function reset() {
  for (const t of ["note_shares", "notifications", "project_collaborators", "notes", "projects", "users"]) {
    await testDb.execute(`DELETE FROM ${t}`);
  }
  await testDb.execute(`INSERT INTO users (id, email, display_name, preferences) VALUES
    ('${OWNER}', 'me@example.com', 'Owner', '{"models":{"fast":"x"}}'),
    ('${WORK}', 'me@work.example.com', NULL, '{}'),
    ('${STRANGER}', 'someone@example.com', NULL, '{}')`);
  await addNote("n1", OWNER, "plan", "Plan", { shareToken: "tok-1" });
}

async function addNote(
  id: string,
  userId: string,
  slug: string,
  title: string,
  opts: { projectId?: string; shareToken?: string } = {}
) {
  await testDb.execute({
    sql: `INSERT INTO notes (id, user_id, title, slug, content, content_plain, project_id, share_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, userId, title, slug, "<p>Body</p>", "Body", opts.projectId ?? null, opts.shareToken ?? null],
  });
}

beforeAll(setupSchema);
beforeEach(reset);

describe("sharing a note with another account", () => {
  it("gives the recipient read access, and nobody else", async () => {
    const { share, created } = await shareNote({ ownerId: OWNER, noteId: "n1", email: "Me@Work.example.com", origin: app });
    expect(created).toBe(true);
    expect(share).toMatchObject({ recipient_email: "me@work.example.com", recipient_has_account: true, permission: "view" });

    const access = await getNoteAccess("n1", WORK);
    expect(access).toMatchObject({ role: "viewer", via: "share", share: { ownerEmail: "me@example.com" } });
    expect(await getNoteAccess("n1", STRANGER)).toBeNull();

    const list = await listSharedWithMe(WORK);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ note_id: "n1", title: "Plan", owner_email: "me@example.com" });
  });

  it("never hands the owner's public link to a recipient", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    const access = (await getNoteAccess("n1", WORK))!;
    expect(access.note.share_token).toBe("tok-1");
    expect(redactForViewer(access.note, access.role).share_token).toBeNull();
  });

  it("is idempotent: sharing again updates the one row", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    const again = await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", permission: "edit", origin: app });
    expect(again.created).toBe(false);
    expect(await listNoteShares(OWNER, "n1")).toHaveLength(1);
    expect((await getNoteAccess("n1", WORK))?.role).toBe("editor");
  });

  it("notifies the recipient once, not on every re-share", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    const rows = (await testDb.execute(`SELECT action_url FROM notifications WHERE user_id = '${WORK}'`)).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].action_url).toBe("/notes/n1");
  });

  it("refuses to share with yourself, or someone else's note", async () => {
    await expect(shareNote({ ownerId: OWNER, noteId: "n1", email: "ME@example.com", origin: app })).rejects.toThrow(/your own account/);
    await expect(shareNote({ ownerId: STRANGER, noteId: "n1", email: "me@work.example.com", origin: app })).rejects.toMatchObject({ status: 404 });
  });

  it("works for an address that gets an account later", async () => {
    const { share } = await shareNote({ ownerId: OWNER, noteId: "n1", email: "new@example.com", origin: app });
    expect(share.recipient_has_account).toBe(false);

    await testDb.execute(`INSERT INTO users (id, email) VALUES ('late', 'New@example.com')`);
    expect((await getNoteAccess("n1", "late"))?.role).toBe("viewer");
    const bound = (await testDb.execute(`SELECT recipient_user_id FROM note_shares WHERE recipient_email = 'new@example.com'`)).rows[0];
    expect(bound.recipient_user_id).toBe("late");
  });

  it("revoking ends access at once, and revoking twice is harmless", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    expect(await revokeShare(OWNER, "n1", { email: "me@work.example.com" })).toBe(1);
    expect(await getNoteAccess("n1", WORK)).toBeNull();
    expect(await listSharedWithMe(WORK)).toEqual([]);
    expect(await revokeShare(OWNER, "n1", { email: "me@work.example.com" })).toBe(0);
  });

  it("lets only the owner change a share", async () => {
    const { share } = await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    await expect(updateSharePermission(WORK, "n1", share.id, "edit")).rejects.toMatchObject({ status: 404 });
    await expect(updateSharePermission(OWNER, "n1", share.id, "admin")).rejects.toThrow(/permission/);
    expect((await updateSharePermission(OWNER, "n1", share.id, "edit")).permission).toBe("edit");
  });

  it("lets the recipient leave", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    expect(await leaveShare(WORK, "n1")).toBe(1);
    expect(await getNoteAccess("n1", WORK)).toBeNull();
  });

  it("disappears with the note", async () => {
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    await testDb.execute("DELETE FROM notes WHERE id = 'n1'");
    expect((await testDb.execute("SELECT COUNT(*) as n FROM note_shares")).rows[0].n).toBe(0);
  });
});

describe("getNoteAccess", () => {
  it("prefers the viewer's own note when a shared note has the same slug", async () => {
    await testDb.execute(`INSERT INTO projects (id, user_id, name, slug) VALUES ('p1', '${OWNER}', 'P', 'p')`);
    await addNote("n2", OWNER, "same", "Owner's", { projectId: "p1" });
    await addNote("n3", WORK, "same", "Mine");
    await testDb.execute(`INSERT INTO project_collaborators (project_id, user_id, email, role, status, invited_by)
      VALUES ('p1', '${WORK}', 'me@work.example.com', 'editor', 'accepted', '${OWNER}')`);

    expect((await getNoteAccess("same", WORK))?.note.id).toBe("n3");
    expect(await getNoteAccess("n2", WORK)).toMatchObject({ role: "editor", via: "project" });
  });

  it("keeps the stronger grant when a project editor is also shared view-only", async () => {
    await testDb.execute(`INSERT INTO projects (id, user_id, name, slug) VALUES ('p1', '${OWNER}', 'P', 'p')`);
    await addNote("n2", OWNER, "doc", "Doc", { projectId: "p1" });
    await testDb.execute(`INSERT INTO project_collaborators (project_id, user_id, email, role, status, invited_by)
      VALUES ('p1', '${WORK}', 'me@work.example.com', 'editor', 'accepted', '${OWNER}')`);
    await shareNote({ ownerId: OWNER, noteId: "n2", email: "me@work.example.com", origin: app });
    expect((await getNoteAccess("n2", WORK))?.role).toBe("editor");
  });

  it("still serves owners and collaborators on a database without note_shares", async () => {
    await testDb.execute("DROP TABLE note_shares");
    try {
      expect((await getNoteAccess("n1", OWNER))?.role).toBe("owner");
      expect(await getNoteAccess("n1", WORK)).toBeNull();
    } finally {
      await applyNoteSharingMigration(testDb);
    }
  });
});

describe("saved recipients", () => {
  it("are stored without disturbing other preferences", async () => {
    await setSavedRecipients(OWNER, [{ label: "Work", email: "me@work.example.com" }]);
    expect(await getSavedRecipients(OWNER)).toEqual([{ label: "Work", email: "me@work.example.com" }]);
    const prefs = JSON.parse(
      (await testDb.execute(`SELECT preferences FROM users WHERE id = '${OWNER}'`)).rows[0].preferences as string
    );
    expect(prefs.models).toEqual({ fast: "x" });
  });
});

describe("over MCP", () => {
  async function connect(userId: string, scopes: string[]) {
    resetRateLimits();
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerAllTools(
      server,
      createToolContext(() => ({ userId, keyId: `k-${userId}`, keyName: "Claude", scopes, rateLimitPerMinute: 1000 }))
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "c", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }

  async function call(client: Client, name: string, args: Record<string, unknown>) {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    const text = result.content[0]?.text ?? "";
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // plain-text error
    }
    return { isError: !!result.isError, text, body: body as Record<string, unknown> };
  }

  it('"share this with my work account" shares with the saved recipient, and the work key can read it', async () => {
    await setSavedRecipients(OWNER, [{ label: "work", email: "me@work.example.com" }]);
    const personal = await connect(OWNER, ["*"]);
    const shared = await call(personal, "share_note", { note_id: "n1", recipient: "my work account" });
    expect(shared.isError).toBe(false);
    expect(shared.body).toMatchObject({ success: true, permission: "view", recipient_has_account: true });
    await personal.close();

    const work = await connect(WORK, ["notes:read"]);
    const listed = await call(work, "list_shared_notes", {});
    expect(listed.body).toMatchObject({ count: 1 });
    const read = await call(work, "get_note", { note_id: "n1", include_connections: true });
    expect(read.isError).toBe(false);
    const note = (read.body as { note: Record<string, unknown> }).note;
    expect(note).toMatchObject({ title: "Plan", share_token: null, access: { role: "viewer", via: "share" } });
    await work.close();
  });

  it("refuses an address the user never saved", async () => {
    await setSavedRecipients(OWNER, [{ label: "work", email: "me@work.example.com" }]);
    const personal = await connect(OWNER, ["*"]);
    const result = await call(personal, "share_note", { note_id: "n1", recipient: "someone@example.com" });
    expect(result.isError).toBe(true);
    expect(await getNoteAccess("n1", STRANGER)).toBeNull();
    await personal.close();
  });

  it("needs the notes:share scope; notes:write is not enough", async () => {
    await setSavedRecipients(OWNER, [{ label: "work", email: "me@work.example.com" }]);
    const personal = await connect(OWNER, ["notes:read", "notes:write"]);
    const result = await call(personal, "share_note", { note_id: "n1", recipient: "work" });
    expect(result.isError).toBe(true);
    expect(result.text).toContain("notes:share");
    await personal.close();
  });

  it("unshares by name, and reports a no-op honestly", async () => {
    await setSavedRecipients(OWNER, [{ label: "work", email: "me@work.example.com" }]);
    await shareNote({ ownerId: OWNER, noteId: "n1", email: "me@work.example.com", origin: app });
    const personal = await connect(OWNER, ["*"]);
    expect((await call(personal, "unshare_note", { note_id: "n1", recipient: "work" })).body).toMatchObject({ removed: 1 });
    expect((await call(personal, "unshare_note", { note_id: "n1", recipient: "work" })).body).toMatchObject({ removed: 0 });
    await personal.close();
  });
});
