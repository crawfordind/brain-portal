import { describe, it, expect } from "vitest";
import { computeInsightConfidence } from "@/lib/ai/insight-confidence";

describe("computeInsightConfidence", () => {
  it("rises with the number of supporting notes (more evidence → more confidence)", () => {
    const c0 = computeInsightConfidence(0, "connection");
    const c1 = computeInsightConfidence(1, "connection");
    const c2 = computeInsightConfidence(2, "connection");
    const c3 = computeInsightConfidence(3, "connection");
    const c5 = computeInsightConfidence(5, "connection");

    expect(c0).toBeLessThan(c1);
    expect(c1).toBeLessThan(c2);
    expect(c2).toBeLessThan(c3);
    expect(c3).toBeLessThan(c5);
  });

  it("produces genuine variance, not a constant (the 0.8 stub problem)", () => {
    const scores = [0, 1, 2, 3, 4, 5].map((n) =>
      computeInsightConfidence(n, "connection")
    );
    const unique = new Set(scores);
    expect(unique.size).toBeGreaterThan(4);
    // None of them should be the old hardcoded stub.
    expect(scores).not.toContain(0.8);
  });

  it("gives an unsupported insight low confidence", () => {
    expect(computeInsightConfidence(0, "connection")).toBeLessThan(0.4);
  });

  it("discounts speculative types (gap/question) below grounded ones", () => {
    const connection = computeInsightConfidence(3, "connection");
    const gap = computeInsightConfidence(3, "gap");
    const question = computeInsightConfidence(3, "question");
    expect(gap).toBeLessThan(connection);
    expect(question).toBeLessThan(connection);
  });

  it("stays within [0.05, 0.95]", () => {
    for (let n = 0; n <= 50; n++) {
      const c = computeInsightConfidence(n, "connection");
      expect(c).toBeGreaterThanOrEqual(0.05);
      expect(c).toBeLessThanOrEqual(0.95);
    }
  });

  it("handles unknown types with a neutral discount", () => {
    const c = computeInsightConfidence(3, "mystery-type");
    expect(c).toBeGreaterThan(0.5);
    expect(c).toBeLessThan(0.8);
  });

  it("rounds to two decimals", () => {
    const c = computeInsightConfidence(2, "leverage");
    expect(Number.isInteger(c * 100)).toBe(true);
  });

  it("treats negative/garbage source counts as zero evidence", () => {
    expect(computeInsightConfidence(-3, "pattern")).toBe(
      computeInsightConfidence(0, "pattern")
    );
  });
});
