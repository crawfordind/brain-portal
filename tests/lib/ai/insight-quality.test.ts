import { describe, it, expect } from "vitest";
import {
  dedupeInsights,
  applyDiversityBudget,
  computeTypeFeedbackBias,
  rankInsights,
} from "@/lib/ai/insight-quality";

// Simple orthonormal-ish vectors so cosine similarity is easy to reason about.
const A = [1, 0, 0];
const A_NEAR = [0.99, 0.14, 0]; // very close to A (cos ≈ 0.99)
const B = [0, 1, 0];
const C = [0, 0, 1];

describe("dedupeInsights", () => {
  it("suppresses a candidate that duplicates an existing insight", () => {
    const candidates = [{ id: "new", type: "connection", embedding: A_NEAR }];
    const existing = [{ id: "old", embedding: A }];

    const result = dedupeInsights(candidates, existing, 0.9);

    expect(result.kept).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
    expect(result.suppressed[0].reason).toBe("duplicate_of_existing");
    expect(result.suppressed[0].matchedId).toBe("old");
  });

  it("suppresses later candidates that duplicate an earlier kept candidate (biochar x N)", () => {
    const candidates = [
      { id: "biochar-1", embedding: A },
      { id: "biochar-2", embedding: A_NEAR },
      { id: "biochar-3", embedding: A_NEAR },
      { id: "distinct", embedding: B },
    ];

    const result = dedupeInsights(candidates, [], 0.9);

    expect(result.kept.map((k) => k.id)).toEqual(["biochar-1", "distinct"]);
    expect(result.suppressed.map((s) => s.insight.id)).toEqual([
      "biochar-2",
      "biochar-3",
    ]);
    expect(result.suppressed[0].reason).toBe("duplicate_of_candidate");
  });

  it("keeps semantically distinct candidates", () => {
    const candidates = [
      { id: "a", embedding: A },
      { id: "b", embedding: B },
      { id: "c", embedding: C },
    ];
    const result = dedupeInsights(candidates, [], 0.9);
    expect(result.kept).toHaveLength(3);
    expect(result.suppressed).toHaveLength(0);
  });

  it("keeps candidates that lack an embedding (can't judge similarity)", () => {
    const candidates = [{ id: "no-emb" }, { id: "empty", embedding: [] }];
    const result = dedupeInsights(candidates, [{ id: "x", embedding: A }], 0.9);
    expect(result.kept).toHaveLength(2);
  });
});

describe("applyDiversityBudget", () => {
  it("caps insights per type, keeping the highest confidence", () => {
    const insights = [
      { id: "c1", type: "connection", confidence: 0.5 },
      { id: "c2", type: "connection", confidence: 0.9 },
      { id: "c3", type: "connection", confidence: 0.7 },
      { id: "c4", type: "connection", confidence: 0.4 },
      { id: "p1", type: "pattern", confidence: 0.6 },
    ];

    const result = applyDiversityBudget(insights, 2);

    // connection capped to its 2 strongest (0.9, 0.7); pattern untouched.
    expect(result.kept.map((k) => k.id).sort()).toEqual(["c2", "c3", "p1"]);
    expect(result.suppressed.map((s) => s.id).sort()).toEqual(["c1", "c4"]);
  });

  it("preserves original ordering among kept items", () => {
    const insights = [
      { id: "p1", type: "pattern", confidence: 0.6 },
      { id: "c2", type: "connection", confidence: 0.9 },
      { id: "c3", type: "connection", confidence: 0.7 },
    ];
    const result = applyDiversityBudget(insights, 5);
    expect(result.kept.map((k) => k.id)).toEqual(["p1", "c2", "c3"]);
  });

  it("suppresses everything when the budget is zero", () => {
    const insights = [{ id: "x", type: "connection", confidence: 0.9 }];
    const result = applyDiversityBudget(insights, 0);
    expect(result.kept).toHaveLength(0);
    expect(result.suppressed).toHaveLength(1);
  });
});

describe("computeTypeFeedbackBias", () => {
  it("floats upvoted types and sinks downvoted ones", () => {
    const bias = computeTypeFeedbackBias([
      { type: "connection", feedback: "up" },
      { type: "connection", feedback: "up" },
      { type: "action", feedback: "down" },
    ]);
    expect(bias.connection).toBeGreaterThan(0);
    expect(bias.action).toBeLessThan(0);
  });

  it("bounds the bias to ±cap even under a flood of votes", () => {
    const votes = Array.from({ length: 100 }, () => ({
      type: "connection" as const,
      feedback: "up" as const,
    }));
    const bias = computeTypeFeedbackBias(votes, 0.3);
    expect(bias.connection).toBeLessThanOrEqual(0.3);
    expect(bias.connection).toBeGreaterThan(0.25);
  });

  it("returns an empty map for no feedback", () => {
    expect(computeTypeFeedbackBias([])).toEqual({});
  });
});

describe("rankInsights", () => {
  it("orders by confidence when there is no bias", () => {
    const insights = [
      { id: "low", type: "connection", confidence: 0.4 },
      { id: "high", type: "connection", confidence: 0.9 },
      { id: "mid", type: "connection", confidence: 0.6 },
    ];
    const ranked = rankInsights(insights);
    expect(ranked.map((r) => r.id)).toEqual(["high", "mid", "low"]);
  });

  it("lets feedback bias override a small confidence gap", () => {
    const insights = [
      { id: "confident-but-disliked", type: "action", confidence: 0.72 },
      { id: "liked", type: "connection", confidence: 0.6 },
    ];
    const bias = { action: -0.2, connection: 0.2 };
    const ranked = rankInsights(insights, bias);
    expect(ranked[0].id).toBe("liked");
  });

  it("is stable for equal effective scores", () => {
    const insights = [
      { id: "first", type: "a", confidence: 0.5 },
      { id: "second", type: "b", confidence: 0.5 },
    ];
    expect(rankInsights(insights).map((r) => r.id)).toEqual(["first", "second"]);
  });
});
