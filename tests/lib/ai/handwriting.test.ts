import { describe, it, expect, vi } from "vitest";

// Avoid constructing the real OpenRouter client at import time (no API key in tests).
vi.mock("@/lib/ai/client", () => ({
  openrouter: { chat: { completions: { create: vi.fn() } } },
  DEFAULT_MODEL: "test-model",
  parseJSONResponse: (raw: string) => JSON.parse(raw),
}));

import { normalizeRecognition } from "@/lib/ai/handwriting";

describe("normalizeRecognition", () => {
  it("passes through a well-formed response", () => {
    const r = normalizeRecognition({
      hasText: true,
      text: "Buy milk",
      markdown: "- [ ] Buy milk",
      description: "A checklist",
      confidence: 0.9,
    });
    expect(r.hasText).toBe(true);
    expect(r.text).toBe("Buy milk");
    expect(r.markdown).toBe("- [ ] Buy milk");
    expect(r.confidence).toBe(0.9);
  });

  it("infers hasText from text when the flag is missing", () => {
    expect(normalizeRecognition({ text: "hello" }).hasText).toBe(true);
    expect(normalizeRecognition({ text: "" }).hasText).toBe(false);
  });

  it("falls back markdown to plain text when absent", () => {
    const r = normalizeRecognition({ text: "line one\nline two" });
    expect(r.markdown).toBe("line one\nline two");
  });

  it("normalizes a 0..100 confidence to 0..1", () => {
    expect(normalizeRecognition({ text: "x", confidence: 85 }).confidence).toBeCloseTo(0.85);
  });

  it("clamps out-of-range confidence", () => {
    expect(normalizeRecognition({ text: "x", confidence: -5 }).confidence).toBe(0);
    // Values > 1 are treated as a 0..100 scale, then clamped.
    expect(normalizeRecognition({ text: "x", confidence: 150 }).confidence).toBe(1);
  });

  it("defaults confidence to 0.5 when not a number", () => {
    // @ts-expect-error testing runtime guard
    expect(normalizeRecognition({ text: "x", confidence: "high" }).confidence).toBe(0.5);
  });

  it("supports snake_case has_text", () => {
    expect(normalizeRecognition({ has_text: false, text: "ignored?" }).hasText).toBe(false);
  });

  it("trims whitespace", () => {
    const r = normalizeRecognition({ text: "  hi  ", description: "  d  " });
    expect(r.text).toBe("hi");
    expect(r.description).toBe("d");
  });
});
