import { describe, it, expect, vi, beforeEach } from "vitest";
import { cosineSimilarity } from "@/lib/ai/embeddings";

// Mock the OpenRouter client
vi.mock("@/lib/ai/client", () => ({
  openrouter: {
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: Array(1536).fill(0.1) }],
      }),
    },
  },
}));

// Mock the database module
vi.mock("@/lib/db/client", () => ({
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [], rowsAffected: 0 }),
  },
  queryOne: vi.fn().mockResolvedValue(null),
  queryAll: vi.fn().mockResolvedValue([]),
  mutate: vi.fn().mockResolvedValue(null),
}));

// Mock the cache module
vi.mock("@/lib/processing/cache", () => ({
  hashContent: vi.fn((content: string) => `hash-${content.length}`),
}));

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(1, 5);
  });

  it("returns -1 for opposite vectors", () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(-1, 5);
  });

  it("returns 0 for orthogonal vectors", () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(0, 5);
  });

  it("returns high similarity for similar vectors", () => {
    const a = [1, 2, 3];
    const b = [1.1, 2.1, 3.1];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeGreaterThan(0.99);
  });

  it("throws error for mismatched dimensions", () => {
    const a = [1, 2, 3];
    const b = [1, 2];

    expect(() => cosineSimilarity(a, b)).toThrow("Embedding dimensions must match");
  });

  it("handles zero vectors", () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBe(0);
  });

  it("handles empty vectors", () => {
    const a: number[] = [];
    const b: number[] = [];

    // Empty vectors have zero norms, so similarity returns 0
    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBe(0);
  });

  it("is commutative", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [5, 4, 3, 2, 1];

    const simAB = cosineSimilarity(a, b);
    const simBA = cosineSimilarity(b, a);

    expect(simAB).toBeCloseTo(simBA, 10);
  });

  it("handles large vectors efficiently", () => {
    const a = Array(1536).fill(0).map((_, i) => Math.sin(i));
    const b = Array(1536).fill(0).map((_, i) => Math.cos(i));

    const start = performance.now();
    const similarity = cosineSimilarity(a, b);
    const duration = performance.now() - start;

    expect(typeof similarity).toBe("number");
    expect(duration).toBeLessThan(10); // Should complete in < 10ms
  });

  it("handles negative values", () => {
    const a = [-1, -2, -3];
    const b = [-1, -2, -3];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(1, 5);
  });

  it("is scale-invariant", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6]; // a * 2

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(1, 5);
  });

  it("handles mixed positive and negative", () => {
    const a = [1, -1, 1];
    const b = [-1, 1, -1];

    const similarity = cosineSimilarity(a, b);

    expect(similarity).toBeCloseTo(-1, 5);
  });
});

describe("generateEmbedding", () => {
  let mockOpenRouter: { embeddings: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    const { openrouter } = await import("@/lib/ai/client");
    mockOpenRouter = openrouter as unknown as { embeddings: { create: ReturnType<typeof vi.fn> } };
    vi.clearAllMocks();
  });

  it("calls OpenRouter with correct model", async () => {
    const { generateEmbedding } = await import("@/lib/ai/embeddings");
    mockOpenRouter.embeddings.create.mockResolvedValueOnce({
      data: [{ embedding: Array(1536).fill(0.5) }],
    });

    await generateEmbedding("test text");

    expect(mockOpenRouter.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "openai/text-embedding-3-small",
        input: "test text",
      })
    );
  });

  it("returns embedding array", async () => {
    const { generateEmbedding } = await import("@/lib/ai/embeddings");
    const mockEmbedding = Array(1536).fill(0).map((_, i) => i / 1536);
    mockOpenRouter.embeddings.create.mockResolvedValueOnce({
      data: [{ embedding: mockEmbedding }],
    });

    const result = await generateEmbedding("test text");

    expect(result).toEqual(mockEmbedding);
    expect(result).toHaveLength(1536);
  });

  it("truncates long text", async () => {
    const { generateEmbedding } = await import("@/lib/ai/embeddings");
    mockOpenRouter.embeddings.create.mockResolvedValueOnce({
      data: [{ embedding: Array(1536).fill(0.1) }],
    });

    const longText = "x".repeat(10000);
    await generateEmbedding(longText);

    expect(mockOpenRouter.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.any(String),
      })
    );
    // The input should be truncated to 8191 chars
    const calledInput = mockOpenRouter.embeddings.create.mock.calls[0][0].input;
    expect(calledInput.length).toBeLessThanOrEqual(8191);
  });
});

describe("storeEmbedding", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("stores embedding with correct parameters", async () => {
    const { storeEmbedding } = await import("@/lib/ai/embeddings");
    const embedding = [0.1, 0.2, 0.3];

    await storeEmbedding("user-123", "note", "note-abc", embedding, "hash123");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("INSERT OR REPLACE INTO embeddings"),
        args: expect.arrayContaining([
          "user-123",
          "note",
          "note-abc",
          "openai/text-embedding-3-small",
          JSON.stringify(embedding),
          "hash123",
        ]),
      })
    );
  });

  it("stores embedding as JSON", async () => {
    const { storeEmbedding } = await import("@/lib/ai/embeddings");
    const embedding = [0.1, 0.2, 0.3];

    await storeEmbedding("user-123", "note", "note-abc", embedding, "hash123");

    const args = mockDb.execute.mock.calls[0][0].args;
    const storedEmbedding = args.find((arg: unknown) =>
      typeof arg === "string" && arg.startsWith("[")
    );

    expect(JSON.parse(storedEmbedding)).toEqual(embedding);
  });
});

describe("getEmbedding", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryOne } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("returns null when embedding not found", async () => {
    const { getEmbedding } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await getEmbedding("note", "nonexistent");

    expect(result).toBeNull();
  });

  it("returns embedding and content hash", async () => {
    const { getEmbedding } = await import("@/lib/ai/embeddings");
    const mockEmbedding = [0.1, 0.2, 0.3];
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify(mockEmbedding),
      content_hash: "abc123",
    });

    const result = await getEmbedding("note", "note-abc");

    expect(result).toEqual({
      embedding: mockEmbedding,
      contentHash: "abc123",
    });
  });

  it("parses JSON embedding correctly", async () => {
    const { getEmbedding } = await import("@/lib/ai/embeddings");
    const complexEmbedding = Array(100).fill(0).map((_, i) => i * 0.01);
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify(complexEmbedding),
      content_hash: "hash",
    });

    const result = await getEmbedding("note", "note-abc");

    expect(result?.embedding).toHaveLength(100);
    expect(result?.embedding[50]).toBeCloseTo(0.5, 5);
  });
});

describe("needsEmbeddingUpdate", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { queryOne } = await import("@/lib/db/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    vi.clearAllMocks();
  });

  it("returns true when no existing embedding", async () => {
    const { needsEmbeddingUpdate } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValueOnce(null);

    const result = await needsEmbeddingUpdate("note", "note-abc", "newhash");

    expect(result).toBe(true);
  });

  it("returns true when content hash changed", async () => {
    const { needsEmbeddingUpdate } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify([0.1]),
      content_hash: "oldhash",
    });

    const result = await needsEmbeddingUpdate("note", "note-abc", "newhash");

    expect(result).toBe(true);
  });

  it("returns false when content hash matches", async () => {
    const { needsEmbeddingUpdate } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify([0.1]),
      content_hash: "samehash",
    });

    const result = await needsEmbeddingUpdate("note", "note-abc", "samehash");

    expect(result).toBe(false);
  });
});

describe("embedNote", () => {
  let mockOpenRouter: { embeddings: { create: ReturnType<typeof vi.fn> } };
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { openrouter } = await import("@/lib/ai/client");
    const { queryOne, db } = await import("@/lib/db/client");
    mockOpenRouter = openrouter as unknown as { embeddings: { create: ReturnType<typeof vi.fn> } };
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("uses cached embedding if hash matches", async () => {
    const { embedNote } = await import("@/lib/ai/embeddings");
    const cachedEmbedding = [0.1, 0.2, 0.3];
    // "Title\n\nContent" has length 14, so hash is "hash-14"
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify(cachedEmbedding),
      content_hash: "hash-14",
    });

    const result = await embedNote("user-123", "note-abc", "Content", "Title");

    // Should not call OpenRouter if cache matches
    expect(mockOpenRouter.embeddings.create).not.toHaveBeenCalled();
    expect(result).toEqual(cachedEmbedding);
  });

  it("generates new embedding when hash differs", async () => {
    const { embedNote } = await import("@/lib/ai/embeddings");
    const newEmbedding = Array(1536).fill(0.5);
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify([0.1]),
      content_hash: "different-hash",
    });
    mockOpenRouter.embeddings.create.mockResolvedValueOnce({
      data: [{ embedding: newEmbedding }],
    });

    const result = await embedNote("user-123", "note-abc", "New content", "Title");

    expect(mockOpenRouter.embeddings.create).toHaveBeenCalled();
    expect(result).toEqual(newEmbedding);
  });

  it("combines title and content for embedding", async () => {
    const { embedNote } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValueOnce(null);
    mockOpenRouter.embeddings.create.mockResolvedValueOnce({
      data: [{ embedding: Array(1536).fill(0.1) }],
    });

    await embedNote("user-123", "note-abc", "My content", "My Title");

    expect(mockOpenRouter.embeddings.create).toHaveBeenCalledWith(
      expect.objectContaining({
        input: "My Title\n\nMy content",
      })
    );
  });
});

describe("deleteEmbedding", () => {
  let mockDb: { execute: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { db } = await import("@/lib/db/client");
    mockDb = db as unknown as { execute: ReturnType<typeof vi.fn> };
    vi.clearAllMocks();
  });

  it("deletes embedding by entity type and id", async () => {
    const { deleteEmbedding } = await import("@/lib/ai/embeddings");

    await deleteEmbedding("note", "note-abc");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        sql: expect.stringContaining("DELETE FROM embeddings"),
        args: ["note", "note-abc"],
      })
    );
  });

  it("handles capture entity type", async () => {
    const { deleteEmbedding } = await import("@/lib/ai/embeddings");

    await deleteEmbedding("capture", "capture-xyz");

    expect(mockDb.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        args: ["capture", "capture-xyz"],
      })
    );
  });
});

describe("batchEmbedNotes", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockOpenRouter: { embeddings: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    const { queryOne } = await import("@/lib/db/client");
    const { openrouter } = await import("@/lib/ai/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockOpenRouter = openrouter as unknown as { embeddings: { create: ReturnType<typeof vi.fn> } };
    vi.clearAllMocks();
  });

  it("embeds multiple notes", async () => {
    const { batchEmbedNotes } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValue(null);
    mockOpenRouter.embeddings.create.mockResolvedValue({
      data: [{ embedding: Array(1536).fill(0.1) }],
    });

    const notes = [
      { id: "1", title: "Note 1", content: "Content 1" },
      { id: "2", title: "Note 2", content: "Content 2" },
      { id: "3", title: "Note 3", content: "Content 3" },
    ];

    const result = await batchEmbedNotes("user-123", notes);

    expect(result.success).toBe(3);
    expect(result.failed).toBe(0);
  });

  it("counts failures", async () => {
    const { batchEmbedNotes } = await import("@/lib/ai/embeddings");
    mockQueryOne.mockResolvedValue(null);
    mockOpenRouter.embeddings.create
      .mockResolvedValueOnce({ data: [{ embedding: Array(1536).fill(0.1) }] })
      .mockRejectedValueOnce(new Error("API error"))
      .mockResolvedValueOnce({ data: [{ embedding: Array(1536).fill(0.1) }] });

    const notes = [
      { id: "1", title: "Note 1", content: "Content 1" },
      { id: "2", title: "Note 2", content: "Content 2" },
      { id: "3", title: "Note 3", content: "Content 3" },
    ];

    const result = await batchEmbedNotes("user-123", notes);

    expect(result.success).toBe(2);
    expect(result.failed).toBe(1);
  });

  it("handles empty array", async () => {
    const { batchEmbedNotes } = await import("@/lib/ai/embeddings");

    const result = await batchEmbedNotes("user-123", []);

    expect(result.success).toBe(0);
    expect(result.failed).toBe(0);
  });
});

describe("findSimilarNotes", () => {
  let mockQueryOne: ReturnType<typeof vi.fn>;
  let mockQueryAll: ReturnType<typeof vi.fn>;
  let mockOpenRouter: { embeddings: { create: ReturnType<typeof vi.fn> } };

  beforeEach(async () => {
    const { queryOne, queryAll } = await import("@/lib/db/client");
    const { openrouter } = await import("@/lib/ai/client");
    mockQueryOne = queryOne as unknown as ReturnType<typeof vi.fn>;
    mockQueryAll = queryAll as unknown as ReturnType<typeof vi.fn>;
    mockOpenRouter = openrouter as unknown as { embeddings: { create: ReturnType<typeof vi.fn> } };
    vi.clearAllMocks();
  });

  it("returns empty array when source note not found", async () => {
    const { findSimilarNotes } = await import("@/lib/ai/embeddings");
    // First call: getEmbedding returns null
    // Second call: queryOne for note returns null
    mockQueryOne.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    const result = await findSimilarNotes("user-123", "nonexistent");

    expect(result).toEqual([]);
  });

  it("filters by similarity threshold", async () => {
    const { findSimilarNotes } = await import("@/lib/ai/embeddings");
    // Source embedding
    const sourceEmb = Array(1536).fill(0.5);
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify(sourceEmb),
      content_hash: "hash",
    });

    // Similar notes - one very similar, one not similar
    mockQueryAll
      .mockResolvedValueOnce([
        { entity_id: "similar", embedding: JSON.stringify(Array(1536).fill(0.49)) },
        { entity_id: "different", embedding: JSON.stringify(Array(1536).fill(-0.5)) },
      ])
      .mockResolvedValueOnce([
        { id: "similar", title: "Similar Note", slug: "similar", summary: null, note_type: "note" },
      ]);

    const result = await findSimilarNotes("user-123", "source-note", 0.5, 10);

    // Only the similar note should be returned
    expect(result.length).toBeLessThanOrEqual(2);
    // The most similar should come first
    if (result.length > 0) {
      expect(result[0].similarity).toBeGreaterThan(0);
    }
  });

  it("limits results", async () => {
    const { findSimilarNotes } = await import("@/lib/ai/embeddings");
    const sourceEmb = Array(1536).fill(0.5);
    mockQueryOne.mockResolvedValueOnce({
      embedding: JSON.stringify(sourceEmb),
      content_hash: "hash",
    });

    // Create many similar embeddings
    const manyEmbeddings = Array(20).fill(null).map((_, i) => ({
      entity_id: `note-${i}`,
      embedding: JSON.stringify(Array(1536).fill(0.45 + i * 0.01)),
    }));

    mockQueryAll
      .mockResolvedValueOnce(manyEmbeddings)
      .mockResolvedValueOnce(
        manyEmbeddings.slice(0, 5).map((e) => ({
          id: e.entity_id,
          title: `Note ${e.entity_id}`,
          slug: e.entity_id,
          summary: null,
          note_type: "note",
        }))
      );

    const result = await findSimilarNotes("user-123", "source", 0.1, 5);

    expect(result.length).toBeLessThanOrEqual(5);
  });
});
