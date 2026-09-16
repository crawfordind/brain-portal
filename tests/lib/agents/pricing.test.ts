import { describe, it, expect } from "vitest";
import {
  estimateCost,
  formatCost,
  formatTokens,
  MODEL_PRICING,
  ESTIMATED_MINUTES_SAVED_PER_TASK,
} from "@/lib/agents/pricing";

describe("estimateCost", () => {
  it("calculates cost for a known model", () => {
    // x-ai/grok-4.1-fast: $0.30 input, $0.50 output per 1M
    const cost = estimateCost("x-ai/grok-4.1-fast", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(0.80, 2);
  });

  it("calculates cost for OpenAI model", () => {
    // openai/gpt-4o: $2.50 input, $10.00 output per 1M
    const cost = estimateCost("openai/gpt-4o", 500_000, 200_000);
    expect(cost).toBeCloseTo(1.25 + 2.0, 2); // 3.25
  });

  it("uses default pricing for unknown models", () => {
    // Default: $1.00 input, $3.00 output per 1M
    const cost = estimateCost("unknown/model-xyz", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(4.0, 2);
  });

  it("returns 0 for zero tokens", () => {
    const cost = estimateCost("x-ai/grok-4.1-fast", 0, 0);
    expect(cost).toBe(0);
  });

  it("handles large token counts", () => {
    const cost = estimateCost("x-ai/grok-4.1-fast", 10_000_000, 5_000_000);
    // (10M / 1M) * 0.30 + (5M / 1M) * 0.50 = 3.00 + 2.50 = 5.50
    expect(cost).toBeCloseTo(5.5, 2);
  });

  it("handles small token counts accurately", () => {
    const cost = estimateCost("x-ai/grok-4.1-fast", 100, 50);
    // (100 / 1M) * 0.30 + (50 / 1M) * 0.50 = 0.00003 + 0.000025 = 0.000055
    expect(cost).toBeCloseTo(0.000055, 6);
  });
});

describe("formatCost", () => {
  it("formats normal dollar amounts", () => {
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(0.05)).toBe("$0.05");
  });

  it("shows <$0.01 for tiny amounts", () => {
    expect(formatCost(0.001)).toBe("<$0.01");
    expect(formatCost(0.0)).toBe("<$0.01");
  });

  it("formats larger amounts", () => {
    expect(formatCost(99.99)).toBe("$99.99");
  });
});

describe("formatTokens", () => {
  it("formats millions", () => {
    expect(formatTokens(1_500_000)).toBe("1.5M");
    expect(formatTokens(2_000_000)).toBe("2.0M");
  });

  it("formats thousands", () => {
    expect(formatTokens(45_300)).toBe("45.3K");
    expect(formatTokens(1_000)).toBe("1.0K");
  });

  it("shows raw number for small counts", () => {
    expect(formatTokens(892)).toBe("892");
    expect(formatTokens(0)).toBe("0");
  });
});

describe("MODEL_PRICING", () => {
  it("has pricing for commonly used models", () => {
    expect(MODEL_PRICING["x-ai/grok-4.1-fast"]).toBeDefined();
    expect(MODEL_PRICING["openai/gpt-4o"]).toBeDefined();
    expect(MODEL_PRICING["anthropic/claude-sonnet-4"]).toBeDefined();
  });

  it("has positive pricing values", () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPer1M).toBeGreaterThanOrEqual(0);
      expect(pricing.outputPer1M).toBeGreaterThanOrEqual(0);
      // At least one should be positive
      expect(pricing.inputPer1M + pricing.outputPer1M).toBeGreaterThan(0);
    }
  });
});

describe("ESTIMATED_MINUTES_SAVED_PER_TASK", () => {
  it("is a positive number", () => {
    expect(ESTIMATED_MINUTES_SAVED_PER_TASK).toBeGreaterThan(0);
    expect(ESTIMATED_MINUTES_SAVED_PER_TASK).toBe(15);
  });
});
