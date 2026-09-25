import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db/client", async () =>
  (await import("../../helpers/db-mock")).createDbClientMock()
);

const mockEnqueue = vi.fn();
vi.mock("@/lib/processing/queue", () => ({
  enqueue: (...a: unknown[]) => mockEnqueue(...a),
}));

import { db, queryAll } from "@/lib/db/client";
import { hashContent } from "@/lib/processing/cache";
import {
  noteHashInput,
  pipelineTag,
  planCapturePipeline,
  planNotePipeline,
  sweepUnprocessedContent,
  MAX_PENDING_BACKLOG,
  type CaptureRow,
  type NoteRow,
} from "@/lib/processing/sweep";

const LONG = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");

function note(overrides: Partial<NoteRow> = {}): NoteRow {
  return {
    id: "n1",
    user_id: "u1",
    title: "Coffee with Dana",
    content: `<p>${LONG} see [[Northwind]]</p>`,
    content_plain: `${LONG} see [[Northwind]]`,
    note_type: "note",
    source_actor: null,
    updated_at: "2026-09-24 10:00:00",
    indexed_hash: null,
    indexed_pipeline: null,
    ...overrides,
  };
}

function capture(overrides: Partial<CaptureRow> = {}): CaptureRow {
  return {
    id: "c1",
    user_id: "u1",
    content: "Met Dana Okonkwo at the expo, she wants samples",
    capture_type: "thought",
    source_actor: null,
    created_at: "2026-09-24 10:00:00",
    ...overrides,
  };
}

const ops = (jobs: { operation: string }[]) => jobs.map((j) => j.operation);

describe("planNotePipeline", () => {
  it("indexes, connects, tags, summarizes and reads a substantial note for contacts", () => {
    expect(ops(planNotePipeline(note(), { crmAvailable: true }))).toEqual([
      "generate_embedding",
      "find_connections",
      "generate_tags",
      "generate_summary",
      "extract-interactions",
    ]);
  });

  it("queues the embedding ahead of connections, which compare embeddings", () => {
    const jobs = planNotePipeline(note(), { crmAvailable: true });
    const embed = jobs.find((j) => j.operation === "generate_embedding")!;
    const connect = jobs.find((j) => j.operation === "find_connections")!;
    expect(embed.priority!).toBeGreaterThan(connect.priority!);
  });

  it("stays below the interactive routes' priority so a backfill never delays a fresh save", () => {
    for (const job of planNotePipeline(note(), { crmAvailable: true })) {
      expect(job.priority ?? 0).toBeLessThan(1);
    }
  });

  it("carries wikilinks to the connections job", () => {
    const connect = planNotePipeline(note(), { crmAvailable: false }).find(
      (j) => j.operation === "find_connections"
    )!;
    expect(connect.metadata).toEqual({ wikilinks: ["Northwind"] });
  });

  it("skips tags and summary for a short note, but still reads it for contacts", () => {
    const short = note({ content: "Called Dana back", content_plain: "Called Dana back" });
    expect(ops(planNotePipeline(short, { crmAvailable: true }))).toEqual([
      "generate_embedding",
      "find_connections",
      "extract-interactions",
    ]);
  });

  it("does not queue contact extraction when the CRM is not migrated", () => {
    expect(ops(planNotePipeline(note(), { crmAvailable: false }))).not.toContain(
      "extract-interactions"
    );
  });

  it("does not read agent output or generated reviews for contacts", () => {
    expect(
      ops(planNotePipeline(note({ source_actor: "agent" }), { crmAvailable: true }))
    ).not.toContain("extract-interactions");
    expect(
      ops(planNotePipeline(note({ note_type: "weekly" }), { crmAvailable: true }))
    ).not.toContain("extract-interactions");
  });

  it("queues nothing for an empty note", () => {
    expect(
      planNotePipeline(note({ title: "", content: "", content_plain: "" }), { crmAvailable: true })
    ).toEqual([]);
  });
});

describe("planCapturePipeline", () => {
  it("reads a thought for contacts", () => {
    expect(ops(planCapturePipeline(capture(), { crmAvailable: true }))).toEqual([
      "extract-interactions",
    ]);
  });

  it("skips links, tiny captures, and everything when the CRM is not migrated", () => {
    expect(planCapturePipeline(capture({ capture_type: "link" }), { crmAvailable: true })).toEqual([]);
    expect(planCapturePipeline(capture({ content: "ok" }), { crmAvailable: true })).toEqual([]);
    expect(planCapturePipeline(capture(), { crmAvailable: false })).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

const QUEUE_SQL_WITH_CRM =
  "CREATE TABLE processing_queue (operation TEXT CHECK (operation IN ('generate_embedding','extract-interactions')))";

function mockCapabilities(opts: { state?: boolean; crm?: boolean; backlog?: number } = {}) {
  const { state = true, crm = true, backlog = 0 } = opts;
  vi.mocked(db.execute).mockImplementation((async (arg: { sql: string }) => {
    const sql = typeof arg === "string" ? arg : arg.sql;
    if (sql.includes("sqlite_master")) {
      const rows = [
        { name: "processing_queue", sql: crm ? QUEUE_SQL_WITH_CRM : "CREATE TABLE processing_queue ()" },
        { name: "entities", sql: "" },
        { name: "interactions", sql: "" },
      ];
      if (state) rows.push({ name: "content_index_state", sql: "" });
      return { rows, rowsAffected: 0 };
    }
    if (sql.includes("COUNT(*)")) return { rows: [{ n: backlog }], rowsAffected: 0 };
    return { rows: [], rowsAffected: 1 };
  }) as never);
}

function stateWrites() {
  return vi
    .mocked(db.execute)
    .mock.calls.map(([arg]) => arg as unknown as { sql: string; args: unknown[] })
    .filter((c) => typeof c === "object" && c.sql.includes("INSERT INTO content_index_state"));
}

describe("sweepUnprocessedContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnqueue.mockResolvedValue("job-id");
  });

  it("queues the pipeline for a note no write path queued, and records what it saw", async () => {
    mockCapabilities();
    vi.mocked(queryAll).mockResolvedValueOnce([note()]).mockResolvedValueOnce([]);

    const result = await sweepUnprocessedContent();

    expect(result.notesQueued).toBe(1);
    expect(result.jobsQueued).toBe(5);
    expect(mockEnqueue.mock.calls.map(([j]) => j.operation)).toContain("extract-interactions");

    const [write] = stateWrites();
    expect(write.args).toEqual([
      "note",
      "n1",
      "u1",
      hashContent(noteHashInput(note())),
      pipelineTag(true),
      // The row's own timestamp, never "now": an edit landing mid-sweep must
      // still read as newer than what was recorded.
      "2026-09-24 10:00:00",
    ]);
  });

  it("does not re-run the pipeline when only updated_at moved (a pin, an archive, a move)", async () => {
    mockCapabilities();
    const pinned = note({ updated_at: "2026-09-24 11:00:00" });
    vi.mocked(queryAll)
      .mockResolvedValueOnce([
        { ...pinned, indexed_hash: hashContent(noteHashInput(pinned)), indexed_pipeline: pipelineTag(true) },
      ])
      .mockResolvedValueOnce([]);

    const result = await sweepUnprocessedContent();

    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(result.unchanged).toBe(1);
    // Marked current, so it is not selected again next run.
    expect(stateWrites()[0].args[5]).toBe("2026-09-24 11:00:00");
  });

  it("re-runs the pipeline when the content changed", async () => {
    mockCapabilities();
    vi.mocked(queryAll)
      .mockResolvedValueOnce([note({ indexed_hash: "stale", indexed_pipeline: pipelineTag(true) })])
      .mockResolvedValueOnce([]);

    const result = await sweepUnprocessedContent();
    expect(result.notesQueued).toBe(1);
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it("queues contact extraction for captures", async () => {
    mockCapabilities();
    vi.mocked(queryAll).mockResolvedValueOnce([]).mockResolvedValueOnce([capture()]);

    const result = await sweepUnprocessedContent();
    expect(result.capturesQueued).toBe(1);
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "capture", operation: "extract-interactions" })
    );
  });

  it("only selects notes that have been quiet for a while, newest first", async () => {
    mockCapabilities();
    vi.mocked(queryAll).mockResolvedValue([]);

    await sweepUnprocessedContent();

    const [sql, args] = vi.mocked(queryAll).mock.calls[0];
    expect(sql).toContain("datetime(n.updated_at) <= datetime('now', ?)");
    expect(sql).toContain("ORDER BY n.updated_at DESC");
    expect(sql).toContain("is_archived");
    expect((args as unknown[])[0]).toMatch(/^-\d+ minutes$/);
  });

  it("yields when the queue already has a backlog, so it never outruns the drain", async () => {
    mockCapabilities({ backlog: MAX_PENDING_BACKLOG });
    const result = await sweepUnprocessedContent();
    expect(result.skipped).toBe("backlog");
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("does nothing before its table has been migrated", async () => {
    mockCapabilities({ state: false });
    const result = await sweepUnprocessedContent();
    expect(result.skipped).toBe("not_migrated");
    expect(queryAll).not.toHaveBeenCalled();
  });

  it("leaves contact extraction out when the queue cannot accept the job", async () => {
    mockCapabilities({ crm: false });
    vi.mocked(queryAll).mockResolvedValueOnce([note()]).mockResolvedValueOnce([]);

    await sweepUnprocessedContent();

    expect(mockEnqueue.mock.calls.map(([j]) => j.operation)).not.toContain("extract-interactions");
    expect(stateWrites()[0].args[4]).toBe(pipelineTag(false));
  });

  it("keeps going when one job cannot be queued, and never throws", async () => {
    mockCapabilities();
    mockEnqueue.mockRejectedValueOnce(new Error("CHECK constraint failed"));
    vi.mocked(queryAll).mockResolvedValueOnce([note()]).mockResolvedValueOnce([]);

    const result = await sweepUnprocessedContent();
    expect(result.errors).toBe(1);
    expect(result.jobsQueued).toBe(4);
  });

  it("reports a failed sweep instead of throwing into the cron", async () => {
    vi.mocked(db.execute).mockRejectedValue(new Error("db down"));
    await expect(sweepUnprocessedContent()).resolves.toMatchObject({ errors: 1 });
  });
});
