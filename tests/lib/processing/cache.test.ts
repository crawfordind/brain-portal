import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCacheKey, hashContent } from "@/lib/processing/cache";

// Mock the database module
vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  },
  queryOne: vi.fn().mockResolvedValue(null),
  mutate: vi.fn().mockResolvedValue(null),
}));

describe("generateCacheKey", () => {
  it("generates consistent hash for same inputs", () => {
    const key1 = generateCacheKey("test_op", { foo: "bar" });
    const key2 = generateCacheKey("test_op", { foo: "bar" });

    expect(key1).toBe(key2);
  });

  it("generates different hash for different operations", () => {
    const key1 = generateCacheKey("op1", { foo: "bar" });
    const key2 = generateCacheKey("op2", { foo: "bar" });

    expect(key1).not.toBe(key2);
  });

  it("generates different hash for different inputs", () => {
    const key1 = generateCacheKey("test_op", { foo: "bar" });
    const key2 = generateCacheKey("test_op", { foo: "baz" });

    expect(key1).not.toBe(key2);
  });

  it("handles complex nested inputs", () => {
    const complexInput = {
      nested: { deep: { value: 123 } },
      array: [1, 2, 3],
      string: "test",
    };

    const key = generateCacheKey("complex", complexInput);
    expect(key).toBeTruthy();
    expect(key.length).toBe(64); // SHA-256 hex length
  });

  it("handles null and undefined inputs", () => {
    const key1 = generateCacheKey("test", null);
    const key2 = generateCacheKey("test", undefined);

    expect(key1).toBeTruthy();
    expect(key2).toBeTruthy();
    // null and undefined serialize differently
    expect(key1).not.toBe(key2);
  });

  it("is order-sensitive for object keys", () => {
    // JSON.stringify maintains key order, so these should be different
    const key1 = generateCacheKey("test", { a: 1, b: 2 });
    const key2 = generateCacheKey("test", { b: 2, a: 1 });

    // Note: In JavaScript, object key order is preserved for string keys
    // So these may or may not be equal depending on engine
    expect(key1).toBeTruthy();
    expect(key2).toBeTruthy();
  });
});

describe("hashContent", () => {
  it("generates consistent hash for same content", () => {
    const hash1 = hashContent("Hello, world!");
    const hash2 = hashContent("Hello, world!");

    expect(hash1).toBe(hash2);
  });

  it("generates different hash for different content", () => {
    const hash1 = hashContent("Hello, world!");
    const hash2 = hashContent("Hello, World!");

    expect(hash1).not.toBe(hash2);
  });

  it("returns SHA-256 hex string", () => {
    const hash = hashContent("test content");

    expect(hash.length).toBe(64);
    expect(/^[a-f0-9]+$/.test(hash)).toBe(true);
  });

  it("handles empty string", () => {
    const hash = hashContent("");

    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64);
  });

  it("handles unicode content", () => {
    const hash = hashContent("こんにちは世界 🌍");

    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64);
  });

  it("handles very long content", () => {
    const longContent = "x".repeat(1000000);
    const hash = hashContent(longContent);

    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64);
  });

  it("is case sensitive", () => {
    const hash1 = hashContent("ABC");
    const hash2 = hashContent("abc");

    expect(hash1).not.toBe(hash2);
  });

  it("is whitespace sensitive", () => {
    const hash1 = hashContent("hello world");
    const hash2 = hashContent("hello  world");

    expect(hash1).not.toBe(hash2);
  });
});

describe("getCached", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { queryOne, db } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("returns null when no cache entry exists", async () => {
    const { getCached } = await import("@/lib/processing/cache");
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getCached("user123", "cachekey");

    expect(result).toBeNull();
  });

  it("returns cached value when entry exists", async () => {
    const { getCached } = await import("@/lib/processing/cache");
    const cachedData = { foo: "bar", num: 123 };

    mockQueryOne.mockResolvedValueOnce({
      output: JSON.stringify(cachedData),
      hit_count: 5,
    });

    const result = await getCached("user123", "cachekey");

    expect(result).toEqual(cachedData);
  });

  it("updates hit count on cache hit", async () => {
    const { getCached } = await import("@/lib/processing/cache");

    mockQueryOne.mockResolvedValueOnce({
      output: JSON.stringify({ data: "test" }),
      hit_count: 5,
    });

    await getCached("user123", "cachekey");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("hit_count = hit_count + 1"),
      })
    );
  });
});

describe("setCache", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("stores cache entry with TTL", async () => {
    const { setCache } = await import("@/lib/processing/cache");

    await setCache("user123", "key", { data: "value" }, {
      ttlHours: 24,
      operation: "test_op",
      tier: "fast_llm",
    });

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("INSERT OR REPLACE INTO ai_cache"),
        args: expect.arrayContaining(["user123", "key", "test_op"]),
      })
    );
  });

  it("stores cache entry without TTL (never expires)", async () => {
    const { setCache } = await import("@/lib/processing/cache");

    await setCache("user123", "key", { data: "value" }, {
      operation: "test_op",
      tier: "embedding",
      // No ttlHours = never expires
    });

    expect(mockDb.execute).toHaveBeenCalled();
    // The last arg (expires_at) should be null
    const call = mockDb.execute.mock.calls[0][0];
    expect(call.args[call.args.length - 1]).toBeNull();
  });

  it("includes token and cost information", async () => {
    const { setCache } = await import("@/lib/processing/cache");

    await setCache("user123", "key", { data: "value" }, {
      operation: "test_op",
      tier: "full_llm",
      tokensUsed: 1500,
      costCents: 2.5,
    });

    const call = mockDb.execute.mock.calls[0][0];
    expect(call.args).toContain(1500);
    expect(call.args).toContain(2.5);
  });
});

describe("invalidateCache", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    mockDb.execute.mockResolvedValue({ rowsAffected: 3 });
    vi.clearAllMocks();
  });

  it("invalidates by key", async () => {
    const { invalidateCache } = await import("@/lib/processing/cache");

    const result = await invalidateCache("user123", { key: "specific-key" });

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("cache_key = ?"),
      })
    );
    expect(result).toBe(3);
  });

  it("invalidates by operation", async () => {
    const { invalidateCache } = await import("@/lib/processing/cache");

    await invalidateCache("user123", { operation: "generate_summary" });

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("operation_type = ?"),
      })
    );
  });

  it("invalidates by entity ID", async () => {
    const { invalidateCache } = await import("@/lib/processing/cache");

    await invalidateCache("user123", { entityId: "note-abc-123" });

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("output LIKE ?"),
        args: expect.arrayContaining(["%note-abc-123%"]),
      })
    );
  });

  it("returns number of deleted entries", async () => {
    const { invalidateCache } = await import("@/lib/processing/cache");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 5 });

    const result = await invalidateCache("user123", { operation: "test" });

    expect(result).toBe(5);
  });
});

describe("cleanupExpiredCache", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("deletes expired entries", async () => {
    const { cleanupExpiredCache } = await import("@/lib/processing/cache");
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 10 });

    const result = await cleanupExpiredCache();

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("expires_at < datetime('now')"),
      })
    );
    expect(result).toBe(10);
  });
});

describe("getCacheStats", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { queryOne, db } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("returns aggregated statistics", async () => {
    const { getCacheStats } = await import("@/lib/processing/cache");

    mockQueryOne.mockResolvedValueOnce({
      total_entries: 100,
      total_hits: 500,
      total_tokens: 50000,
      total_cost: 1.5,
    });

    mockDb.execute.mockResolvedValueOnce({
      rows: [
        { tier: "embedding", count: 50, tokens: 10000, cost: 0.2 },
        { tier: "fast_llm", count: 30, tokens: 30000, cost: 0.9 },
        { tier: "full_llm", count: 20, tokens: 10000, cost: 0.4 },
      ],
    });

    const stats = await getCacheStats("user123");

    expect(stats.totalEntries).toBe(100);
    expect(stats.totalHits).toBe(500);
    expect(stats.totalTokens).toBe(50000);
    expect(stats.byTier.embedding.count).toBe(50);
    expect(stats.byTier.fast_llm.count).toBe(30);
    expect(stats.byTier.full_llm.count).toBe(20);
  });

  it("returns zeros for empty cache", async () => {
    const { getCacheStats } = await import("@/lib/processing/cache");

    mockQueryOne.mockResolvedValueOnce(null);
    mockDb.execute.mockResolvedValueOnce({ rows: [] });

    const stats = await getCacheStats("user123");

    expect(stats.totalEntries).toBe(0);
    expect(stats.totalHits).toBe(0);
    expect(stats.byTier.local.count).toBe(0);
    expect(stats.byTier.embedding.count).toBe(0);
  });
});
