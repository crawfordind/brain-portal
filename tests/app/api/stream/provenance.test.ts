/**
 * `GET /api/stream` — the provenance the feed needs to collapse runs.
 *
 * Before these columns existed the route synthesised `source_type` in SQL: the
 * literal `'manual'` for every capture, note and reminder, whoever wrote them.
 * A note written by an MCP key was therefore indistinguishable from one the
 * user typed, and the feed had nothing to group a run by.
 *
 * These pin the contract the feed depends on: the four fields come back on
 * every row, a row with no stamp reads as the user, and an actor the database
 * does not recognise is not passed through to the client.
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
  db: { batch: (...args: unknown[]) => batch(...args) },
  query: vi.fn(),
  queryOne: vi.fn(),
  mutate: vi.fn(),
}));

vi.mock("@/lib/stream/classifier", () => ({ classifyIntent: vi.fn() }));

import { GET } from "@/app/api/stream/route";

/** A row shaped like one branch of the six-way UNION. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "n1",
    item_type: "note",
    item_status: "active",
    item_title: "A note",
    item_content: "body",
    priority: "low",
    project_id: null,
    project_name: null,
    project_color: null,
    tags: "[]",
    due_date: null,
    delegated_to: null,
    agent_task_id: null,
    agent_status: null,
    source_type: "manual",
    source_actor: "human",
    source_key_id: null,
    source_label: null,
    source_run_id: null,
    created_at: "2026-09-15 12:00:00",
    updated_at: "2026-09-15 12:00:00",
    completed_at: null,
    ...overrides,
  };
}

function respond(rows: Array<Record<string, unknown>>) {
  batch.mockResolvedValue([{ rows }, { rows: [] }]);
}

async function fetchStream() {
  const res = await GET(new NextRequest("http://localhost:3000/api/stream"));
  return res.json();
}

beforeEach(() => {
  batch.mockReset();
});

describe("GET /api/stream provenance", () => {
  it("returns the key and run that wrote each row", async () => {
    respond([
      row({
        id: "agent-note",
        source_actor: "mcp_key",
        source_key_id: "key-1",
        source_label: "Claude Desktop",
        source_run_id: "run-1",
      }),
    ]);

    const body = await fetchStream();

    expect(body.items[0]).toMatchObject({
      id: "agent-note",
      sourceActor: "mcp_key",
      sourceKeyId: "key-1",
      sourceLabel: "Claude Desktop",
      sourceRunId: "run-1",
    });
  });

  it("reads a row written before these columns existed as the user's own", async () => {
    // This is what makes the migration backfill-free: every pre-existing row
    // has NULL in all four, and nearly all of them were typed by the user.
    respond([row({ source_actor: null })]);

    const body = await fetchStream();

    expect(body.items[0].sourceActor).toBe("human");
    expect(body.items[0].sourceRunId).toBeNull();
  });

  it("does not pass an unrecognised actor through to the client", async () => {
    // The feed switches on this value; an unknown string would fall through
    // every branch rather than failing loudly anywhere.
    respond([row({ source_actor: "wizard" })]);

    const body = await fetchStream();

    expect(body.items[0].sourceActor).toBe("human");
  });

  it("carries the same run id across rows of different types", async () => {
    // One job writes notes *and* tasks; the feed groups by run, not by type,
    // so the run must survive the UNION intact on every branch.
    respond([
      row({
        id: "n",
        item_type: "note",
        source_actor: "mcp_key",
        source_run_id: "run-1",
        source_label: "Claude Desktop",
      }),
      row({
        id: "t",
        item_type: "task",
        source_actor: "mcp_key",
        source_run_id: "run-1",
        source_label: "Claude Desktop",
      }),
    ]);

    const body = await fetchStream();

    expect(body.items.map((i: { sourceRunId: string }) => i.sourceRunId)).toEqual([
      "run-1",
      "run-1",
    ]);
  });
});
