import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Operation, QueueJobInput } from "@/lib/processing/queue";

// Mock the database module
vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  },
  queryOne: vi.fn().mockResolvedValue(null),
  queryAll: vi.fn().mockResolvedValue([]),
  mutate: vi.fn().mockResolvedValue({ id: "new-job-id" }),
}));

describe("enqueue", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockMutate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryOne, mutate } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockMutate = mutate as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("creates a new job when no duplicate exists", async () => {
    const { enqueue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);
    mockMutate.mockResolvedValueOnce({ id: "new-job-123" });

    const job: QueueJobInput = {
      userId: "user-1",
      entityType: "note",
      entityId: "note-abc",
      operation: "generate_embedding",
      tier: "embedding",
      priority: 1,
    };

    const jobId = await enqueue(job);

    expect(jobId).toBe("new-job-123");
    expect(mockMutate).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO processing_queue"),
      expect.arrayContaining(["user-1", "note", "note-abc", "generate_embedding", "embedding", 1])
    );
  });

  it("returns existing job ID when duplicate exists", async () => {
    const { enqueue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce({ id: "existing-job-456" });

    const job: QueueJobInput = {
      userId: "user-1",
      entityType: "note",
      entityId: "note-abc",
      operation: "generate_embedding",
      tier: "embedding",
    };

    const jobId = await enqueue(job);

    expect(jobId).toBe("existing-job-456");
    expect(mockMutate).not.toHaveBeenCalled();
  });

  it("stores metadata as JSON", async () => {
    const { enqueue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);
    mockMutate.mockResolvedValueOnce({ id: "new-job" });

    const job: QueueJobInput = {
      userId: "user-1",
      entityType: "note",
      entityId: "note-abc",
      operation: "find_connections",
      tier: "embedding",
      metadata: { wikilinks: ["Page A", "Page B"] },
    };

    await enqueue(job);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([JSON.stringify({ wikilinks: ["Page A", "Page B"] })])
    );
  });

  it("uses default priority of 0", async () => {
    const { enqueue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);
    mockMutate.mockResolvedValueOnce({ id: "new-job" });

    const job: QueueJobInput = {
      userId: "user-1",
      entityType: "note",
      entityId: "note-abc",
      operation: "generate_summary",
      tier: "fast_llm",
      // No priority specified
    };

    await enqueue(job);

    expect(mockMutate).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining([0]) // Default priority
    );
  });
});

describe("enqueueBatch", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockMutate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryOne, mutate } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockMutate = mutate as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("enqueues multiple jobs", async () => {
    const { enqueueBatch } = await import("@/lib/processing/queue");

    mockQueryOne.mockResolvedValue(null);
    mockMutate
      .mockResolvedValueOnce({ id: "job-1" })
      .mockResolvedValueOnce({ id: "job-2" })
      .mockResolvedValueOnce({ id: "job-3" });

    const jobs: QueueJobInput[] = [
      { userId: "user-1", entityType: "note", entityId: "n1", operation: "generate_embedding", tier: "embedding" },
      { userId: "user-1", entityType: "note", entityId: "n2", operation: "generate_embedding", tier: "embedding" },
      { userId: "user-1", entityType: "note", entityId: "n3", operation: "generate_embedding", tier: "embedding" },
    ];

    const ids = await enqueueBatch(jobs);

    expect(ids).toHaveLength(3);
    expect(ids).toContain("job-1");
    expect(ids).toContain("job-2");
    expect(ids).toContain("job-3");
  });
});

describe("dequeue", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { queryOne, db } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("returns null when no jobs available", async () => {
    const { dequeue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);

    const job = await dequeue();

    expect(job).toBeNull();
  });

  it("returns next pending job", async () => {
    const { dequeue } = await import("@/lib/processing/queue");
    const mockJob = {
      id: "job-123",
      entity_type: "note",
      entity_id: "note-abc",
      operation: "generate_embedding",
      status: "pending",
    };
    mockQueryOne.mockResolvedValueOnce(mockJob);

    const job = await dequeue();

    expect(job).toEqual(mockJob);
  });

  it("marks job as processing", async () => {
    const { dequeue } = await import("@/lib/processing/queue");
    const mockJob = { id: "job-123" };
    mockQueryOne.mockResolvedValueOnce(mockJob);

    await dequeue();

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("status = 'processing'"),
        args: ["job-123"],
      })
    );
  });

  it("filters by tier when specified", async () => {
    const { dequeue } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);

    await dequeue("embedding");

    expect(mockQueryOne).toHaveBeenCalledWith(
      expect.stringContaining("AND tier = ?"),
      ["embedding"]
    );
  });

  it("increments attempt counter", async () => {
    const { dequeue } = await import("@/lib/processing/queue");
    const mockJob = { id: "job-123" };
    mockQueryOne.mockResolvedValueOnce(mockJob);

    await dequeue();

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("attempts = attempts + 1"),
      })
    );
  });
});

describe("completeJob", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("marks job as completed", async () => {
    const { completeJob } = await import("@/lib/processing/queue");

    await completeJob("job-123");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("status = 'completed'"),
        args: ["job-123"],
      })
    );
  });

  it("sets completed_at timestamp", async () => {
    const { completeJob } = await import("@/lib/processing/queue");

    await completeJob("job-123");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("completed_at = datetime('now')"),
      })
    );
  });
});

describe("failJob", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { queryOne, db } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("sets job back to pending if retries available", async () => {
    const { failJob } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce({ attempts: 1, max_attempts: 3 });

    await failJob("job-123", "Connection timeout");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("status = ?"),
        args: expect.arrayContaining(["pending", "Connection timeout"]),
      })
    );
  });

  it("sets job to failed when max attempts reached", async () => {
    const { failJob } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce({ attempts: 3, max_attempts: 3 });

    await failJob("job-123", "Permanent failure");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(["failed", "Permanent failure"]),
      })
    );
  });

  it("stores error message", async () => {
    const { failJob } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce({ attempts: 1, max_attempts: 3 });

    await failJob("job-123", "API rate limit exceeded");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("error_message = ?"),
        args: expect.arrayContaining(["API rate limit exceeded"]),
      })
    );
  });
});

describe("getJobStatus", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryOne } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("returns job details", async () => {
    const { getJobStatus } = await import("@/lib/processing/queue");
    const mockJob = {
      id: "job-123",
      status: "processing",
      operation: "generate_embedding",
    };
    mockQueryOne.mockResolvedValueOnce(mockJob);

    const job = await getJobStatus("job-123");

    expect(job).toEqual(mockJob);
  });

  it("returns null for non-existent job", async () => {
    const { getJobStatus } = await import("@/lib/processing/queue");
    mockQueryOne.mockResolvedValueOnce(null);

    const job = await getJobStatus("nonexistent");

    expect(job).toBeNull();
  });
});

describe("getPendingJobs", () => {
  let mockQueryAll: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryAll } = await import("@/lib/db/client");
    mockQueryAll = queryAll as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("returns pending jobs for entity", async () => {
    const { getPendingJobs } = await import("@/lib/processing/queue");
    const mockJobs = [
      { id: "job-1", operation: "generate_embedding" },
      { id: "job-2", operation: "generate_summary" },
    ];
    mockQueryAll.mockResolvedValueOnce(mockJobs);

    const jobs = await getPendingJobs("note", "note-abc");

    expect(jobs).toHaveLength(2);
    expect(mockQueryAll).toHaveBeenCalledWith(
      expect.stringContaining("status IN ('pending', 'processing')"),
      ["note", "note-abc"]
    );
  });

  it("returns empty array when no pending jobs", async () => {
    const { getPendingJobs } = await import("@/lib/processing/queue");
    mockQueryAll.mockResolvedValueOnce([]);

    const jobs = await getPendingJobs("note", "note-abc");

    expect(jobs).toHaveLength(0);
  });
});

describe("getQueueStats", () => {
  let mockQueryAll: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryAll } = await import("@/lib/db/client");
    mockQueryAll = queryAll as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("returns aggregated queue statistics", async () => {
    const { getQueueStats } = await import("@/lib/processing/queue");

    mockQueryAll
      .mockResolvedValueOnce([
        { status: "pending", count: 10 },
        { status: "processing", count: 2 },
        { status: "completed", count: 100 },
        { status: "failed", count: 5 },
      ])
      .mockResolvedValueOnce([
        { tier: "embedding", count: 5 },
        { tier: "fast_llm", count: 7 },
      ])
      .mockResolvedValueOnce([
        { operation: "generate_embedding", count: 5 },
        { operation: "generate_summary", count: 7 },
      ]);

    const stats = await getQueueStats();

    expect(stats.pending).toBe(10);
    expect(stats.processing).toBe(2);
    expect(stats.completed).toBe(100);
    expect(stats.failed).toBe(5);
    expect(stats.byTier.embedding).toBe(5);
    expect(stats.byTier.fast_llm).toBe(7);
    expect(stats.byOperation["generate_embedding"]).toBe(5);
  });

  it("returns zeros for empty queue", async () => {
    const { getQueueStats } = await import("@/lib/processing/queue");

    mockQueryAll
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const stats = await getQueueStats();

    expect(stats.pending).toBe(0);
    expect(stats.processing).toBe(0);
    expect(stats.byTier.embedding).toBe(0);
  });
});

describe("cleanupOldJobs", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("deletes completed jobs older than specified days", async () => {
    const { cleanupOldJobs } = await import("@/lib/processing/queue");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 25 });

    const deleted = await cleanupOldJobs(7);

    expect(deleted).toBe(25);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("-7 days"),
      })
    );
  });

  it("uses default of 7 days", async () => {
    const { cleanupOldJobs } = await import("@/lib/processing/queue");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 0 });

    await cleanupOldJobs();

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("-7 days"),
      })
    );
  });
});

describe("cancelJobs", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("cancels pending jobs for entity", async () => {
    const { cancelJobs } = await import("@/lib/processing/queue");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 3 });

    const cancelled = await cancelJobs("note", "note-abc");

    expect(cancelled).toBe(3);
    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM processing_queue"),
        args: ["note", "note-abc"],
      })
    );
  });

  it("only cancels pending jobs (not processing)", async () => {
    const { cancelJobs } = await import("@/lib/processing/queue");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 0 });

    await cancelJobs("note", "note-abc");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("status = 'pending'"),
      })
    );
  });
});
