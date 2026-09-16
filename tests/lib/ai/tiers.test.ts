import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getTierForOperation,
  getTierConfig,
  estimateCost,
  getStats,
  resetStats,
  recordUsage,
} from "@/lib/ai/tiers";

// Mock the AI client
vi.mock("@/lib/ai/client", () => ({
  complete: vi.fn().mockResolvedValue("mocked response"),
  completeJSON: vi.fn().mockResolvedValue({}),
  openrouter: {
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: Array(1536).fill(0.1) }],
      }),
    },
  },
  DEFAULT_MODEL: "x-ai/grok-4.1-fast",
  MINIMAX_MODEL: "minimax/minimax-m2.5",
}));

// Mock embeddings module
vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array(1536).fill(0.1)),
  cosineSimilarity: vi.fn().mockReturnValue(0.8),
}));

// Mock local processing
vi.mock("@/lib/processing/local", () => ({
  processLocally: vi.fn().mockReturnValue({
    links: [],
    wikilinks: [],
    structure: { wordCount: 100 },
    excerpt: "test excerpt",
    potentialTags: [],
    contentPlain: "plain text",
  }),
  extractWikilinks: vi.fn().mockReturnValue([]),
}));

// Mock cache module
vi.mock("@/lib/processing/cache", () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCache: vi.fn().mockResolvedValue(undefined),
  generateCacheKey: vi.fn((op: string) => `key-${op}`),
  hashContent: vi.fn((content: string) => `hash-${content.length}`),
}));

// Mock database
vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  },
  queryOne: vi.fn().mockResolvedValue(null),
  queryAll: vi.fn().mockResolvedValue([]),
  mutate: vi.fn().mockResolvedValue(null),
}));

describe("getTierForOperation", () => {
  it("returns local tier for link extraction", () => {
    expect(getTierForOperation("extract_links")).toBe("local");
  });

  it("returns local tier for structure analysis", () => {
    expect(getTierForOperation("analyze_structure")).toBe("local");
  });

  it("returns local tier for word count", () => {
    expect(getTierForOperation("count_words")).toBe("local");
  });

  it("returns embedding tier for embedding generation", () => {
    expect(getTierForOperation("generate_embedding")).toBe("embedding");
  });

  it("returns embedding tier for similarity search", () => {
    expect(getTierForOperation("find_similar")).toBe("embedding");
  });

  it("returns fast_llm tier for summary generation", () => {
    expect(getTierForOperation("generate_summary")).toBe("fast_llm");
  });

  it("returns fast_llm tier for tag generation", () => {
    expect(getTierForOperation("generate_tags")).toBe("fast_llm");
  });

  it("returns fast_llm tier for capture classification", () => {
    expect(getTierForOperation("classify_capture")).toBe("fast_llm");
  });

  it("returns full_llm tier for insight generation", () => {
    expect(getTierForOperation("generate_insights")).toBe("full_llm");
  });

  it("returns full_llm tier for weekly review", () => {
    expect(getTierForOperation("weekly_review")).toBe("full_llm");
  });
});

describe("getTierConfig", () => {
  it("returns local tier config", () => {
    const config = getTierConfig("local");

    expect(config.tier).toBe("local");
    expect(config.cacheTTL).toBe(0); // No caching for local
  });

  it("returns embedding tier config", () => {
    const config = getTierConfig("embedding");

    expect(config.tier).toBe("embedding");
    // Tiers name a slot rather than a model id, so the concrete model is
    // resolved per call against the user's setting and the live catalog.
    expect(config.slot).toBe("embedding");
    expect(config.cacheTTL).toBe(168); // 7 days
  });

  it("returns fast_llm tier config", () => {
    const config = getTierConfig("fast_llm");

    expect(config.tier).toBe("fast_llm");
    expect(config.cacheTTL).toBe(24); // 24 hours
    expect(config.maxTokens).toBe(500);
    expect(config.temperature).toBe(0.3);
  });

  it("returns full_llm tier config", () => {
    const config = getTierConfig("full_llm");

    expect(config.tier).toBe("full_llm");
    expect(config.cacheTTL).toBe(48); // 48 hours
    expect(config.maxTokens).toBe(2048);
    expect(config.temperature).toBe(0.6);
  });
});

describe("estimateCost", () => {
  it("returns 0 for local tier", () => {
    const cost = estimateCost("extract_links", 1000, 0);

    expect(cost).toBe(0);
  });

  it("estimates embedding cost", () => {
    // $0.02 per million tokens
    const cost = estimateCost("generate_embedding", 1000000, 0);

    expect(cost).toBeCloseTo(20, 1); // $0.02 * 1000 = $20 cents
  });

  it("estimates fast_llm cost", () => {
    // $0.30 per million tokens (input + output)
    const cost = estimateCost("generate_summary", 500, 100);

    // (500 + 100) * 0.0003 = 0.18 cents
    expect(cost).toBeCloseTo(0.18, 2);
  });

  it("estimates full_llm cost", () => {
    // $1.50 per million tokens
    const cost = estimateCost("generate_insights", 1000, 500);

    // (1000 + 500) * 0.0015 = 2.25 cents
    expect(cost).toBeCloseTo(2.25, 2);
  });

  it("handles zero tokens", () => {
    const cost = estimateCost("generate_summary", 0, 0);

    expect(cost).toBe(0);
  });
});

describe("processLocal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls processLocally function", async () => {
    const { processLocal } = await import("@/lib/ai/tiers");
    const { processLocally } = await import("@/lib/processing/local");

    await processLocal("test content");

    expect(processLocally).toHaveBeenCalledWith("test content");
  });

  it("returns local tier and zero cost", async () => {
    const { processLocal } = await import("@/lib/ai/tiers");

    const result = await processLocal("test content");

    expect(result.tier).toBe("local");
    expect(result.cached).toBe(false);
    expect(result.tokensUsed).toBe(0);
    expect(result.costCents).toBe(0);
  });

  it("returns processing result", async () => {
    const { processLocal } = await import("@/lib/ai/tiers");

    const result = await processLocal("test content");

    expect(result.result).toBeDefined();
    expect(result.result.contentPlain).toBe("plain text");
  });
});

describe("processEmbedding", () => {
  let mockGetCached: ReturnType<typeof vi.fn>;
  let mockSetCache: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cache = await import("@/lib/processing/cache");
    mockGetCached = cache.getCached as unknown as ReturnType<typeof vi.fn>;
    mockSetCache = cache.setCache as unknown as ReturnType<typeof vi.fn>;
  });

  it("returns cached embedding if available", async () => {
    const { processEmbedding } = await import("@/lib/ai/tiers");
    const cachedEmb = Array(1536).fill(0.5);
    mockGetCached.mockResolvedValueOnce(cachedEmb);

    const result = await processEmbedding("user-123", "test text");

    expect(result.cached).toBe(true);
    expect(result.result).toEqual(cachedEmb);
    expect(result.tokensUsed).toBe(0);
    expect(result.costCents).toBe(0);
  });

  it("generates new embedding when not cached", async () => {
    const { processEmbedding } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);

    const result = await processEmbedding("user-123", "test text");

    expect(result.cached).toBe(false);
    expect(result.result).toHaveLength(1536);
    expect(result.tier).toBe("embedding");
  });

  it("caches new embedding", async () => {
    const { processEmbedding } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);

    await processEmbedding("user-123", "test text");

    expect(mockSetCache).toHaveBeenCalledWith(
      "user-123",
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        operation: "generate_embedding",
        tier: "embedding",
      })
    );
  });
});

describe("processSummary", () => {
  let mockGetCached: ReturnType<typeof vi.fn>;
  let mockSetCache: ReturnType<typeof vi.fn>;
  let mockComplete: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cache = await import("@/lib/processing/cache");
    const client = await import("@/lib/ai/client");
    mockGetCached = cache.getCached as unknown as ReturnType<typeof vi.fn>;
    mockSetCache = cache.setCache as unknown as ReturnType<typeof vi.fn>;
    mockComplete = client.complete as unknown as ReturnType<typeof vi.fn>;
  });

  it("returns cached summary if available", async () => {
    const { processSummary } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce("Cached summary text");

    const result = await processSummary("user-123", "Title", "Content");

    expect(result.cached).toBe(true);
    expect(result.result).toBe("Cached summary text");
    expect(result.tokensUsed).toBe(0);
  });

  it("generates new summary when not cached", async () => {
    const { processSummary } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce("New generated summary");

    const result = await processSummary("user-123", "Title", "Content");

    expect(result.cached).toBe(false);
    expect(result.result).toBe("New generated summary");
    expect(result.tier).toBe("fast_llm");
  });

  it("truncates long content", async () => {
    const { processSummary } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce("Summary");

    const longContent = "x".repeat(3000);
    await processSummary("user-123", "Title", longContent);

    expect(mockComplete).toHaveBeenCalledWith(
      expect.stringContaining("x".repeat(2000)), // Should truncate
      expect.any(Object)
    );
  });
});

describe("processTags", () => {
  let mockGetCached: ReturnType<typeof vi.fn>;
  let mockSetCache: ReturnType<typeof vi.fn>;
  let mockComplete: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cache = await import("@/lib/processing/cache");
    const client = await import("@/lib/ai/client");
    mockGetCached = cache.getCached as unknown as ReturnType<typeof vi.fn>;
    mockSetCache = cache.setCache as unknown as ReturnType<typeof vi.fn>;
    mockComplete = client.complete as unknown as ReturnType<typeof vi.fn>;
  });

  it("returns cached tags if available", async () => {
    const { processTags } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(["tag1", "tag2", "tag3"]);

    const result = await processTags("user-123", "Title", "Content");

    expect(result.cached).toBe(true);
    expect(result.result).toEqual(["tag1", "tag2", "tag3"]);
  });

  it("generates and parses tags from JSON response", async () => {
    const { processTags } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce('["javascript", "react", "testing"]');

    const result = await processTags("user-123", "Title", "Content");

    expect(result.cached).toBe(false);
    expect(result.result).toEqual(["javascript", "react", "testing"]);
  });

  it("handles invalid JSON response", async () => {
    const { processTags } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce("invalid json");

    const result = await processTags("user-123", "Title", "Content");

    expect(result.result).toEqual([]);
  });

  it("extracts tags from partial JSON response", async () => {
    const { processTags } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce('Here are the tags: ["tag1", "tag2"]');

    const result = await processTags("user-123", "Title", "Content");

    expect(result.result).toEqual(["tag1", "tag2"]);
  });
});

describe("processClassifyCapture", () => {
  let mockGetCached: ReturnType<typeof vi.fn>;
  let mockComplete: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const cache = await import("@/lib/processing/cache");
    const client = await import("@/lib/ai/client");
    mockGetCached = cache.getCached as unknown as ReturnType<typeof vi.fn>;
    mockComplete = client.complete as unknown as ReturnType<typeof vi.fn>;
  });

  it("returns cached classification if available", async () => {
    const { processClassifyCapture } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce({ type: "idea", summary: "Cached summary" });

    const result = await processClassifyCapture("user-123", "Test capture");

    expect(result.cached).toBe(true);
    expect(result.result.type).toBe("idea");
  });

  it("classifies capture content", async () => {
    const { processClassifyCapture } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce('{"type": "task", "summary": "Do something"}');

    const result = await processClassifyCapture("user-123", "Need to finish the report");

    expect(result.result.type).toBe("task");
    expect(result.result.summary).toBe("Do something");
  });

  it("uses default on invalid JSON", async () => {
    const { processClassifyCapture } = await import("@/lib/ai/tiers");
    mockGetCached.mockResolvedValueOnce(null);
    mockComplete.mockResolvedValueOnce("invalid response");

    const result = await processClassifyCapture("user-123", "Some content here");

    expect(result.result.type).toBe("thought"); // Default type
  });
});

describe("stats tracking", () => {
  beforeEach(() => {
    resetStats();
  });

  it("records usage correctly", () => {
    recordUsage("embedding", 1000, 0.02, false);
    recordUsage("embedding", 500, 0.01, true);

    const stats = getStats();
    const embeddingStats = stats.find((s) => s.tier === "embedding");

    expect(embeddingStats?.callCount).toBe(2);
    expect(embeddingStats?.tokensUsed).toBe(1500);
    expect(embeddingStats?.costCents).toBeCloseTo(0.03, 5);
    expect(embeddingStats?.cacheHits).toBe(1);
  });

  it("tracks stats by tier", () => {
    recordUsage("local", 0, 0, false);
    recordUsage("embedding", 1000, 0.02, false);
    recordUsage("fast_llm", 500, 0.15, false);
    recordUsage("full_llm", 2000, 3, false);

    const stats = getStats();

    expect(stats).toHaveLength(4);
    expect(stats.find((s) => s.tier === "local")?.callCount).toBe(1);
    expect(stats.find((s) => s.tier === "embedding")?.callCount).toBe(1);
    expect(stats.find((s) => s.tier === "fast_llm")?.callCount).toBe(1);
    expect(stats.find((s) => s.tier === "full_llm")?.callCount).toBe(1);
  });

  it("resets stats correctly", () => {
    recordUsage("embedding", 1000, 0.02, false);

    resetStats();

    const stats = getStats();
    const embeddingStats = stats.find((s) => s.tier === "embedding");

    expect(embeddingStats?.callCount).toBe(0);
    expect(embeddingStats?.tokensUsed).toBe(0);
  });

  it("accumulates multiple calls", () => {
    for (let i = 0; i < 10; i++) {
      recordUsage("fast_llm", 100, 0.03, i % 2 === 0);
    }

    const stats = getStats();
    const fastLlmStats = stats.find((s) => s.tier === "fast_llm");

    expect(fastLlmStats?.callCount).toBe(10);
    expect(fastLlmStats?.tokensUsed).toBe(1000);
    expect(fastLlmStats?.costCents).toBeCloseTo(0.3, 5);
    expect(fastLlmStats?.cacheHits).toBe(5);
  });
});
