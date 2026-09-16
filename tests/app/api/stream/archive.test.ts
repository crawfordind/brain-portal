/**
 * `PATCH /api/stream/[id]` — archiving a stream item.
 *
 * These pin the two things that were wrong. The route ran five sequential
 * `mutate()` calls and set a success flag from the return value, but `mutate`
 * returns `rows[0] ?? null` and an UPDATE without RETURNING has no rows — so
 * the flag was permanently false, and the 404 branch additionally required all
 * five statements to *throw*. The endpoint therefore reported success for
 * every id, including ids belonging to nobody.
 *
 * The stream feed never called it at all, so the bug was invisible: archive
 * dropped the row from local state and the item came back on refresh.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const batch = vi.fn();

vi.mock("@/lib/auth", () => ({
  getCurrentUser: vi.fn(() =>
    Promise.resolve({ id: "user123", email: "test@example.com" })
  ),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    batch: (...args: unknown[]) => batch(...args),
  },
  queryOne: vi.fn(),
}));

import { PATCH } from "@/app/api/stream/[id]/route";

/** libsql returns one result object per statement in the batch. */
const affected = (...counts: number[]) =>
  counts.map((rowsAffected) => ({ rowsAffected, rows: [] }));

function request(body: unknown) {
  return new NextRequest("http://localhost:3000/api/stream/item123", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: "item123" });

describe("PATCH /api/stream/[id]", () => {
  beforeEach(() => {
    batch.mockReset();
  });

  it("archives an item that exists in one of the source tables", async () => {
    // A stream id is unique within its own table; exactly one statement hits.
    batch.mockResolvedValue(affected(0, 1, 0, 0, 0));

    const res = await PATCH(request({ status: "archived" }), { params });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ success: true });
  });

  it("404s when the id matches nothing — it must not claim success", async () => {
    batch.mockResolvedValue(affected(0, 0, 0, 0, 0));

    const res = await PATCH(request({ status: "archived" }), { params });

    expect(res.status).toBe(404);
  });

  it("scopes every statement to the calling user", async () => {
    batch.mockResolvedValue(affected(1, 0, 0, 0, 0));

    await PATCH(request({ status: "archived" }), { params });

    const statements = batch.mock.calls[0][0] as Array<{
      sql: string;
      args: unknown[];
    }>;

    expect(statements).toHaveLength(5);
    for (const statement of statements) {
      expect(statement.sql).toContain("user_id = ?");
      expect(statement.args).toEqual(["item123", "user123"]);
    }
  });

  it("issues one batch rather than a round trip per table", async () => {
    batch.mockResolvedValue(affected(0, 0, 1, 0, 0));

    await PATCH(request({ status: "archived" }), { params });

    expect(batch).toHaveBeenCalledTimes(1);
  });

  it("does not touch agent_tasks — rejecting output is a review decision", async () => {
    batch.mockResolvedValue(affected(0, 0, 0, 0, 0));

    await PATCH(request({ status: "archived" }), { params });

    const statements = batch.mock.calls[0][0] as Array<{ sql: string }>;
    const tables = statements.map((s) => s.sql);

    expect(tables.some((sql) => sql.includes("agent_tasks"))).toBe(false);
    expect(tables.some((sql) => sql.includes("UPDATE captures"))).toBe(true);
    expect(tables.some((sql) => sql.includes("UPDATE tasks"))).toBe(true);
    expect(tables.some((sql) => sql.includes("UPDATE notes"))).toBe(true);
    expect(tables.some((sql) => sql.includes("UPDATE reminders"))).toBe(true);
    expect(tables.some((sql) => sql.includes("UPDATE insights"))).toBe(true);
  });

  it("stamps dismissed_at when the row turns out to be a reminder", async () => {
    batch.mockResolvedValue(affected(0, 0, 0, 1, 0));

    await PATCH(request({ status: "archived" }), { params });

    const statements = batch.mock.calls[0][0] as Array<{ sql: string }>;
    const reminders = statements.find((s) => s.sql.includes("UPDATE reminders"));

    expect(reminders?.sql).toContain("dismissed_at");
  });

  it("rejects a status it does not implement, without writing anything", async () => {
    const res = await PATCH(request({ status: "completed" }), { params });

    expect(res.status).toBe(400);
    expect(batch).not.toHaveBeenCalled();
  });
});
