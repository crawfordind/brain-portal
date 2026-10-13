/**
 * `/api/notes/[id]` for people other than the owner: share recipients and
 * project editors. Real SQL against an in-memory database; only the side
 * effects (queue, cache, embeddings) are mocked so their arguments can be read.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

const { testDb, currentUser, enqueue, invalidateCache } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient } = require("@libsql/client");
  return {
    testDb: createClient({ url: ":memory:" }),
    currentUser: { value: null as null | { id: string; email: string } },
    enqueue: vi.fn(async () => "job"),
    invalidateCache: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/db/client", () => {
  const query = async (sql: string, args: unknown[] = []) =>
    (await testDb.execute({ sql, args })).rows.map((r: object) => ({ ...r }));
  const queryOne = async (sql: string, args: unknown[] = []) => (await query(sql, args))[0] ?? null;
  return { db: testDb, query, queryAll: query, queryOne, mutate: queryOne };
});
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => currentUser.value }));
vi.mock("@/lib/processing/queue", () => ({ enqueue, cancelJobs: vi.fn(async () => {}) }));
vi.mock("@/lib/processing/cache", async (orig) => ({
  ...(await orig<typeof import("@/lib/processing/cache")>()),
  invalidateCache,
}));
vi.mock("@/lib/ai/embeddings", () => ({ deleteEmbedding: vi.fn(async () => {}) }));
vi.mock("@/lib/recommendations/auto-scan", () => ({
  shouldTriggerAutoScan: vi.fn(async () => ({ shouldScan: false })),
  updateScanMetadata: vi.fn(async () => {}),
}));

import { schema } from "@/lib/db/schema";
import { applyNoteSharingMigration } from "@/lib/sharing/schema";
import { shareNote } from "@/lib/sharing/store";
import { GET, PUT, DELETE } from "@/app/api/notes/[id]/route";

const OWNER = { id: "owner", email: "me@example.com" };
const WORK = { id: "work", email: "me@work.example.com" };
const STRANGER = { id: "stranger", email: "someone@example.com" };

beforeAll(async () => {
  const statements = schema
    .replace(/CREATE TRIGGER[\s\S]*?END;/g, "")
    .replace(/^\s*--.*$/gm, "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const s of statements) await testDb.execute(s);
  await testDb.execute("ALTER TABLE notes ADD COLUMN share_token TEXT");
  await testDb.execute("ALTER TABLE notes ADD COLUMN shared_at TEXT");
  // Added by later ALTERs in scripts/migrate.ts, not in the base schema.
  await testDb.execute("ALTER TABLE notes ADD COLUMN processing_status TEXT DEFAULT 'pending'");
  await applyNoteSharingMigration(testDb);
});

beforeEach(async () => {
  vi.clearAllMocks();
  for (const t of ["note_shares", "notifications", "notes", "users"]) await testDb.execute(`DELETE FROM ${t}`);
  for (const u of [OWNER, WORK, STRANGER]) {
    await testDb.execute({ sql: "INSERT INTO users (id, email) VALUES (?, ?)", args: [u.id, u.email] });
  }
  await testDb.execute(`INSERT INTO notes (id, user_id, title, slug, content, content_plain, share_token)
    VALUES ('n1', 'owner', 'Plan', 'plan', '<p>old</p>', 'old', 'tok-1')`);
});

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/notes/n1", {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}),
  });

describe("GET /api/notes/[id] for a share recipient", () => {
  it("opens the note read-only, without the owner's public link", async () => {
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, origin: { via: "app" } });
    currentUser.value = WORK;
    const res = await GET(req("GET"), params("n1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      canEdit: false,
      isOwner: false,
      access: { via: "share", sharedBy: { email: OWNER.email } },
      note: { id: "n1", share_token: null, viewer_only: 1 },
    });
  });

  it("is a 404 for anyone it was not shared with", async () => {
    currentUser.value = STRANGER;
    expect((await GET(req("GET"), params("n1"))).status).toBe(404);
  });
});

describe("PUT /api/notes/[id] by someone other than the owner", () => {
  it("rejects a view-only recipient", async () => {
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, origin: { via: "app" } });
    currentUser.value = WORK;
    expect((await PUT(req("PUT", { content: "<p>new</p>" }), params("n1"))).status).toBe(403);
  });

  it("lets an editor change the text, and queues the work under the owner", async () => {
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, permission: "edit", origin: { via: "app" } });
    currentUser.value = WORK;
    const res = await PUT(req("PUT", { content: "<p>new words here</p>" }), params("n1"));
    expect(res.status).toBe(200);
    expect((await res.json()).note.share_token).toBeNull();

    expect(enqueue).toHaveBeenCalled();
    for (const [job] of enqueue.mock.calls as unknown as Array<[{ userId: string }]>) {
      expect(job.userId).toBe(OWNER.id);
    }
    expect(invalidateCache).toHaveBeenCalledWith(OWNER.id, { entityId: "n1" });
  });

  it("does not let an editor move, pin or archive the owner's note", async () => {
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, permission: "edit", origin: { via: "app" } });
    currentUser.value = WORK;
    for (const body of [{ isArchived: true }, { isPinned: true }, { projectId: null }]) {
      expect((await PUT(req("PUT", body), params("n1"))).status, JSON.stringify(body)).toBe(403);
    }
  });
});

describe("DELETE /api/notes/[id]", () => {
  it("is 404 for a stranger (no existence oracle) and 403 for a recipient", async () => {
    currentUser.value = STRANGER;
    expect((await DELETE(req("DELETE"), params("n1"))).status).toBe(404);
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, permission: "edit", origin: { via: "app" } });
    currentUser.value = WORK;
    expect((await DELETE(req("DELETE"), params("n1"))).status).toBe(403);
  });

  it("removes the note and its shares for the owner", async () => {
    await shareNote({ ownerId: OWNER.id, noteId: "n1", email: WORK.email, origin: { via: "app" } });
    currentUser.value = OWNER;
    expect((await DELETE(req("DELETE"), params("n1"))).status).toBe(200);
    expect((await testDb.execute("SELECT COUNT(*) as n FROM note_shares")).rows[0].n).toBe(0);
  });
});
